import { readFile, readdir } from 'node:fs/promises';
import { writeAtomicJson } from './atomic-writer.js';
import { validateManualSourceCatalog } from './schema.js';
import type { EditSource } from '../editing/types.js';
import type { ManualSource, ManualSourceCatalog } from './types.js';

export type ManualSourceProbe = Pick<EditSource,
  'durationMs' | 'width' | 'height' | 'fps' | 'codecName' | 'pixelFormat' | 'hasAudio'
>;

export interface AppendManualSourceInput {
  id: string;
  path: string;
  kind: ManualSource['kind'];
  segmentId: string | null;
  attempt: number | null;
  status: ManualSource['status'];
  createdAt: string;
  probe: ManualSourceProbe | null;
  failureReason?: string;
}

export interface AppendPickupSourceInput {
  path: string;
  segmentId: string;
  attempt?: number;
  status: ManualSource['status'];
  createdAt: string;
  probe: ManualSourceProbe | null;
  failureReason?: string;
}

export interface AppendPickupSourceResult {
  source: ManualSource;
  catalog: ManualSourceCatalog;
}

export async function readManualSourceCatalog(catalogPath: string): Promise<ManualSourceCatalog> {
  const text = await readFile(catalogPath, 'utf8');
  const catalog: unknown = JSON.parse(text);
  validateManualSourceCatalog(catalog);
  return catalog;
}

async function readExistingCatalog(catalogPath: string): Promise<ManualSourceCatalog> {
  try {
    return await readManualSourceCatalog(catalogPath);
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : '';
    if (code === 'ENOENT') {
      return { version: 1, sources: [] };
    }
    throw error;
  }
}

export async function appendSource(catalogPath: string, input: AppendManualSourceInput): Promise<ManualSourceCatalog> {
  const source = createManualSource(input);
  const existing = await readExistingCatalog(catalogPath);
  return appendValidatedSource(catalogPath, existing, source);
}

export async function appendPickupSource(
  catalogPath: string,
  input: AppendPickupSourceInput,
): Promise<AppendPickupSourceResult> {
  const existing = await readExistingCatalog(catalogPath);
  const attempt = input.attempt ?? getNextPickupAttempt(existing, input.segmentId);
  const source = createManualSource({
    id: `${input.segmentId}-attempt-${String(attempt).padStart(3, '0')}`,
    path: input.path,
    kind: 'pickup',
    segmentId: input.segmentId,
    attempt,
    status: input.status,
    createdAt: input.createdAt,
    probe: input.probe,
    failureReason: input.failureReason,
  });
  const catalog = await appendValidatedSource(catalogPath, existing, source);
  return { source, catalog };
}

function createManualSource(input: AppendManualSourceInput): ManualSource {
  const metadata = input.probe ?? {
    durationMs: null,
    width: null,
    height: null,
    fps: null,
    codecName: null,
    pixelFormat: null,
    hasAudio: null,
  };
  const source = {
    id: input.id,
    path: input.path,
    ...metadata,
    kind: input.kind,
    segmentId: input.segmentId,
    attempt: input.attempt,
    status: input.status,
    createdAt: input.createdAt,
    ...(input.status === 'failed' ? { failureReason: input.failureReason } : {}),
  } as unknown;
  validateManualSourceCatalog({ version: 1, sources: [source] });
  return source as ManualSource;
}

async function appendValidatedSource(
  catalogPath: string,
  existing: ManualSourceCatalog,
  source: ManualSource,
): Promise<ManualSourceCatalog> {
  const catalog: ManualSourceCatalog = {
    version: 1,
    sources: [...existing.sources, source],
  };
  validateManualSourceCatalog(catalog);
  await writeAtomicJson(catalogPath, catalog);
  return catalog;
}

export function getNextPickupAttempt(catalog: ManualSourceCatalog, segmentId: string): number {
  validateManualSourceCatalog(catalog);
  const attempts = catalog.sources
    .filter((source) => source.kind === 'pickup' && source.segmentId === segmentId && source.attempt !== null)
    .map((source) => source.attempt ?? 0);
  return attempts.length === 0 ? 1 : Math.max(...attempts) + 1;
}

export async function getNextPickupAttemptFromArtifacts(
  catalog: ManualSourceCatalog,
  pickupsDir: string,
  segmentId: string,
): Promise<number> {
  const escapedSegmentId = segmentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escapedSegmentId}-attempt-(\\d+)(?:\\.|$)`);
  const artifactAttempts = (await readdir(pickupsDir).catch((): string[] => []))
    .flatMap((entry) => {
      const match = pattern.exec(entry);
      if (match === null) return [];
      const attempt = Number(match[1]);
      return Number.isSafeInteger(attempt) && attempt > 0 ? [attempt] : [];
    });
  const catalogAttempt = getNextPickupAttempt(catalog, segmentId) - 1;
  return Math.max(catalogAttempt, ...artifactAttempts, 0) + 1;
}
