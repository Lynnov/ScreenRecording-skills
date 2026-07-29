import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateExpectedResult, evaluateExpectedResults, type ManualResultSnapshot } from '../../src/lib/video-generator/manual/result-evaluator.js';
import type { ExpectedResult } from '../../src/lib/video-generator/manual/types.js';

const snapshot: ManualResultSnapshot = {
  url: 'https://example.com/orders/123?saved=1',
  dialogs: [{ text: '确认保存吗？' }],
  visibleTexts: ['订单保存成功', 'Pacdora 示例客户'],
  elements: [
    { target: '保存按钮', state: 'enabled' },
    { target: '客户名称', state: 'visible', selectedValue: 'Pacdora' },
  ],
  tabs: [{ title: '详情页', url: 'https://example.com/orders/123' }],
};

test('evaluates all supported first-version expected result types from observer snapshots', () => {
  const cases: ExpectedResult[] = [
    { type: 'dialog-visible', text: '确认保存' },
    { type: 'text-visible', text: '保存成功' },
    { type: 'url-matches', pattern: '/orders/\\d+' },
    { type: 'element-state', target: '保存按钮', state: 'enabled' },
    { type: 'selected-value', target: '客户名称', value: 'Pacdora' },
    { type: 'tab-created', title: '详情页' },
  ];

  for (const expected of cases) {
    const result = evaluateExpectedResult(expected, snapshot);
    assert.equal(result.matched, true, `${expected.type} should match`);
    assert.equal(result.evidence.length > 0, true);
  }
});

test('fails closed for unsupported or missing observer evidence without executing actions', () => {
  assert.equal(evaluateExpectedResult({ type: 'text-visible', text: '不存在' }, snapshot).matched, false);
  assert.equal(evaluateExpectedResult({ type: 'url-matches', pattern: '[' }, snapshot).matched, false);
  assert.equal(evaluateExpectedResult({ type: 'tab-created', urlPattern: 'missing' }, snapshot).matched, false);
});

test('evaluateExpectedResults reports aggregate match and per-result evidence', () => {
  const result = evaluateExpectedResults([
    { type: 'text-visible', text: '保存成功' },
    { type: 'selected-value', target: '客户名称', value: 'Pacdora' },
  ], snapshot);

  assert.equal(result.matched, true);
  assert.equal(result.results.length, 2);

  const failed = evaluateExpectedResults([
    { type: 'text-visible', text: '保存成功' },
    { type: 'selected-value', target: '客户名称', value: '不存在' },
  ], snapshot);
  assert.equal(failed.matched, false);
});
