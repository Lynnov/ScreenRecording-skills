import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { renderEditPreview } from '../lib/video-generator/editing/preview.js';
import type { EditPlan } from '../lib/video-generator/editing/types.js';
import { validateEditPlan } from '../lib/video-generator/editing/validator.js';
import { createManualBundle } from '../lib/video-generator/manual/bundle.js';
import { validateManualSourceCatalog } from '../lib/video-generator/manual/schema.js';
import { availableManualSources, type ManualSourceCatalog } from '../lib/video-generator/manual/types.js';
import { resolvePathInsideRun } from '../lib/video-generator/manual/run-path.js';

export interface ManualPreviewCliIo {
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
  render?: typeof renderEditPreview;
}

interface ParsedArgs {
  runDir?: string;
  plan?: 'agent' | 'effective';
  error?: string;
}

export async function runManualPreviewCli(argv: string[], io: ManualPreviewCliIo = {}): Promise<number> {
  const stdout = io.stdout ?? console.log;
  const stderr = io.stderr ?? console.error;
  const parsed = parseArgs(argv);
  if (parsed.error !== undefined) { stderr(`${parsed.error}\n${usage()}`); return 1; }
  if (parsed.runDir === undefined) { stderr(`--run is required.\n${usage()}`); return 1; }
  const planSelector = parsed.plan ?? 'effective';
  try {
    const bundle = createManualBundle(parsed.runDir);
    const pointerPath = planSelector === 'agent' ? bundle.agentCurrentPlanPath : bundle.effectiveCurrentPlanPath;
    const pointer = JSON.parse(await readFile(pointerPath, 'utf8')) as { path?: string };
    if (pointer.path === undefined) throw new Error(`Current ${planSelector} plan pointer is invalid.`);
    const planPath = resolvePathInsideRun(parsed.runDir, pointer.path, `Current ${planSelector} plan`);
    const plan = JSON.parse(await readFile(planPath, 'utf8')) as EditPlan;
    const catalog = JSON.parse(await readFile(bundle.sourceCatalogPath, 'utf8')) as ManualSourceCatalog;
    validateManualSourceCatalog(catalog);
    const sources = availableManualSources(catalog);
    validateEditPlan(plan, sources);
    const result = await (io.render ?? renderEditPreview)({
      plan,
      sources,
      outputPath: bundle.previewVideoPath,
      timelinePath: bundle.previewTimelinePath,
    });
    stdout(`Manual preview rendered.\nPreview: ${result.previewPath}\nTimeline: ${result.timelinePath}`);
    return 0;
  } catch (error) {
    stderr(`Manual preview failed.\n${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--run') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) return { error: '--run requires a value' };
      parsed.runDir = value;
      index += 1;
      continue;
    }
    if (arg === '--plan') {
      const value = argv[index + 1];
      if (value !== 'agent' && value !== 'effective') return { error: '--plan must be agent or effective' };
      parsed.plan = value;
      index += 1;
      continue;
    }
    return { error: `Unknown argument: ${arg}` };
  }
  return parsed;
}

function usage(): string {
  return [
    'Usage:',
    '  npm run video:preview -- --run <run-dir> --plan agent|effective',
  ].join('\n');
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await runManualPreviewCli(process.argv.slice(2));
}
