import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { calculateSegmentDurationMs } from '../duration.js';
import { VideoGeneratorError, type Timeline, type TimelineSegment, type VideoGeneratorConfig } from '../types.js';
import { executeBrowserAction } from './actions.js';

export interface RecordTimelineSegmentsInput {
  timeline: Timeline;
  config: VideoGeneratorConfig;
  outputDir: string;
}

export async function recordTimelineSegments({
  timeline,
  config,
  outputDir,
}: RecordTimelineSegmentsInput): Promise<Timeline> {
  const videoDir = join(outputDir, 'clips');
  const screenshotDir = join(outputDir, 'screenshots');
  await mkdir(videoDir, { recursive: true });
  await mkdir(screenshotDir, { recursive: true });

  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let currentSegment: TimelineSegment | undefined;
  let currentAction: TimelineSegment['actions'][number] | undefined;

  try {
    browser = await chromium.launch();
    context = await browser.newContext({
      viewport: config.viewport,
      storageState: config.storageStatePath,
      recordVideo: { dir: videoDir, size: config.viewport },
    });
    page = await context.newPage();

    const recordedSegments: TimelineSegment[] = [];
    let cursorMs = 0;

    for (const segment of timeline.segments) {
      currentSegment = segment;
      currentAction = undefined;

      const startsAtMs = segment.startsAtMs ?? cursorMs;
      if (startsAtMs > cursorMs) {
        await page.waitForTimeout(startsAtMs - cursorMs);
        cursorMs = startsAtMs;
      }

      const actionStartedAtMs = monotonicNowMs();
      for (const action of segment.actions) {
        currentAction = action;
        await executeBrowserAction(page, action, config.actionTimeoutMs);
        await waitForPageStable(page, config.actionTimeoutMs);
      }
      const actionDurationMs = monotonicNowMs() - actionStartedAtMs;
      cursorMs += actionDurationMs;

      const durationMs = calculateSegmentDurationMs({
        estimatedMs: segment.estimatedDurationMs,
        actualAudioMs: segment.actualAudioDurationMs,
        bufferMs: segment.bufferMs,
      });
      const endsAtMs = segment.endsAtMs ?? startsAtMs + durationMs;

      if (endsAtMs > cursorMs) {
        await page.waitForTimeout(endsAtMs - cursorMs);
        cursorMs = endsAtMs;
      }

      recordedSegments.push({
        ...segment,
        assets: { ...segment.assets },
        startsAtMs,
        endsAtMs,
      });
      cursorMs = Math.max(cursorMs, endsAtMs);
    }

    const video = page.video();
    await context.close();
    context = undefined;

    if (video === null) {
      throw new VideoGeneratorError('UNSUPPORTED_SCRIPT_ACTION', 'Playwright did not attach a video recorder to the page.');
    }

    const continuousClipPath = await video.path();

    return {
      ...timeline,
      assets: {
        ...timeline.assets,
        continuousClipPath,
      },
      segments: recordedSegments.map((segment) => ({
        ...segment,
        assets: {
          ...segment.assets,
          clipPath: continuousClipPath,
        },
      })),
    };
  } catch (error) {
    const segmentId = currentSegment?.id ?? 'unknown';
    const screenshotPath = join(screenshotDir, `${segmentId}.png`);
    const screenshotCaptured = page === undefined ? false : await captureFailureScreenshot(page, screenshotPath);
    await context?.close().catch(() => undefined);
    context = undefined;

    const screenshotMessage = screenshotCaptured
      ? `screenshot saved to ${screenshotPath}`
      : `screenshot capture failed for ${screenshotPath}`;

    throw new VideoGeneratorError(
      error instanceof VideoGeneratorError ? error.code : 'UNSUPPORTED_SCRIPT_ACTION',
      `Failed to record segment ${segmentId}; ${screenshotMessage}: ${errorMessage(error)}`,
      currentSegment?.id,
      error instanceof VideoGeneratorError ? error.failedAction ?? currentAction : currentAction,
    );
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}

async function waitForPageStable(page: Page, timeoutMs: number): Promise<void> {
  await page.waitForLoadState('domcontentloaded', { timeout: timeoutMs }).catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => undefined);
}

async function captureFailureScreenshot(page: Page, screenshotPath: string): Promise<boolean> {
  try {
    await page.screenshot({ path: screenshotPath, fullPage: true });
    return true;
  } catch {
    return false;
  }
}

function monotonicNowMs(): number {
  return performance.now();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.split('\n')[0] : String(error);
}
