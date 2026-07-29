import { access, mkdir, open, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { writeNewJson } from './atomic-writer.js';

export interface ManualBundle {
  rootDir: string;
  scriptsDir: string;
  agentDir: string;
  captureDir: string;
  keyframesDir: string;
  pickupsDir: string;
  editDir: string;
  audioDir: string;
  reportsDir: string;
  lockPath: string;
  originalScriptPath: string;
  approvedGuidePath: string;
  approvedNarrationPath: string;
  rawVideoPath: string;
  originalVideoPath: string;
  eventsPath: string;
  tabsPath: string;
  recordingManifestPath: string;
  sourceCatalogPath: string;
  agentCurrentPlanPath: string;
  effectiveCurrentPlanPath: string;
  reviewCurrentPath: string;
  previewTimelinePath: string;
  previewVideoPath: string;
  subtitlesPath: string;
  finalTimelinePath: string;
  finalVideoPath: string;
  versionedScriptPath(kind: 'polished' | 'executable' | 'recording-guide' | 'narration-final', version: number): string;
  versionedAgentPath(kind: 'guide-request' | 'guide-response' | 'edit-request' | 'edit-response' | 'narration-request' | 'narration-response', version: number): string;
  versionedEditPath(kind: 'edit-plan.agent' | 'edit-plan.effective' | 'edit-review' | 'edit-report.agent', version: number): string;
  pickupPath(segmentId: string, attempt: number): string;
  audioSegmentPath(segmentId: string): string;
  reportPath(name: string): string;
}

export interface ManualRunLock {
  path: string;
  release(): Promise<void>;
}

function formatVersion(version: number): string {
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(`Manual artifact version must be a positive integer: ${version}`);
  }
  return `v${String(version).padStart(2, '0')}`;
}

function versionedPath(dir: string, baseName: string, extension: string, version: number): string {
  return path.join(dir, `${baseName}.${formatVersion(version)}.${extension}`);
}

export function createManualBundle(rootDir: string): ManualBundle {
  const scriptsDir = path.join(rootDir, 'scripts');
  const agentDir = path.join(rootDir, 'agent');
  const captureDir = path.join(rootDir, 'capture');
  const keyframesDir = path.join(captureDir, 'keyframes');
  const pickupsDir = path.join(rootDir, 'pickups');
  const editDir = path.join(rootDir, 'edit');
  const audioDir = path.join(rootDir, 'audio');
  const reportsDir = path.join(rootDir, 'reports');

  return {
    rootDir,
    scriptsDir,
    agentDir,
    captureDir,
    keyframesDir,
    pickupsDir,
    editDir,
    audioDir,
    reportsDir,
    lockPath: path.join(rootDir, '.manual-run.lock'),
    originalScriptPath: path.join(scriptsDir, 'original.md'),
    approvedGuidePath: path.join(scriptsDir, 'recording-guide.approved.json'),
    approvedNarrationPath: path.join(scriptsDir, 'narration-final.approved.md'),
    rawVideoPath: path.join(captureDir, 'raw-window.webm'),
    originalVideoPath: path.join(captureDir, 'original-window.mp4'),
    eventsPath: path.join(captureDir, 'events.jsonl'),
    tabsPath: path.join(captureDir, 'tabs.json'),
    recordingManifestPath: path.join(captureDir, 'recording-manifest.json'),
    sourceCatalogPath: path.join(captureDir, 'source-catalog.json'),
    agentCurrentPlanPath: path.join(editDir, 'edit-plan.agent.current.json'),
    effectiveCurrentPlanPath: path.join(editDir, 'edit-plan.effective.current.json'),
    reviewCurrentPath: path.join(editDir, 'edit-review.current.json'),
    previewTimelinePath: path.join(editDir, 'preview-timeline.json'),
    previewVideoPath: path.join(editDir, 'preview.mp4'),
    subtitlesPath: path.join(rootDir, 'subtitles.srt'),
    finalTimelinePath: path.join(rootDir, 'final-timeline.json'),
    finalVideoPath: path.join(rootDir, 'final.mp4'),
    versionedScriptPath: (kind, version) => versionedPath(scriptsDir, kind, kind === 'polished' || kind === 'executable' || kind === 'narration-final' ? 'md' : 'json', version),
    versionedAgentPath: (kind, version) => versionedPath(agentDir, kind, 'json', version),
    versionedEditPath: (kind, version) => versionedPath(editDir, kind, kind === 'edit-report.agent' ? 'md' : 'json', version),
    pickupPath: (segmentId, attempt) => path.join(pickupsDir, `${segmentId}-attempt-${String(attempt).padStart(3, '0')}.mp4`),
    audioSegmentPath: (segmentId) => path.join(audioDir, `${segmentId}.wav`),
    reportPath: (name) => path.join(reportsDir, `${name}.json`),
  };
}

export async function ensureManualBundleDirs(bundle: ManualBundle): Promise<void> {
  await Promise.all([
    mkdir(bundle.scriptsDir, { recursive: true }),
    mkdir(bundle.agentDir, { recursive: true }),
    mkdir(bundle.captureDir, { recursive: true }),
    mkdir(bundle.keyframesDir, { recursive: true }),
    mkdir(bundle.pickupsDir, { recursive: true }),
    mkdir(bundle.editDir, { recursive: true }),
    mkdir(bundle.audioDir, { recursive: true }),
    mkdir(bundle.reportsDir, { recursive: true }),
  ]);
}

export async function acquireManualRunLock(rootDir: string): Promise<ManualRunLock> {
  await mkdir(rootDir, { recursive: true });
  const lockPath = createManualBundle(rootDir).lockPath;
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(lockPath, 'wx');
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : '';
    if (code === 'EEXIST') {
      throw new Error(`Manual run is already locked: ${rootDir}`);
    }
    throw error;
  }
  await handle.writeFile(`${process.pid}\n`, 'utf8');

  return {
    path: lockPath,
    release: async () => {
      await handle.close();
      await rm(lockPath, { force: true });
    },
  };
}

export async function writeProtectedJson(filePath: string, value: unknown): Promise<void> {
  await writeNewJson(filePath, value);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function writeVersionedJson(directory: string, baseName: string, value: unknown): Promise<{ version: number; path: string }> {
  await mkdir(directory, { recursive: true });
  const entries = await readdir(directory).catch((): string[] => []);
  const escapedBase = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escapedBase}\\.v(\\d{2,})\\.json$`);
  const latest = entries.reduce((max, entry) => {
    const match = pattern.exec(entry);
    return match === null ? max : Math.max(max, Number(match[1]));
  }, 0);

  for (let version = latest + 1; version < latest + 1000; version += 1) {
    const target = versionedPath(directory, baseName, 'json', version);
    if (await exists(target)) continue;
    await writeNewJson(target, value);
    return { version, path: target };
  }
  throw new Error(`Unable to allocate versioned JSON artifact for ${baseName}`);
}
