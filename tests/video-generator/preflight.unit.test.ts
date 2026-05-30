import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runPreflightChecks } from '../../src/lib/video-generator/preflight.js';
import type { Timeline } from '../../src/lib/video-generator/types.js';

test('runPreflightChecks reports matched stage scope and anchors', async () => {
  const timeline = makeTimeline({
    stages: [
      { name: 'orderEntry.createDialog', scope: '.el-dialog', anchors: ['text=新增订单', '[data-testid="customer"]'] },
    ],
  });
  const page = makePage({
    '.el-dialog': 1,
    '.el-dialog >> text=新增订单': 1,
    '.el-dialog >> [data-testid="customer"]': 2,
  });

  const result = await runPreflightChecks({ timeline, outputDir: makeOutputDir(), page });

  assert.equal(result.ok, true);
  assert.deepEqual(result.stageDiagnostics, [
    {
      stageName: 'orderEntry.createDialog',
      scope: '.el-dialog',
      scopeMatched: true,
      scopeCount: 1,
      matched: true,
      anchors: [
        { selector: 'text=新增订单', matched: true, count: 1 },
        { selector: '[data-testid="customer"]', matched: true, count: 2 },
      ],
      missingAnchors: [],
    },
  ]);
});

test('runPreflightChecks fails when a stage anchor is missing', async () => {
  const timeline = makeTimeline({
    stages: [
      { name: 'orderEntry.createDialog', scope: '.el-dialog', anchors: ['text=新增订单', '[data-testid="missing"]'] },
    ],
  });
  const page = makePage({
    '.el-dialog': 1,
    '.el-dialog >> text=新增订单': 1,
    '.el-dialog >> [data-testid="missing"]': 0,
  });

  const result = await runPreflightChecks({ timeline, outputDir: makeOutputDir(), page });

  assert.equal(result.ok, false);
  assert.equal(result.checks.some((check) => !check.ok && check.stageName === 'orderEntry.createDialog' && check.message.includes('[data-testid="missing"]')), true);
  assert.deepEqual(result.stageDiagnostics[0]?.missingAnchors, ['[data-testid="missing"]']);
});

test('runPreflightChecks reports missing scope before stage anchors', async () => {
  const timeline = makeTimeline({
    stages: [
      { name: 'orderEntry.createDialog', scope: '.el-dialog', anchors: ['text=新增订单', '[data-testid="customer"]'] },
    ],
  });
  const page = makePage({
    '.el-dialog': 0,
  });

  const result = await runPreflightChecks({ timeline, outputDir: makeOutputDir(), page });

  assert.equal(result.ok, false);
  assert.equal(result.stageDiagnostics[0]?.scopeMatched, false);
  assert.equal(result.stageDiagnostics[0]?.scopeCount, 0);
  assert.deepEqual(result.stageDiagnostics[0]?.missingAnchors, ['text=新增订单', '[data-testid="customer"]']);
  assert.equal(result.checks[0]?.message.includes('missing scope: .el-dialog'), true);
  assert.equal(result.checks[0]?.message.includes('missing anchors: text=新增订单, [data-testid="customer"]'), true);
});

test('runPreflightChecks remains compatible with timelines without stages', async () => {
  const timeline = makeTimeline({});

  const result = await runPreflightChecks({ timeline, outputDir: makeOutputDir(), page: makePage({}) });

  assert.equal(result.ok, true);
  assert.deepEqual(result.stageDiagnostics, []);
});

function makeTimeline(overrides: Partial<Timeline>): Timeline {
  return {
    version: 1,
    title: 'Preflight demo',
    segments: [],
    ...overrides,
  };
}

function makeOutputDir(): string {
  return path.join(tmpdir(), `preflight-${process.pid}-${Date.now()}`);
}

function makePage(counts: Record<string, number>) {
  return {
    locator(selector: string) {
      return {
        count: async () => counts[selector] ?? 0,
      };
    },
  };
}
