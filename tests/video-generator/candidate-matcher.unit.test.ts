import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchSemanticAction } from '../../src/lib/video-generator/browser/candidate-matcher.js';
import type { PageSnapshot, PageSnapshotCandidate } from '../../src/lib/video-generator/browser/page-snapshot.js';

function candidate(overrides: Partial<PageSnapshotCandidate>): PageSnapshotCandidate {
  return {
    role: 'button',
    name: '确认',
    text: '确认',
    selectorHint: 'button',
    state: {
      visible: true,
      enabled: true,
      editable: false,
    },
    layer: 'page',
    ...overrides,
  };
}

function snapshot(candidates: PageSnapshotCandidate[]): PageSnapshot {
  return {
    url: 'http://example.test',
    title: 'Example',
    capturedAt: '2026-05-25T00:00:00.000Z',
    candidates,
  };
}

test('matchSemanticAction returns dialog candidate when one strong match wins foreground layer priority', () => {
  const dialogCandidate = candidate({ name: '确认登录', text: '确认登录', layer: 'dialog', selectorHint: '#dialog-confirm' });

  const result = matchSemanticAction({
    type: 'semanticClick',
    target: { kind: 'button', name: '确认登录' },
  }, snapshot([
    candidate({ name: '确认登录', text: '确认登录', layer: 'page', selectorHint: '#page-confirm' }),
    dialogCandidate,
    candidate({ name: '确认登录', text: '确认登录', layer: 'toast', selectorHint: '#toast-confirm' }),
  ]));

  assert.equal(result.ok, true);
  assert.equal(result.candidate, dialogCandidate);
  assert.equal(result.confidence, 'strong');
  assert.equal(result.strategy, 'exact-role-layer');
  assert.deepEqual(result.candidates[0], {
    label: '确认登录',
    role: 'button',
    name: '确认登录',
    text: '确认登录',
    layer: 'dialog',
    confidence: 'strong',
    selectorHint: '#dialog-confirm',
  });
});

test('matchSemanticAction returns AMBIGUOUS_TARGET for multiple strong matches on same layer', () => {
  const result = matchSemanticAction({
    type: 'semanticClick',
    target: { kind: 'button', name: '保存' },
  }, snapshot([
    candidate({ name: '保存', text: '保存', layer: 'dialog', selectorHint: '#save-primary' }),
    candidate({ name: '保存', text: '保存', layer: 'dialog', selectorHint: '#save-secondary' }),
  ]));

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'AMBIGUOUS_TARGET');
  assert.equal(result.candidates.length, 2);
  assert.match(result.message, /保存/);
});

test('matchSemanticAction returns LOW_CONFIDENCE_TARGET when only weak contains matches exist', () => {
  const result = matchSemanticAction({
    type: 'semanticFill',
    target: { kind: 'field', name: '邮箱' },
    value: 'ada@example.test',
  }, snapshot([
    candidate({ role: 'textbox', name: '请输入邮箱地址', text: undefined, layer: 'page', state: { visible: true, enabled: true, editable: true } }),
  ]));

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'LOW_CONFIDENCE_TARGET');
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.confidence, 'weak');
  assert.match(result.message, /邮箱/);
});

test('matchSemanticAction does not treat a link as a button semantic click target', () => {
  const buttonCandidate = candidate({ name: '详情', text: '详情', role: 'button', layer: 'page', selectorHint: '#details-button' });

  const result = matchSemanticAction({
    type: 'semanticClick',
    target: { kind: 'button', name: '详情' },
  }, snapshot([
    candidate({ name: '详情', text: '详情', role: 'link', layer: 'dialog', selectorHint: '#details-link' }),
    buttonCandidate,
  ]));

  assert.equal(result.ok, true);
  assert.equal(result.candidate, buttonCandidate);
  assert.equal(result.candidates[0]?.role, 'button');
});

test('matchSemanticAction reports context in ambiguous candidate labels', () => {
  const result = matchSemanticAction({
    type: 'semanticClick',
    target: { kind: 'button', name: '登录' },
  }, snapshot([
    candidate({ name: '登录', text: '登录', layer: 'page', context: '顶部导航', selectorHint: '#header-login' }),
    candidate({ name: '登录', text: '登录', layer: 'page', context: '页脚', selectorHint: '#footer-login' }),
  ]));

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'AMBIGUOUS_TARGET');
  assert.deepEqual(result.candidates.map((item) => item.label), ['顶部导航 / 登录', '页脚 / 登录']);
});

test('matchSemanticAction allows a unique medium confidence exact semantic select entry', () => {
  const buttonEntry = candidate({ name: '分类', text: '分类', role: 'button', layer: 'page', selectorHint: '#category-trigger' });

  const result = matchSemanticAction({
    type: 'semanticSelect',
    target: { kind: 'field', name: '分类' },
    option: '礼盒',
  }, snapshot([
    buttonEntry,
  ]));

  assert.equal(result.ok, true);
  assert.equal(result.candidate, buttonEntry);
  assert.equal(result.confidence, 'medium');
});
