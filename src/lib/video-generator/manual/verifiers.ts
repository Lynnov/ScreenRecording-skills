import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { probeFinalVideo, type ProbedFinalVideo } from '../ffmpeg.js';
import { validateEditPlan } from '../editing/validator.js';
import type { EditPlan } from '../editing/types.js';
import { writeAtomicJson } from './atomic-writer.js';
import { createManualBundle, ensureManualBundleDirs } from './bundle.js';
import { resolvePathInsideRun } from './run-path.js';
import { validateManualSourceCatalog, validateRecordingGuide } from './schema.js';
import { availableManualSources, type ManualSourceCatalog } from './types.js';

export const MANUAL_VERIFY_STAGES = ['guide', 'capture', 'preview', 'review', 'pickup', 'final'] as const;
export type ManualVerifyStage = typeof MANUAL_VERIFY_STAGES[number];

export interface ManualStageVerificationReport {
  version: 1;
  stage: ManualVerifyStage;
  ok: boolean;
  checkedAt: string;
  hashes: Record<string, string>;
  media: Record<string, ProbedFinalVideo>;
  errors: string[];
}

type ProbeMedia = (filePath: string) => Promise<ProbedFinalVideo>;

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T;
}

async function hashFile(filePath: string): Promise<string> {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

function addUnique(files: string[], filePath: string): void {
  if (!files.includes(filePath)) files.push(filePath);
}

async function pointerTarget(runDir: string, pointerPath: string, label: string): Promise<string> {
  const pointer = await readJson<{ path?: string; guidePath?: string; narrationPath?: string }>(pointerPath);
  const candidate = pointer.path ?? pointer.guidePath ?? pointer.narrationPath;
  if (typeof candidate !== 'string') throw new Error(`${label} pointer is invalid.`);
  return resolvePathInsideRun(runDir, candidate, label);
}

async function collectGuide(runDir: string, files: string[]): Promise<void> {
  const bundle = createManualBundle(runDir);
  addUnique(files, bundle.originalScriptPath);
  addUnique(files, bundle.approvedGuidePath);
  const guidePath = await pointerTarget(runDir, bundle.approvedGuidePath, 'Approved guide');
  validateRecordingGuide(await readJson<unknown>(guidePath));
  addUnique(files, guidePath);
}

async function collectCapture(
  runDir: string,
  files: string[],
  media: Record<string, ProbedFinalVideo>,
  probe: ProbeMedia,
): Promise<void> {
  const bundle = createManualBundle(runDir);
  for (const filePath of [bundle.recordingManifestPath, bundle.sourceCatalogPath, bundle.eventsPath, bundle.tabsPath]) addUnique(files, filePath);
  const manifest = await readJson<{ captureComplete?: boolean; clockStatus?: string; video?: { status?: string; path?: string } }>(bundle.recordingManifestPath);
  if (manifest.captureComplete !== true) throw new Error('captureComplete must equal true.');
  if (manifest.clockStatus !== 'ok') throw new Error('capture clockStatus must equal ok.');
  const catalog = await readJson<ManualSourceCatalog>(bundle.sourceCatalogPath);
  validateManualSourceCatalog(catalog);
  for (const source of availableManualSources(catalog)) {
    const sourcePath = resolvePathInsideRun(runDir, source.path, `Source ${source.id}`);
    addUnique(files, sourcePath);
    media[sourcePath] = await probe(sourcePath);
  }
}

async function collectPreview(runDir: string, files: string[], media: Record<string, ProbedFinalVideo>, probe: ProbeMedia): Promise<void> {
  const bundle = createManualBundle(runDir);
  addUnique(files, bundle.previewTimelinePath);
  addUnique(files, bundle.previewVideoPath);
  await readJson<unknown>(bundle.previewTimelinePath);
  media[bundle.previewVideoPath] = await probe(bundle.previewVideoPath);
}

async function collectReview(runDir: string, files: string[]): Promise<void> {
  const bundle = createManualBundle(runDir);
  addUnique(files, bundle.reviewCurrentPath);
  const reviewPath = await pointerTarget(runDir, bundle.reviewCurrentPath, 'Current review');
  const review = await readJson<{ reviewComplete?: boolean }>(reviewPath);
  if (review.reviewComplete !== true) throw new Error('reviewComplete must equal true.');
  addUnique(files, reviewPath);
  addUnique(files, bundle.effectiveCurrentPlanPath);
  const planPath = await pointerTarget(runDir, bundle.effectiveCurrentPlanPath, 'Current effective plan');
  const catalog = await readJson<ManualSourceCatalog>(bundle.sourceCatalogPath);
  validateManualSourceCatalog(catalog);
  validateEditPlan(await readJson<EditPlan>(planPath), availableManualSources(catalog));
  addUnique(files, planPath);
}

async function collectPickup(runDir: string, files: string[]): Promise<void> {
  const bundle = createManualBundle(runDir);
  const catalog = await readJson<ManualSourceCatalog>(bundle.sourceCatalogPath);
  validateManualSourceCatalog(catalog);
  if (!catalog.sources.some((source) => source.kind === 'pickup')) throw new Error('pickup stage requires at least one pickup source.');
  addUnique(files, bundle.sourceCatalogPath);
}

async function collectFinal(
  runDir: string,
  files: string[],
  media: Record<string, ProbedFinalVideo>,
  probe: ProbeMedia,
): Promise<void> {
  const bundle = createManualBundle(runDir);
  const finalReportPath = bundle.reportPath('final-verification');
  const finalReport = await readJson<{ ok?: boolean }>(finalReportPath);
  if (finalReport.ok !== true) throw new Error('final-verification report must have ok=true.');
  for (const filePath of [bundle.finalTimelinePath, bundle.subtitlesPath, bundle.finalVideoPath, finalReportPath]) addUnique(files, filePath);
  await readJson<unknown>(bundle.finalTimelinePath);
  media[bundle.finalVideoPath] = await probe(bundle.finalVideoPath);
}

async function compareUpstreamHashes(runDir: string, stage: ManualVerifyStage, hashes: Record<string, string>, errors: string[]): Promise<void> {
  const bundle = createManualBundle(runDir);
  const stageIndex = MANUAL_VERIFY_STAGES.indexOf(stage);
  for (const upstream of MANUAL_VERIFY_STAGES.slice(0, stageIndex)) {
    try {
      const previous = await readJson<ManualStageVerificationReport>(bundle.reportPath(`${upstream}-verification`));
      for (const [filePath, expectedHash] of Object.entries(previous.hashes)) {
        const currentHash = hashes[filePath] ?? await hashFile(filePath);
        hashes[filePath] = currentHash;
        if (currentHash !== expectedHash) errors.push(`Immutable upstream artifact hash changed: ${filePath}`);
      }
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : '';
      if (code !== 'ENOENT') errors.push(`Unable to verify upstream ${upstream} report: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export async function verifyManualStage(input: {
  runDir: string;
  stage: ManualVerifyStage;
  probeMedia?: ProbeMedia;
  now?: () => string;
}): Promise<ManualStageVerificationReport> {
  const bundle = createManualBundle(input.runDir);
  await ensureManualBundleDirs(bundle);
  const files: string[] = [];
  const media: Record<string, ProbedFinalVideo> = {};
  const errors: string[] = [];
  const probe = input.probeMedia ?? probeFinalVideo;
  try {
    if (input.stage === 'guide' || input.stage === 'capture' || input.stage === 'preview' || input.stage === 'review' || input.stage === 'pickup' || input.stage === 'final') {
      await collectGuide(input.runDir, files);
    }
    if (input.stage === 'capture') await collectCapture(input.runDir, files, media, probe);
    if (input.stage === 'preview') await collectPreview(input.runDir, files, media, probe);
    if (input.stage === 'review') await collectReview(input.runDir, files);
    if (input.stage === 'pickup') await collectPickup(input.runDir, files);
    if (input.stage === 'final') await collectFinal(input.runDir, files, media, probe);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  const hashes: Record<string, string> = {};
  for (const filePath of files) {
    try {
      hashes[filePath] = await hashFile(filePath);
    } catch (error) {
      errors.push(`Missing or unreadable artifact ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  await compareUpstreamHashes(input.runDir, input.stage, hashes, errors);
  const report: ManualStageVerificationReport = {
    version: 1,
    stage: input.stage,
    ok: errors.length === 0,
    checkedAt: input.now?.() ?? new Date().toISOString(),
    hashes,
    media,
    errors,
  };
  await writeAtomicJson(bundle.reportPath(`${input.stage}-verification`), report);
  return report;
}

export async function runManualVerifierCli(
  argv: string[],
  io: { stdout?: (message: string) => void; stderr?: (message: string) => void } = {},
): Promise<number> {
  const stdout = io.stdout ?? console.log;
  const stderr = io.stderr ?? console.error;
  let runDir: string | undefined;
  let stage: ManualVerifyStage | undefined;
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (value === undefined) { stderr(`${flag} requires a value.`); return 1; }
    if (flag === '--run') runDir = value;
    else if (flag === '--stage' && MANUAL_VERIFY_STAGES.includes(value as ManualVerifyStage)) stage = value as ManualVerifyStage;
    else { stderr(`Unknown or invalid argument: ${flag} ${value}`); return 1; }
  }
  if (runDir === undefined || stage === undefined) { stderr('Usage: verify:manual -- --run <run> --stage <guide|capture|preview|review|pickup|final>'); return 1; }
  const report = await verifyManualStage({ runDir, stage });
  stdout(`${stage} verification: ${report.ok ? 'OK' : 'FAILED'}\nReport: ${createManualBundle(runDir).reportPath(`${stage}-verification`)}`);
  if (!report.ok) stderr(report.errors.join('\n'));
  return report.ok ? 0 : 1;
}
