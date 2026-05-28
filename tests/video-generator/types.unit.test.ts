import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { PreflightReport, RunReport, ScriptDraftManifest, ScriptDraftRole, Timeline, VideoGeneratorMode, PreflightCheckStatus } from '../../src/lib/video-generator/types.js';

test('timeline supports Phase 3 browser action types', () => {
  const actions: Timeline['segments'][number]['actions'] = [
    { type: 'hover', text: '原纸贸易', waitFor: { type: 'text', value: '订单录入' } },
    { type: 'remoteSelect', text: '客户名称', query: '测试', selectFirst: true },
    { type: 'remoteSelect', selector: '.customer-select', query: '测试', option: '张三公司' },
    { type: 'selectFirst', text: '收货地址' },
    { type: 'uploadFile', selector: 'input[type=file]', path: 'fixtures/contracts/demo.pdf' },
  ];

  assert.deepEqual(actions.map((action) => action.type), ['hover', 'remoteSelect', 'remoteSelect', 'selectFirst', 'uploadFile']);
});

test('timeline supports top-level continuous recording assets', () => {
  const timeline: Timeline = {
    version: 1,
    title: 'Continuous recording',
    assets: { continuousClipPath: '/clips/full.webm' },
    segments: [
      {
        id: 'seg-001',
        sourceText: 'source',
        narration: 'narration',
        subtitle: 'subtitle',
        actions: [
          { type: 'waitFor', target: { type: 'selector', value: '.ready' } },
          { type: 'scrollTo', target: { type: 'selector', value: '.card' } },
        ],
        estimatedDurationMs: 1000,
        bufferMs: 0,
        assets: {},
      },
    ],
  };

  assert.equal(timeline.assets?.continuousClipPath, '/clips/full.webm');
  assert.equal(timeline.segments[0]?.actions[1]?.type, 'scrollTo');
});

test('script draft manifest type is serializable and protects business data', () => {
  const role: ScriptDraftRole = 'original';
  const manifest: ScriptDraftManifest = {
    version: 1,
    sourceScriptPath: '/source/script.md',
    createdAt: '2026-05-28T00:00:00.000Z',
    overwriteAllowed: false,
    businessDataProtectionNotice: '不要覆盖原始脚本，不要擅自修改业务测试数据。',
    protectedBusinessTerms: ['客户名', '地址选择策略', '上传文件路径'],
    drafts: {
      original: { role, path: '/run/scripts/original.md', sourcePath: '/source/script.md', overwriteAllowed: false },
      polished: { role: 'polished', path: '/run/scripts/polished.md', sourcePath: '/run/scripts/original.md', overwriteAllowed: true },
      executable: { role: 'executable', path: '/run/scripts/executable.md', sourcePath: '/run/scripts/polished.md', overwriteAllowed: true },
    },
    manifestPath: '/run/scripts/script-manifest.json',
  };

  const serialized = JSON.parse(JSON.stringify(manifest)) as ScriptDraftManifest;

  assert.equal(serialized.drafts.original.role, 'original');
  assert.equal(serialized.drafts.original.overwriteAllowed, false);
  assert.ok(serialized.protectedBusinessTerms.includes('客户名'));
});

test('preflight report types support dry-run failure details', () => {
  const mode: VideoGeneratorMode = 'dryRun';
  const status: PreflightCheckStatus = 'failed';
  const report: PreflightReport = {
    ok: false,
    outputDir: '/runs/preflight',
    scriptPath: '/scripts/demo.md',
    storageStatePath: '/auth/state.json',
    checks: [{
      name: 'browser.action',
      status,
      message: '按钮不存在',
      segmentId: 'seg-001',
      actionIndex: 0,
      screenshotPath: '/runs/preflight/screenshots/seg-001-preflight.png',
      candidates: [{ tagName: 'button', text: '候选按钮' }],
    }],
    failedSegmentId: 'seg-001',
    failedAction: { type: 'click', text: '提交' },
    preflightReportPath: '/runs/preflight/reports/preflight-report.json',
  };

  assert.equal(mode, 'dryRun');
  assert.equal(report.checks[0]?.status, 'failed');
  assert.equal(report.failedAction?.type, 'click');
});

test('run report can reference a preflight report path', () => {
  const report: RunReport = {
    ok: true,
    outputDir: '/runs/demo',
    preflightReportPath: '/runs/demo/reports/preflight-report.json',
    finalVideoPath: '/runs/demo/final.mp4',
  };

  assert.equal(report.preflightReportPath, '/runs/demo/reports/preflight-report.json');
});
