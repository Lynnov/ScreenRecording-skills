import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

import { redactBrowserAction } from './action-redaction.js';
import { createRunArtifacts, ensureRunArtifactDirs } from './artifacts.js';
import { loadVideoGeneratorConfig, type VideoGeneratorConfigOverrides } from './config.js';
import { executeBrowserAction } from './browser/actions.js';
import { parseVideoScript } from './script-parser.js';
import { writeCandidateReport, writePreflightReport, type CandidateReport } from './report.js';
import { VideoGeneratorError, type ActionCandidateReport, type BrowserAction, type PreflightCheck, type PreflightReport, type Timeline, type VideoGeneratorConfig } from './types.js';

export interface RunPreflightDeps {
  readFile?: (filePath: string, encoding: BufferEncoding) => Promise<string>;
  fileExists?: (filePath: string) => Promise<boolean>;
  parseVideoScript?: (script: string, config: VideoGeneratorConfig) => Timeline;
  runBrowserActions?: (input: RunPreflightBrowserInput) => Promise<PreflightCheck[]>;
  writePreflightReport?: (report: PreflightReport) => Promise<string>;
  writeCandidateReport?: (report: CandidateReport) => Promise<string>;
}

export type PreflightActionExecutor = (page: Page, action: BrowserAction, timeoutMs: number) => Promise<Page>;

export interface RunPreflightInput {
  scriptPath: string;
  configOverrides?: VideoGeneratorConfigOverrides;
  deps?: RunPreflightDeps;
}

export interface RunPreflightBrowserInput {
  timeline: Timeline;
  config: VideoGeneratorConfig;
  outputDir: string;
  screenshotsDir: string;
  executeAction?: PreflightActionExecutor;
}

export async function runPreflight(input: RunPreflightInput): Promise<PreflightReport> {
  const config = loadVideoGeneratorConfig(input.configOverrides);
  const artifacts = createRunArtifacts(config.outputDir);
  const checks: PreflightCheck[] = [];
  const fileExists = input.deps?.fileExists ?? defaultFileExists;
  const writeReport = input.deps?.writePreflightReport ?? writePreflightReport;
  const writeCandidates = input.deps?.writeCandidateReport ?? writeCandidateReport;

  await ensureRunArtifactDirs(artifacts);

  try {
    const script = await (input.deps?.readFile ?? readFile)(input.scriptPath, 'utf8');
    checks.push({ name: 'script.read', status: 'passed', message: `已读取脚本：${input.scriptPath}` });

    const parseScript = input.deps?.parseVideoScript ?? parseVideoScript;
    const timeline = normalizeUploadFilePaths(parseScript(script, config), input.scriptPath);
    checks.push({ name: 'timeline.parse', status: 'passed', message: `已解析 ${timeline.segments.length} 个片段。` });

    if (config.storageStatePath !== undefined) {
      const storageStateExists = await fileExists(config.storageStatePath);
      if (!storageStateExists) {
        const report = makeReport({
          ok: false,
          outputDir: config.outputDir,
          scriptPath: input.scriptPath,
          storageStatePath: config.storageStatePath,
          checks: [
            ...checks,
            { name: 'storageState.exists', status: 'failed', message: `登录态文件不存在：${config.storageStatePath}` },
          ],
        });
        return writeAndReturn(report, writeReport, writeCandidates);
      }
      checks.push({ name: 'storageState.exists', status: 'passed', message: `登录态文件存在：${config.storageStatePath}` });
    } else {
      checks.push({ name: 'storageState.exists', status: 'skipped', message: '未配置登录态文件。' });
    }

    const missingUploadFile = await findMissingUploadFile(timeline, fileExists);
    if (missingUploadFile !== undefined) {
      const report = makeReport({
        ok: false,
        outputDir: config.outputDir,
        scriptPath: input.scriptPath,
        storageStatePath: config.storageStatePath,
        checks: [
          ...checks,
          {
            name: 'uploadFile.exists',
            status: 'failed',
            message: '上传文件不存在。',
            segmentId: missingUploadFile.segmentId,
            actionIndex: missingUploadFile.actionIndex,
          },
        ],
        failedSegmentId: missingUploadFile.segmentId,
        failedAction: redactBrowserAction(missingUploadFile.action),
      });
      return writeAndReturn(report, writeReport, writeCandidates);
    }
    checks.push({ name: 'uploadFile.exists', status: 'passed', message: '上传文件前置检查通过。' });

    const browserChecks = await (input.deps?.runBrowserActions ?? runPreflightBrowserActions)({
      timeline,
      config,
      outputDir: config.outputDir,
      screenshotsDir: artifacts.screenshotsDir,
    });
    const allChecks = [...checks, ...browserChecks];
    const failedCheck = allChecks.find((check) => check.status === 'failed');

    const report = makeReport({
      ok: failedCheck === undefined,
      outputDir: config.outputDir,
      scriptPath: input.scriptPath,
      storageStatePath: config.storageStatePath,
      checks: allChecks,
      failedSegmentId: failedCheck?.segmentId,
      failedAction: redactBrowserAction(failedCheck === undefined ? undefined : findActionByCheck(timeline, failedCheck)),
    });
    return writeAndReturn(report, writeReport, writeCandidates);
  } catch (error) {
    const failureCheck: PreflightCheck = {
      name: 'preflight.error',
      status: 'failed',
      message: error instanceof Error ? error.message : String(error),
      segmentId: extractSegmentId(error),
      candidates: extractCandidates(error),
    };
    const report = makeReport({
      ok: false,
      outputDir: config.outputDir,
      scriptPath: input.scriptPath,
      storageStatePath: config.storageStatePath,
      checks: [...checks, failureCheck],
      failedSegmentId: failureCheck.segmentId,
      failedAction: redactBrowserAction(extractFailedAction(error)),
    });
    return writeAndReturn(report, writeReport, writeCandidates);
  }
}

export async function runPreflightBrowserActions(input: RunPreflightBrowserInput): Promise<PreflightCheck[]> {
  const checks: PreflightCheck[] = [];
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let currentSegmentId: string | undefined;
  let currentAction: BrowserAction | undefined;
  let currentActionIndex: number | undefined;
  let currentCandidates: ActionCandidateReport[] | undefined;

  try {
    browser = await chromium.launch();
    context = await browser.newContext({
      viewport: input.config.viewport,
      storageState: input.config.storageStatePath,
    });
    page = await context.newPage();
    const executeAction = input.executeAction ?? executeBrowserAction;

    for (const segment of input.timeline.segments) {
      currentSegmentId = segment.id;
      for (const [actionIndex, action] of segment.actions.entries()) {
        currentAction = action;
        currentActionIndex = actionIndex;
        if (action.type === 'uploadFile') {
          currentCandidates = undefined;
          checks.push({
            name: 'uploadFile.exists',
            status: 'passed',
            message: '上传文件存在，已跳过浏览器上传执行。',
            segmentId: segment.id,
            actionIndex,
          });
          continue;
        }

        currentCandidates = await captureActionCandidates(page);
        page = await executeAction(page, action, input.config.actionTimeoutMs);
        await page.waitForLoadState('domcontentloaded', { timeout: input.config.actionTimeoutMs }).catch(() => undefined);
        currentCandidates = await captureActionCandidates(page) ?? currentCandidates;
        checks.push({
          name: 'browser.action',
          status: 'passed',
          message: `动作执行通过：${action.type}`,
          segmentId: segment.id,
          actionIndex,
        });
      }
    }

    return checks;
  } catch (error) {
    const screenshotPath = currentSegmentId === undefined
      ? undefined
      : path.join(input.screenshotsDir, `${currentSegmentId}-preflight.png`);
    const screenshotCaptured = page !== undefined && screenshotPath !== undefined
      ? await captureScreenshot(page, screenshotPath)
      : false;

    const existingCandidates = extractCandidates(error);
    const candidates = existingCandidates ?? (page === undefined ? undefined : await captureActionCandidates(page) ?? currentCandidates);

    return [{
      name: 'browser.action',
      status: 'failed',
      message: error instanceof Error ? error.message : String(error),
      segmentId: currentSegmentId,
      actionIndex: currentActionIndex,
      screenshotPath: screenshotCaptured ? screenshotPath : undefined,
      candidates,
    }];
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}

export function resolveUploadFilePath(scriptPath: string, uploadPath: string): string {
  return path.isAbsolute(uploadPath) ? uploadPath : path.resolve(path.dirname(scriptPath), uploadPath);
}

function normalizeUploadFilePaths(timeline: Timeline, scriptPath: string): Timeline {
  return {
    ...timeline,
    segments: timeline.segments.map((segment) => ({
      ...segment,
      actions: segment.actions.map((action) => (action.type === 'uploadFile'
        ? { ...action, path: resolveUploadFilePath(scriptPath, action.path) }
        : action)),
    })),
  };
}

async function findMissingUploadFile(
  timeline: Timeline,
  fileExists: (filePath: string) => Promise<boolean>,
): Promise<{ segmentId: string; actionIndex: number; filePath: string; action: BrowserAction } | undefined> {
  for (const segment of timeline.segments) {
    for (const [actionIndex, action] of segment.actions.entries()) {
      const filePath = readUploadFilePath(action);
      if (filePath !== undefined && !(await fileExists(filePath))) {
        return { segmentId: segment.id, actionIndex, filePath, action };
      }
    }
  }

  return undefined;
}

function readUploadFilePath(action: BrowserAction): string | undefined {
  const maybeUpload = action as BrowserAction & { type: string; path?: unknown };
  return maybeUpload.type === 'uploadFile' && typeof maybeUpload.path === 'string' && maybeUpload.path.length > 0
    ? maybeUpload.path
    : undefined;
}

function extractSegmentId(error: unknown): string | undefined {
  if (error instanceof VideoGeneratorError) {
    return error.segmentId;
  }

  return readStringProperty(error, 'segmentId');
}

function extractFailedAction(error: unknown): BrowserAction | undefined {
  if (error instanceof VideoGeneratorError) {
    return redactBrowserAction(error.failedAction);
  }

  const failedAction = readObjectProperty(error, 'failedAction');
  return redactBrowserAction(failedAction as BrowserAction | undefined);
}

function extractCandidates(error: unknown): ActionCandidateReport[] | undefined {
  if (error instanceof VideoGeneratorError && Array.isArray(error.candidates)) {
    return error.candidates;
  }

  return undefined;
}

function readObjectProperty(value: unknown, property: string): object | undefined {
  if (typeof value !== 'object' || value === null || !(property in value)) {
    return undefined;
  }

  const propertyValue = (value as Record<string, unknown>)[property];
  return typeof propertyValue === 'object' && propertyValue !== null ? propertyValue : undefined;
}

function readStringProperty(value: unknown, property: string): string | undefined {
  if (typeof value !== 'object' || value === null || !(property in value)) {
    return undefined;
  }

  const propertyValue = (value as Record<string, unknown>)[property];
  return typeof propertyValue === 'string' && propertyValue.length > 0 ? propertyValue : undefined;
}

function findActionByCheck(timeline: Timeline, check: PreflightCheck): BrowserAction | undefined {
  if (check.segmentId === undefined || check.actionIndex === undefined) {
    return undefined;
  }

  return timeline.segments.find((segment) => segment.id === check.segmentId)?.actions[check.actionIndex];
}

async function captureActionCandidates(page: Page): Promise<ActionCandidateReport[] | undefined> {
  try {
    const candidates = await page.evaluate(`(() => {
      const escapeAttribute = (value) => String(value).replaceAll('\\\\', '\\\\\\\\').replaceAll('"', '\\\\"');
      const elements = Array.from(document.querySelectorAll('button, a, input, textarea, select, [role], [aria-label], [placeholder]'));

      return elements.slice(0, 50).map((element) => {
        const text = (element.innerText || '').trim();
        const id = element.id ? '#' + escapeAttribute(element.id) : undefined;
        const dataTestId = element.getAttribute('data-testid');
        const testIdSelector = dataTestId === null ? undefined : '[data-testid="' + escapeAttribute(dataTestId) + '"]';
        const name = element.getAttribute('name');
        const nameSelector = name === null ? undefined : element.tagName.toLowerCase() + '[name="' + escapeAttribute(name) + '"]';

        return {
          tagName: element.tagName.toLowerCase(),
          text: text.length === 0 ? undefined : text.slice(0, 120),
          role: element.getAttribute('role') || undefined,
          ariaLabel: element.getAttribute('aria-label') || undefined,
          placeholder: element.getAttribute('placeholder') || undefined,
          selector: id || testIdSelector || nameSelector,
        };
      });
    })()`);

    return Array.isArray(candidates) && candidates.length > 0 ? candidates as ActionCandidateReport[] : undefined;
  } catch {
    return undefined;
  }
}

async function captureScreenshot(page: Page, screenshotPath: string): Promise<boolean> {
  try {
    await page.screenshot({ path: screenshotPath, fullPage: true });
    return true;
  } catch {
    return false;
  }
}

async function defaultFileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function makeReport(report: PreflightReport): PreflightReport {
  return report;
}

async function writeAndReturn(
  report: PreflightReport,
  writeReport: (report: PreflightReport) => Promise<string>,
  writeCandidates: (report: CandidateReport) => Promise<string>,
): Promise<PreflightReport> {
  const preflightReportPath = await writeReport(report);
  const reportWithPath = { ...report, preflightReportPath };
  if (reportWithPath.checks.some((check) => check.candidates !== undefined && check.candidates.length > 0)) {
    await writeCandidates({
      outputDir: reportWithPath.outputDir,
      checks: reportWithPath.checks.filter((check) => check.candidates !== undefined && check.candidates.length > 0),
    });
  }
  return reportWithPath;
}
