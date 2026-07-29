import {
  ALLOWED_EXPECTED_EVENT_TYPES,
  ALLOWED_EXPECTED_RESULT_TYPES,
  validateGuideAgentResponse,
} from './schema.js';
import type { GuideAgentRequest, GuideAgentResponse } from './types.js';

interface CreateGuideAgentRequestInput {
  sourceScriptPath: string;
  sourceText: string;
}

type UnknownRecord = Record<string, unknown>;

function fail(path: string, message: string): never {
  throw new Error(`${path} ${message}`);
}

function requireRecord(value: unknown, path: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, 'must be an object');
  return value as UnknownRecord;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) fail(path, 'must be a non-empty string');
  return value;
}

function requireExactStringArray(value: unknown, expected: readonly string[], path: string): void {
  if (!Array.isArray(value)) fail(path, 'must be an array');
  if (value.length !== expected.length) fail(path, `must contain exactly ${expected.join(', ')}`);
  value.forEach((item, index) => {
    if (item !== expected[index]) fail(`${path}[${index}]`, `must equal ${expected[index]}`);
  });
}

export function createGuideAgentRequest(input: CreateGuideAgentRequestInput): GuideAgentRequest {
  return {
    version: 1,
    kind: 'manual-guide-request',
    sourceScriptPath: input.sourceScriptPath,
    sourceText: input.sourceText,
    constraints: {
      observerOnly: true,
      manualTabSwitching: true,
      allowedExpectedEventTypes: ALLOWED_EXPECTED_EVENT_TYPES,
      allowedExpectedResultTypes: ALLOWED_EXPECTED_RESULT_TYPES,
    },
  };
}

export function validateGuideAgentRequest(value: unknown): asserts value is GuideAgentRequest {
  const request = requireRecord(value, 'request');
  if (request.version !== 1) fail('request.version', 'must equal 1');
  if (request.kind !== 'manual-guide-request') fail('request.kind', 'must equal manual-guide-request');
  requireString(request.sourceScriptPath, 'request.sourceScriptPath');
  requireString(request.sourceText, 'request.sourceText');

  const constraints = requireRecord(request.constraints, 'request.constraints');
  if (constraints.observerOnly !== true) fail('request.constraints.observerOnly', 'must equal true');
  if (constraints.manualTabSwitching !== true) fail('request.constraints.manualTabSwitching', 'must equal true');
  requireExactStringArray(constraints.allowedExpectedEventTypes, ALLOWED_EXPECTED_EVENT_TYPES, 'request.constraints.allowedExpectedEventTypes');
  requireExactStringArray(constraints.allowedExpectedResultTypes, ALLOWED_EXPECTED_RESULT_TYPES, 'request.constraints.allowedExpectedResultTypes');
}

export function validateGuideAgentResponseForRequest(response: unknown, request: GuideAgentRequest): asserts response is GuideAgentResponse {
  validateGuideAgentRequest(request);
  validateGuideAgentResponse(response);
  if (response.requestVersion !== request.version) {
    fail('response.requestVersion', `must equal request version ${request.version}`);
  }
}
