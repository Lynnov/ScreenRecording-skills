import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { BrowserAction, RunReport, Timeline } from '../../src/lib/video-generator/types.js';

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

test('semantic browser actions preserve user intent and report candidates', () => {
  const actions: BrowserAction[] = [
    {
      type: 'semanticClick',
      target: { kind: 'button', name: 'Start recording' },
      waitFor: { type: 'text', value: 'Recording' },
    },
    {
      type: 'semanticFill',
      target: { kind: 'field', name: 'Email' },
      value: 'user@example.com',
      waitFor: { type: 'networkIdle' },
    },
    {
      type: 'semanticSelect',
      target: { kind: 'field', name: 'Plan' },
      option: 'Pro',
      waitFor: { type: 'selector', value: '.plan-ready' },
    },
    {
      type: 'semanticWaitFor',
      target: { kind: 'visibleText', name: 'Recording complete' },
    },
  ];

  const timeline: Timeline = {
    version: 1,
    title: 'Semantic recording',
    segments: [
      {
        id: 'seg-semantic',
        sourceText: 'source',
        narration: 'narration',
        subtitle: 'subtitle',
        actions,
        estimatedDurationMs: 1000,
        bufferMs: 0,
        assets: {
          resolvedActions: [
            {
              actionIndex: 0,
              strategy: 'semantic-accessibility-name',
              confidence: 'strong',
              role: 'button',
              name: 'Start recording',
              layer: 'dialog',
              selectorHint: 'button[aria-label="Start recording"]',
            },
          ],
        },
      },
    ],
  };

  const report: RunReport = {
    ok: false,
    outputDir: '/tmp/video-run',
    failedAction: actions[0],
    failureReason: 'AMBIGUOUS_TARGET',
    candidateReportPath: '/tmp/video-run/candidate-report.json',
    candidates: [
      {
        label: 'Dialog / Start recording',
        role: 'button',
        name: 'Start recording',
        layer: 'dialog',
        confidence: 'strong',
        selectorHint: 'button[aria-label="Start recording"]',
      },
    ],
  };

  assert.equal(actions[0]?.type, 'semanticClick');
  assert.deepEqual(actions[0]?.target, { kind: 'button', name: 'Start recording' });
  assert.equal(actions[1]?.type, 'semanticFill');
  assert.equal(actions[1]?.value, 'user@example.com');
  assert.equal(actions[2]?.type, 'semanticSelect');
  assert.equal(actions[2]?.option, 'Pro');
  assert.equal(actions[3]?.type, 'semanticWaitFor');
  assert.deepEqual(actions[3]?.target, { kind: 'visibleText', name: 'Recording complete' });
  assert.equal(timeline.segments[0]?.assets.resolvedActions?.[0]?.strategy, 'semantic-accessibility-name');
  assert.equal(timeline.segments[0]?.assets.resolvedActions?.[0]?.confidence, 'strong');
  assert.equal(report.failureReason, 'AMBIGUOUS_TARGET');
  assert.equal(report.candidateReportPath, '/tmp/video-run/candidate-report.json');
  assert.equal(report.candidates?.[0]?.layer, 'dialog');
  assert.equal(report.candidates?.[0]?.confidence, 'strong');
});
