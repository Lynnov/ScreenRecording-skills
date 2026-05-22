import { mkdir, writeFile } from 'node:fs/promises';
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
  const preparedHtmlDir = join(outputDir, 'prepared-html');
  await mkdir(videoDir, { recursive: true });
  await mkdir(screenshotDir, { recursive: true });
  await mkdir(preparedHtmlDir, { recursive: true });

  let browser: Browser | undefined;

  try {
    browser = await chromium.launch();
    const recordedSegments: TimelineSegment[] = [];
    const statePath = join(outputDir, 'browser-state.json');
    let preparationContext: BrowserContext | undefined;

    try {
      preparationContext = await browser.newContext({ viewport: config.viewport });
      const preparationPage = await preparationContext.newPage();

      for (const segment of timeline.segments) {
        const recordedSegment = await recordSegment({
          browser,
          preparationContext,
          preparationPage,
          segment,
          config,
          videoDir,
          screenshotDir,
          preparedHtmlDir,
          statePath,
        });
        recordedSegments.push(recordedSegment);
      }
    } finally {
      await preparationContext?.close().catch(() => undefined);
    }

    return {
      ...timeline,
      segments: recordedSegments,
    };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

async function recordSegment({
  browser,
  preparationContext,
  preparationPage,
  segment,
  config,
  videoDir,
  screenshotDir,
  preparedHtmlDir,
  statePath,
}: {
  browser: Browser;
  preparationContext: BrowserContext;
  preparationPage: Page;
  segment: TimelineSegment;
  config: VideoGeneratorConfig;
  videoDir: string;
  screenshotDir: string;
  preparedHtmlDir: string;
  statePath: string;
}): Promise<TimelineSegment> {
  let recordingContext: BrowserContext | undefined;
  const screenshotPath = join(screenshotDir, `${segment.id}.png`);
  const preparedHtmlPath = join(preparedHtmlDir, `${segment.id}.html`);

  let currentAction: TimelineSegment['actions'][number] | undefined;

  try {
    for (const action of segment.actions) {
      currentAction = action;
      await executeBrowserAction(preparationPage, action, config.actionTimeoutMs);
    }

    await waitForPageStable(preparationPage, config.actionTimeoutMs);
    await preparationContext.storageState({ path: statePath });

    recordingContext = await browser.newContext({
      viewport: config.viewport,
      storageState: statePath,
      recordVideo: { dir: videoDir, size: config.viewport },
    });
    const recordingPage = await recordingContext.newPage();
    const preparedHtml = await showPreparedPage(recordingPage, preparationPage, config.actionTimeoutMs);
    await writeFile(preparedHtmlPath, preparedHtml);

    await recordingPage.waitForTimeout(calculateSegmentDurationMs({
      estimatedMs: segment.estimatedDurationMs,
      actualAudioMs: segment.actualAudioDurationMs,
      bufferMs: segment.bufferMs,
    }));

    const video = recordingPage.video();
    await recordingContext.close();
    recordingContext = undefined;

    if (video === null) {
      throw new VideoGeneratorError('UNSUPPORTED_SCRIPT_ACTION', 'Playwright did not attach a video recorder to the page.');
    }

    return {
      ...segment,
      assets: {
        ...segment.assets,
        clipPath: await video.path(),
        preparedHtmlPath,
      },
    };
  } catch (error) {
    const screenshotCaptured = await captureFailureScreenshot(preparationPage, screenshotPath);
    await recordingContext?.close().catch(() => undefined);

    const screenshotMessage = screenshotCaptured
      ? `screenshot saved to ${screenshotPath}`
      : `screenshot capture failed for ${screenshotPath}`;

    throw new VideoGeneratorError(
      error instanceof VideoGeneratorError ? error.code : 'UNSUPPORTED_SCRIPT_ACTION',
      `Failed to record segment ${segment.id}; ${screenshotMessage}: ${errorMessage(error)}`,
      segment.id,
      error instanceof VideoGeneratorError ? error.failedAction ?? currentAction : currentAction,
    );
  }
}

async function waitForPageStable(page: Page, timeoutMs: number): Promise<void> {
  await page.waitForLoadState('domcontentloaded', { timeout: timeoutMs }).catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => undefined);
}

async function showPreparedPage(recordingPage: Page, preparationPage: Page, timeoutMs: number): Promise<string> {
  const preparedHtml = await snapshotPreparedHtml(preparationPage);
  const scrollX = await preparationPage.evaluate('window.scrollX');
  const scrollY = await preparationPage.evaluate('window.scrollY');

  await recordingPage.setContent(preparedHtml, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  await recordingPage.evaluate(`window.history.replaceState({}, '', ${JSON.stringify(preparationPage.url())})`).catch(() => undefined);
  await recordingPage.evaluate(`window.scrollTo(${JSON.stringify(scrollX)}, ${JSON.stringify(scrollY)})`).catch(() => undefined);

  return preparedHtml;
}

async function snapshotPreparedHtml(page: Page): Promise<string> {
  await page.evaluate(`
    document.querySelectorAll('input').forEach((input) => {
      if (input.type === 'checkbox' || input.type === 'radio') {
        input.toggleAttribute('checked', input.checked);
      } else {
        input.setAttribute('value', input.value);
      }
    });

    document.querySelectorAll('textarea').forEach((textarea) => {
      textarea.textContent = textarea.value;
    });

    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    document.documentElement.setAttribute('data-prepared-scroll-x', String(scrollX));
    document.documentElement.setAttribute('data-prepared-scroll-y', String(scrollY));

    document.head.querySelectorAll('base').forEach((base) => base.remove());
    const base = document.createElement('base');
    base.setAttribute('href', window.location.href);
    document.head.prepend(base);

    document.querySelectorAll('script').forEach((script) => script.remove());
  `);

  return page.content();
}

async function captureFailureScreenshot(page: Page, screenshotPath: string): Promise<boolean> {
  try {
    await page.screenshot({ path: screenshotPath, fullPage: true });
    return true;
  } catch {
    return false;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.split('\n')[0] : String(error);
}
