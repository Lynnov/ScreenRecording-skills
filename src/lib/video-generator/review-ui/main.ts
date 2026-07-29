import { app, BrowserWindow, ipcMain } from 'electron';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createManualBundle } from '../manual/bundle.js';
import { createEditReviewDraft, validateEditReview, saveReviewedEffectivePlan, type EditReview } from '../manual/review.js';
import { validateManualSourceCatalog } from '../manual/schema.js';
import type { EditPlan } from '../editing/types.js';
import { REVIEW_UI_CHANNELS } from './ipc.js';

let runDir = process.argv.includes('--run') ? process.argv[process.argv.indexOf('--run') + 1] : undefined;

function moduleDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

export function assertPathInsideRun(targetPath: string, rootDir: string): void {
  const relative = path.relative(rootDir, targetPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path is outside run directory: ${targetPath}`);
  }
}

async function loadCurrentReviewOrDraft(rootDir: string, agentPlan: EditPlan): Promise<EditReview> {
  const bundle = createManualBundle(rootDir);
  try {
    const pointer = JSON.parse(await readFile(bundle.reviewCurrentPath, 'utf8')) as { path: string };
    assertPathInsideRun(pointer.path, rootDir);
    const review = JSON.parse(await readFile(pointer.path, 'utf8')) as EditReview;
    validateEditReview(review, agentPlan);
    return review;
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : '';
    if (code !== 'ENOENT') throw error;
    return createEditReviewDraft({ agentPlan });
  }
}

export async function loadReviewBundle(rootDir: string) {
  const bundle = createManualBundle(rootDir);
  const pointer = JSON.parse(await readFile(bundle.agentCurrentPlanPath, 'utf8')) as { path: string };
  assertPathInsideRun(pointer.path, rootDir);
  const agentPlan = JSON.parse(await readFile(pointer.path, 'utf8')) as EditPlan;
  assertPathInsideRun(bundle.previewVideoPath, rootDir);
  const previewTimeline = JSON.parse(await readFile(bundle.previewTimelinePath, 'utf8'));
  const sourceCatalog = JSON.parse(await readFile(bundle.sourceCatalogPath, 'utf8'));
  validateManualSourceCatalog(sourceCatalog);
  const reviewDraft = await loadCurrentReviewOrDraft(rootDir, agentPlan);
  return { agentPlan, previewPath: bundle.previewVideoPath, previewTimeline, sourceCatalog, reviewDraft };
}

function registerIpc(rootDir: string): void {
  ipcMain.handle(REVIEW_UI_CHANNELS.loadBundle, async () => loadReviewBundle(rootDir));
  ipcMain.handle(REVIEW_UI_CHANNELS.saveReview, async (_event, review: EditReview) => saveReviewedEffectivePlan({ runDir: rootDir, review }));
  ipcMain.handle(REVIEW_UI_CHANNELS.localPreview, async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'manual-review-preview-'));
    return { ok: false as const, error: `Local preview is not implemented yet: ${tempDir}` };
  });
}

export async function startReviewUi(rootDir: string): Promise<void> {
  await app.whenReady();
  registerIpc(rootDir);
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    webPreferences: {
      preload: path.join(moduleDir(), 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await win.loadFile(path.join(moduleDir(), 'review.html'));
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (runDir === undefined) {
    console.error('Usage: manual-review --run <run-dir>');
    process.exitCode = 1;
  } else {
    void startReviewUi(runDir);
  }
}
