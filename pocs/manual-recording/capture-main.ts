import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type ManualDisplayMode = 'f11' | 'borderless-maximized';
export type ManualPocFixture = 'capture' | 'clock' | 'events';

export interface ManualPocArgs {
  help: boolean;
  output?: string;
  displayMode?: ManualDisplayMode;
  fixture?: ManualPocFixture;
  durationSeconds?: number;
}

export interface ManualCapturePocDeps {
  platform?: NodeJS.Platform;
  prepareOutput?: (args: Required<Omit<ManualPocArgs, 'help'>>) => Promise<void>;
  bindSource?: (args: Required<Omit<ManualPocArgs, 'help'>>) => Promise<void>;
  startCapture?: (args: Required<Omit<ManualPocArgs, 'help'>>) => Promise<void>;
  cleanup?: () => Promise<void>;
}

export interface ManualCapturePocResult {
  exitCode: number;
  message: string;
}

const USAGE = `Usage: capture-main --output <dir> --display-mode f11|borderless-maximized --fixture capture|clock|events --duration-seconds <positive integer>`;

export function parseManualPocArgs(argv: string[]): ManualPocArgs {
  const result: ManualPocArgs = { help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help') {
      return { help: true };
    }
    if (!['--output', '--display-mode', '--fixture', '--duration-seconds'].includes(arg)) {
      throw new Error(`Unknown option: ${arg}.`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${arg}.`);
    }
    switch (arg) {
      case '--output':
        result.output = value;
        break;
      case '--display-mode':
        if (value !== 'f11' && value !== 'borderless-maximized') {
          throw new Error(`Invalid --display-mode: ${value}.`);
        }
        result.displayMode = value;
        break;
      case '--fixture':
        if (value !== 'capture' && value !== 'clock' && value !== 'events') {
          throw new Error(`Invalid --fixture: ${value}.`);
        }
        result.fixture = value;
        break;
      case '--duration-seconds': {
        const durationSeconds = Number(value);
        if (!Number.isInteger(durationSeconds) || durationSeconds <= 0) {
          throw new Error('--duration-seconds must be a positive integer.');
        }
        result.durationSeconds = durationSeconds;
        break;
      }
      default:
        throw new Error(`Unknown option: ${arg}.`);
    }
    index += 1;
  }

  for (const required of ['output', 'displayMode', 'fixture', 'durationSeconds'] as const) {
    if (result[required] === undefined) {
      throw new Error(`Missing required option: --${required.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}.`);
    }
  }

  return result;
}

export async function runManualCapturePoc(argv: string[], deps: ManualCapturePocDeps = {}): Promise<ManualCapturePocResult> {
  const cleanup = deps.cleanup ?? asyncNoop;
  try {
    const parsed = parseManualPocArgs(argv);
    if (parsed.help) {
      return { exitCode: 0, message: USAGE };
    }
    const normalized = normalizeArgs(parsed);
    if ((deps.platform ?? process.platform) !== 'win32') {
      return { exitCode: 3, message: 'Manual capture POC only supports Windows.' };
    }
    await deps.prepareOutput?.(normalized);
    try {
      await deps.bindSource?.(normalized);
    } catch (error) {
      return { exitCode: 4, message: formatError(error) };
    }
    try {
      await deps.startCapture?.(normalized);
    } catch (error) {
      return { exitCode: 5, message: formatError(error) };
    }
    return { exitCode: 0, message: 'Manual capture POC completed.' };
  } catch (error) {
    return { exitCode: 2, message: `${formatError(error)}\n${USAGE}` };
  } finally {
    await cleanup();
  }
}

function normalizeArgs(parsed: ManualPocArgs): Required<Omit<ManualPocArgs, 'help'>> {
  if (parsed.output === undefined || parsed.displayMode === undefined || parsed.fixture === undefined || parsed.durationSeconds === undefined) {
    throw new Error('Missing required manual capture POC options.');
  }
  return {
    output: path.resolve(parsed.output),
    displayMode: parsed.displayMode,
    fixture: parsed.fixture,
    durationSeconds: parsed.durationSeconds,
  };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function asyncNoop(): Promise<void> {}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runManualCapturePoc(process.argv.slice(2));
  if (result.message) {
    const output = result.exitCode === 0 ? console.log : console.error;
    output(result.message);
  }
  process.exit(result.exitCode);
}
