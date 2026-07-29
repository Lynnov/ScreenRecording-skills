import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createGuideAgentRequest,
  validateGuideAgentRequest,
  validateGuideAgentResponseForRequest,
} from '../../src/lib/video-generator/manual/agent-exchange.js';
import type { GuideAgentResponse } from '../../src/lib/video-generator/manual/types.js';

const sourceText = '# 登录并填写表单\n\n打开页面后填写客户名。\n';
const generatedAt = '2026-07-28T00:00:00.000Z';

function validResponse(): GuideAgentResponse {
  return {
    version: 1,
    kind: 'manual-guide-response',
    requestVersion: 1,
    producer: { agentId: 'agent.fixture', generatedAt },
    polishedMarkdown: '# 登录并填写表单\n\n打开页面后填写客户名。\n',
    executableMarkdown: '# 登录并填写表单\n\n打开页面后填写客户名。\n',
    guide: {
      version: 1,
      startUrl: 'https://example.com/login',
      actions: [
        {
          id: 'action-001',
          segmentId: 'segment-001',
          title: '填写客户名',
          instruction: '在客户名输入框输入测试客户。',
          expectedEvents: [{ type: 'input', target: '客户名输入框' }],
          expectedResults: [{ type: 'text-visible', text: '测试客户' }],
        },
      ],
    },
    warnings: [],
  };
}

test('createGuideAgentRequest preserves source text and declares observer-only constraints', () => {
  const request = createGuideAgentRequest({
    sourceScriptPath: 'examples/manual-recording/basic-form.md',
    sourceText,
  });

  assert.deepEqual(request, {
    version: 1,
    kind: 'manual-guide-request',
    sourceScriptPath: 'examples/manual-recording/basic-form.md',
    sourceText,
    constraints: {
      observerOnly: true,
      manualTabSwitching: true,
      allowedExpectedEventTypes: ['click', 'input', 'change', 'scroll', 'navigation', 'tab'],
      allowedExpectedResultTypes: [
        'dialog-visible',
        'text-visible',
        'url-matches',
        'element-state',
        'selected-value',
        'tab-created',
      ],
    },
  });
  validateGuideAgentRequest(request);
});

test('validateGuideAgentRequest rejects invalid kind/version and weakened constraints', () => {
  const request = createGuideAgentRequest({ sourceScriptPath: 'demo.md', sourceText });

  assert.throws(() => validateGuideAgentRequest({ ...request, kind: 'manual-edit-request' }), /kind/);
  assert.throws(() => validateGuideAgentRequest({ ...request, version: 2 }), /version/);
  assert.throws(() => validateGuideAgentRequest({ ...request, sourceText: '' }), /sourceText/);
  assert.throws(() => validateGuideAgentRequest({
    ...request,
    constraints: { ...request.constraints, observerOnly: false },
  }), /observerOnly/);
  assert.throws(() => validateGuideAgentRequest({
    ...request,
    constraints: { ...request.constraints, allowedExpectedResultTypes: ['text-visible', 'unknown'] },
  }), /allowedExpectedResultTypes/);
});

test('validateGuideAgentResponseForRequest validates schema and matching request version', () => {
  const request = createGuideAgentRequest({ sourceScriptPath: 'demo.md', sourceText });
  const response = validResponse();

  validateGuideAgentResponseForRequest(response, request);

  assert.throws(() => validateGuideAgentResponseForRequest({ ...response, requestVersion: 2 }, request), /requestVersion/);
  assert.throws(() => validateGuideAgentResponseForRequest({ ...response, producer: { provider: 'missing' } }, request), /producer\.agentId/);
  assert.throws(() => validateGuideAgentResponseForRequest({
    ...response,
    guide: { ...response.guide, actions: [] },
  }, request), /actions/);
});
