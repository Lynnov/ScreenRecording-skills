import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { resolveUploadFilePath, runPreflight, runPreflightBrowserActions } from '../../src/lib/video-generator/preflight.js';
import { VideoGeneratorError, type PreflightReport, type Timeline } from '../../src/lib/video-generator/types.js';

async function makeScriptFile(outputDir: string): Promise<string> {
  const scriptPath = path.join(outputDir, 'script.md');
  await writeFile(scriptPath, [
    '打开 http://127.0.0.1:4321/demo',
    '旁白：打开页面',
    '',
    '点击 开始',
    '旁白：点击按钮',
  ].join('\n'));
  return scriptPath;
}

test('runPreflight fails before browser actions when storage state is missing', async () => {
  const outputDir = path.join(tmpdir(), `preflight-storage-${process.pid}-${Date.now()}`);
  await mkdir(outputDir, { recursive: true });
  const scriptPath = await makeScriptFile(outputDir);
  let browserCalls = 0;

  try {
    const report = await runPreflight({
      scriptPath,
      configOverrides: { outputDir, storageStatePath: path.join(outputDir, 'missing-state.json') },
      deps: {
        fileExists: async () => false,
        runBrowserActions: async () => {
          browserCalls += 1;
          return [];
        },
      },
    });

    assert.equal(report.ok, false);
    assert.equal(browserCalls, 0);
    assert.match(report.checks.at(-1)?.message ?? '', /登录态文件不存在/);
    assert.equal(report.preflightReportPath, path.join(outputDir, 'reports', 'preflight-report.json'));
    assert.equal(existsSync(report.preflightReportPath), true);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('runPreflight executes injected browser dry-run without TTS or ffmpeg dependencies', async () => {
  const outputDir = path.join(tmpdir(), `preflight-success-${process.pid}-${Date.now()}`);
  await mkdir(outputDir, { recursive: true });
  const scriptPath = await makeScriptFile(outputDir);
  const browserSegments: string[] = [];

  try {
    const report = await runPreflight({
      scriptPath,
      configOverrides: { outputDir },
      deps: {
        runBrowserActions: async ({ timeline }) => {
          browserSegments.push(...timeline.segments.map((segment) => segment.id));
          return timeline.segments.flatMap((segment) => segment.actions.map((action, actionIndex) => ({
            name: 'browser.action',
            status: 'passed' as const,
            message: `ok:${action.type}`,
            segmentId: segment.id,
            actionIndex,
          })));
        },
      },
    });

    assert.equal(report.ok, true);
    assert.deepEqual(browserSegments, ['seg-001', 'seg-002']);
    assert.equal(existsSync(path.join(outputDir, 'scripts')), true);
    assert.equal(existsSync(path.join(outputDir, 'auth')), true);
    assert.equal(existsSync(path.join(outputDir, 'audio')), true);
    assert.equal(existsSync(path.join(outputDir, 'clips')), true);
    assert.equal(existsSync(path.join(outputDir, 'screenshots')), true);
    assert.equal(existsSync(path.join(outputDir, 'reports')), true);
    assert.equal(existsSync(path.join(outputDir, 'debug')), true);
    assert.equal(existsSync(path.join(outputDir, 'audio', 'seg-001.wav')), false);
    assert.equal(existsSync(path.join(outputDir, 'clips', 'seg-001.webm')), false);
    assert.equal(existsSync(path.join(outputDir, 'final.mp4')), false);

    const written = JSON.parse(await readFile(report.preflightReportPath ?? '', 'utf8')) as PreflightReport;
    assert.equal(written.ok, true);
    assert.equal(written.checks.some((check) => check.name === 'browser.action'), true);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('runPreflight redacts sensitive failed action fields in reports', async () => {
  const outputDir = path.join(tmpdir(), `preflight-redacted-action-${process.pid}-${Date.now()}`);
  await mkdir(outputDir, { recursive: true });
  const scriptPath = path.join(outputDir, 'script.md');
  const query = '测试客户-敏感';
  const option = '张三公司-敏感';
  await writeFile(scriptPath, [
    '旁白：远程选择客户',
    `远程选择 客户名称 ${query} 选择 ${option}`,
  ].join('\n'));

  try {
    const report = await runPreflight({
      scriptPath,
      configOverrides: { outputDir },
      deps: {
        runBrowserActions: async () => [{
          name: 'browser.action',
          status: 'failed',
          message: 'remote select failed',
          segmentId: 'seg-001',
          actionIndex: 0,
        }],
      },
    });
    const reportText = await readFile(report.preflightReportPath ?? '', 'utf8');

    assert.equal(report.ok, false);
    assert.deepEqual(report.failedAction, { type: 'remoteSelect', text: '客户名称', query: '[redacted]', option: '[redacted]' });
    assert.equal(reportText.includes(query), false);
    assert.equal(reportText.includes(option), false);
    assert.equal(reportText.includes('[redacted]'), true);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('runPreflight reports browser action failures with segment and action details', async () => {
  const outputDir = path.join(tmpdir(), `preflight-browser-failure-${process.pid}-${Date.now()}`);
  await mkdir(outputDir, { recursive: true });
  const scriptPath = await makeScriptFile(outputDir);

  try {
    const report = await runPreflight({
      scriptPath,
      configOverrides: { outputDir },
      deps: {
        runBrowserActions: async () => [{
          name: 'browser.action',
          status: 'failed',
          message: 'Missing button',
          segmentId: 'seg-002',
          actionIndex: 0,
          screenshotPath: path.join(outputDir, 'screenshots', 'seg-002-preflight.png'),
        }],
      },
    });

    assert.equal(report.ok, false);
    assert.equal(report.failedSegmentId, 'seg-002');
    assert.deepEqual(report.failedAction, { type: 'click', text: '开始' });
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('runPreflight default browser failure captures real page candidates and writes candidate report', async () => {
  const outputDir = path.join(tmpdir(), `preflight-real-candidates-${process.pid}-${Date.now()}`);
  await mkdir(outputDir, { recursive: true });
  const scriptPath = path.join(outputDir, 'script.md');
  const pageHtml = '<button id="save">保存</button><input placeholder="客户名称" /><a href="#details">详情</a>';
  await writeFile(scriptPath, [
    '旁白：打开页面',
    `打开 data:text/html;charset=utf-8,${encodeURIComponent(pageHtml)}`,
    '',
    '旁白：点击不存在按钮',
    '点击 不存在按钮',
  ].join('\n'));

  try {
    const report = await runPreflight({
      scriptPath,
      configOverrides: { outputDir, actionTimeoutMs: 300 },
    });
    const failedCheck = report.checks.find((check) => check.status === 'failed');
    const candidateReportPath = path.join(outputDir, 'reports', 'candidate-report.json');
    const written = JSON.parse(await readFile(candidateReportPath, 'utf8')) as { checks: Array<{ candidates?: Array<{ text?: string; placeholder?: string; selector?: string }> }> };

    assert.equal(report.ok, false);
    assert.equal(report.failedSegmentId, 'seg-002');
    assert.ok((failedCheck?.candidates?.length ?? 0) > 0);
    assert.equal(failedCheck?.candidates?.some((candidate) => candidate.text === '保存' || candidate.placeholder === '客户名称'), true);
    assert.equal(existsSync(candidateReportPath), true);
    assert.equal(written.checks[0]?.candidates?.some((candidate) => candidate.selector === '#save'), true);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('runPreflight candidate reports do not include filled input values', async () => {
  const outputDir = path.join(tmpdir(), `preflight-private-candidates-${process.pid}-${Date.now()}`);
  await mkdir(outputDir, { recursive: true });
  const scriptPath = path.join(outputDir, 'script.md');
  const passwordValue = 'SuperSecret-Token-123';
  const businessValue = 'customer@example.test';
  const pageHtml = [
    '<label>密码<input id="password" name="password" type="password" placeholder="请输入密码" /></label>',
    '<label>客户邮箱<input id="customer-email" name="customerEmail" placeholder="客户邮箱" /></label>',
    '<button id="save">保存</button>',
  ].join('');
  await writeFile(scriptPath, [
    '旁白：打开页面',
    `打开 data:text/html;charset=utf-8,${encodeURIComponent(pageHtml)}`,
    '',
    '旁白：填写密码',
    `在选择器 #password 输入 ${passwordValue}`,
    '',
    '旁白：填写业务字段',
    `在选择器 #customer-email 输入 ${businessValue}`,
    '',
    '旁白：点击不存在按钮',
    '点击 不存在按钮',
  ].join('\n'));

  try {
    const report = await runPreflight({
      scriptPath,
      configOverrides: { outputDir, actionTimeoutMs: 300 },
    });
    const candidateReportPath = path.join(outputDir, 'reports', 'candidate-report.json');
    const preflightReportText = await readFile(report.preflightReportPath ?? '', 'utf8');
    const candidateReportText = await readFile(candidateReportPath, 'utf8');
    const failedCheck = report.checks.find((check) => check.status === 'failed');

    assert.equal(report.ok, false);
    assert.equal(preflightReportText.includes(passwordValue), false);
    assert.equal(preflightReportText.includes(businessValue), false);
    assert.equal(candidateReportText.includes(passwordValue), false);
    assert.equal(candidateReportText.includes(businessValue), false);
    assert.equal(failedCheck?.candidates?.some((candidate) => candidate.placeholder === '请输入密码' && candidate.selector === '#password'), true);
    assert.equal(failedCheck?.candidates?.some((candidate) => candidate.placeholder === '客户邮箱' && candidate.selector === '#customer-email'), true);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('runPreflight supports injected candidate report writer', async () => {
  const outputDir = path.join(tmpdir(), `preflight-candidate-writer-${process.pid}-${Date.now()}`);
  await mkdir(outputDir, { recursive: true });
  const scriptPath = await makeScriptFile(outputDir);
  const candidates = [{ tagName: 'button', role: 'button', text: '保存' }];
  let candidateWriteCalls = 0;

  try {
    const report = await runPreflight({
      scriptPath,
      configOverrides: { outputDir },
      deps: {
        runBrowserActions: async () => [{
          name: 'browser.action',
          status: 'failed',
          message: 'Missing target',
          segmentId: 'seg-001',
          actionIndex: 0,
          candidates,
        }],
        writeCandidateReport: async (candidateReport) => {
          candidateWriteCalls += 1;
          assert.equal(candidateReport.outputDir, outputDir);
          assert.deepEqual(candidateReport.checks[0]?.candidates, candidates);
          return path.join(outputDir, 'reports', 'custom-candidate-report.json');
        },
      },
    });

    assert.equal(report.ok, false);
    assert.equal(candidateWriteCalls, 1);
    assert.equal(existsSync(path.join(outputDir, 'reports', 'candidate-report.json')), false);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('runPreflight browser action failure omits candidates when none are provided', async () => {
  const outputDir = path.join(tmpdir(), `preflight-no-candidates-${process.pid}-${Date.now()}`);
  await mkdir(path.join(outputDir, 'screenshots'), { recursive: true });
  const timeline: Timeline = {
    version: 1,
    title: 'no candidates',
    segments: [{
      id: 'seg-001',
      sourceText: 'source',
      narration: 'narration',
      subtitle: 'narration',
      actions: [{ type: 'waitFor', target: { type: 'selector', value: '#missing' } }],
      estimatedDurationMs: 1000,
      bufferMs: 0,
      assets: {},
    }],
  };

  try {
    const checks = await runPreflightBrowserActions({
      timeline,
      config: {
        viewport: { width: 800, height: 600 },
        speechRateCharsPerMinute: 220,
        segmentBufferMs: 0,
        actionTimeoutMs: 100,
        ttsProvider: 'aliyun',
        subtitleMode: 'burn-in',
        outputDir,
      },
      outputDir,
      screenshotsDir: path.join(outputDir, 'screenshots'),
    });

    assert.equal(checks[0]?.status, 'failed');
    assert.equal(checks[0]?.candidates, undefined);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('runPreflight browser action failure passes through VideoGeneratorError candidates', async () => {
  const outputDir = path.join(tmpdir(), `preflight-candidates-${process.pid}-${Date.now()}`);
  await mkdir(path.join(outputDir, 'screenshots'), { recursive: true });
  const candidates = [{ tagName: 'button', role: 'button', text: '保存' }];
  const timeline: Timeline = {
    version: 1,
    title: 'candidates',
    segments: [{
      id: 'seg-001',
      sourceText: 'source',
      narration: 'narration',
      subtitle: 'narration',
      actions: [{ type: 'click', text: '提交' }],
      estimatedDurationMs: 1000,
      bufferMs: 0,
      assets: {},
    }],
  };

  try {
    const checks = await runPreflightBrowserActions({
      timeline,
      config: {
        viewport: { width: 800, height: 600 },
        speechRateCharsPerMinute: 220,
        segmentBufferMs: 0,
        actionTimeoutMs: 100,
        ttsProvider: 'aliyun',
        subtitleMode: 'burn-in',
        outputDir,
      },
      outputDir,
      screenshotsDir: path.join(outputDir, 'screenshots'),
      executeAction: async () => {
        throw new VideoGeneratorError('INVALID_CLICK_TARGET', 'missing 保存', 'seg-001', { type: 'click', text: '提交' }, candidates);
      },
    });

    assert.equal(checks[0]?.status, 'failed');
    assert.deepEqual(checks[0]?.candidates, candidates);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('resolveUploadFilePath resolves relative paths from script directory and preserves absolutes', () => {
  const scriptPath = path.join('C:', 'work tree', 'scripts', 'demo script.md');
  const relativePath = path.join('fixtures', 'contract file.pdf');
  const absolutePath = path.join(path.sep, 'tmp', 'contract file.pdf');

  assert.equal(resolveUploadFilePath(scriptPath, relativePath), path.resolve(path.dirname(scriptPath), relativePath));
  assert.equal(resolveUploadFilePath(scriptPath, absolutePath), absolutePath);
});

test('runPreflight checks real parsed upload file paths relative to script directory', async () => {
  const outputDir = path.join(tmpdir(), `preflight-real-upload-${process.pid}-${Date.now()}`);
  const scriptDir = path.join(outputDir, 'scripts with spaces');
  await mkdir(path.join(scriptDir, 'fixtures'), { recursive: true });
  const scriptPath = path.join(scriptDir, 'script.md');
  const uploadPath = path.join(scriptDir, 'fixtures', 'contract file.pdf');
  await writeFile(uploadPath, 'demo');
  await writeFile(scriptPath, [
    '旁白：上传合同',
    '上传文件 “合同 附件” “fixtures/contract file.pdf”',
  ].join('\n'));

  try {
    const report = await runPreflight({
      scriptPath,
      configOverrides: { outputDir },
    });

    const reportText = await readFile(report.preflightReportPath ?? '', 'utf8');

    assert.equal(report.ok, true);
    assert.equal(report.checks.some((check) => check.name === 'uploadFile.exists' && check.message === '上传文件存在，已跳过浏览器上传执行。'), true);
    assert.equal(reportText.includes(uploadPath), false);
    assert.equal(reportText.includes('contract file.pdf'), false);
    assert.equal(existsSync(path.join(outputDir, 'final.mp4')), false);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('runPreflight writes candidate report for failures with candidates', async () => {
  const outputDir = path.join(tmpdir(), `preflight-candidate-report-${process.pid}-${Date.now()}`);
  await mkdir(outputDir, { recursive: true });
  const scriptPath = await makeScriptFile(outputDir);
  const candidates = [{ tagName: 'button', role: 'button', text: '保存' }];

  try {
    const report = await runPreflight({
      scriptPath,
      configOverrides: { outputDir },
      deps: {
        runBrowserActions: async () => [{
          name: 'browser.action',
          status: 'failed',
          message: 'Missing target',
          segmentId: 'seg-001',
          actionIndex: 0,
          candidates,
        }],
      },
    });
    const candidateReportPath = path.join(outputDir, 'reports', 'candidate-report.json');
    const written = JSON.parse(await readFile(candidateReportPath, 'utf8')) as { candidateReportPath?: string; checks: Array<{ candidates?: unknown[] }> };

    assert.equal(report.ok, false);
    assert.equal(written.candidateReportPath, candidateReportPath);
    assert.deepEqual(written.checks[0]?.candidates, candidates);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('runPreflight preserves VideoGeneratorError details from parse failures', async () => {
  const outputDir = path.join(tmpdir(), `preflight-parse-error-${process.pid}-${Date.now()}`);
  await mkdir(outputDir, { recursive: true });
  const scriptPath = await makeScriptFile(outputDir);
  const failedAction = { type: 'click' as const, text: '提交' };
  const candidates = [{ tagName: 'button', role: 'button', text: '保存' }];

  try {
    const report = await runPreflight({
      scriptPath,
      configOverrides: { outputDir },
      deps: {
        parseVideoScript: () => {
          throw new VideoGeneratorError('INVALID_CLICK_TARGET', 'parse-time locator failed', 'seg-009', failedAction, candidates);
        },
      },
    });

    assert.equal(report.ok, false);
    assert.equal(report.failedSegmentId, 'seg-009');
    assert.deepEqual(report.failedAction, failedAction);
    assert.deepEqual(report.checks.at(-1)?.candidates, candidates);
    assert.equal(existsSync(path.join(outputDir, 'reports', 'candidate-report.json')), true);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('runPreflight skips uploadFile browser execution when the file exists', async () => {
  const outputDir = path.join(tmpdir(), `preflight-upload-exists-${process.pid}-${Date.now()}`);
  await mkdir(outputDir, { recursive: true });
  const scriptPath = await makeScriptFile(outputDir);
  const uploadPath = path.join(outputDir, 'sensitive contract file.pdf');
  await writeFile(uploadPath, 'demo');
  const timeline: Timeline = {
    version: 1,
    title: 'upload preflight',
    segments: [{
      id: 'seg-001',
      sourceText: 'source',
      narration: 'narration',
      subtitle: 'narration',
      actions: [{ type: 'uploadFile', selector: 'input[type=file]', path: uploadPath }],
      estimatedDurationMs: 1000,
      bufferMs: 0,
      assets: {},
    }],
  };

  try {
    const report = await runPreflight({
      scriptPath,
      configOverrides: { outputDir },
      deps: {
        parseVideoScript: () => timeline,
      },
    });

    const reportText = await readFile(report.preflightReportPath ?? '', 'utf8');

    assert.equal(report.ok, true);
    assert.equal(report.checks.some((check) => check.name === 'uploadFile.exists' && check.segmentId === 'seg-001' && check.message === '上传文件存在，已跳过浏览器上传执行。'), true);
    assert.equal(reportText.includes(uploadPath), false);
    assert.equal(reportText.includes('sensitive contract file.pdf'), false);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('runPreflight can stop on missing uploadFile paths from injected parser', async () => {
  const outputDir = path.join(tmpdir(), `preflight-upload-${process.pid}-${Date.now()}`);
  await mkdir(outputDir, { recursive: true });
  const scriptPath = await makeScriptFile(outputDir);
  const missingFilePath = path.join(outputDir, 'missing sensitive contract file.pdf');
  const timeline: Timeline = {
    version: 1,
    title: 'upload preflight',
    segments: [{
      id: 'seg-001',
      sourceText: 'source',
      narration: 'narration',
      subtitle: 'narration',
      actions: [{ type: 'uploadFile', selector: 'input[type=file]', path: missingFilePath }],
      estimatedDurationMs: 1000,
      bufferMs: 0,
      assets: {},
    }],
  };
  let browserCalls = 0;

  try {
    const report = await runPreflight({
      scriptPath,
      configOverrides: { outputDir },
      deps: {
        parseVideoScript: () => timeline,
        fileExists: async (filePath) => filePath !== missingFilePath,
        runBrowserActions: async () => {
          browserCalls += 1;
          return [];
        },
      },
    });

    const reportText = await readFile(report.preflightReportPath ?? '', 'utf8');

    assert.equal(report.ok, false);
    assert.equal(browserCalls, 0);
    assert.equal(report.failedSegmentId, 'seg-001');
    assert.equal(report.checks.at(-1)?.message, '上传文件不存在。');
    assert.equal(reportText.includes(missingFilePath), false);
    assert.equal(reportText.includes('missing sensitive contract file.pdf'), false);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
