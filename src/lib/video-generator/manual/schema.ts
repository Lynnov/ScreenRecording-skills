import type { EditSource } from '../editing/types.js';
import {
  EXPECTED_EVENT_TYPES,
  EXPECTED_RESULT_TYPES,
  type AgentProducer,
  type ExpectedEvent,
  type ExpectedResult,
  type GuideAgentResponse,
  type ManualSource,
  type ManualSourceCatalog,
  type RecordingGuide,
  type RecordingGuideAction,
} from './types.js';

export const ALLOWED_EXPECTED_EVENT_TYPES = [...EXPECTED_EVENT_TYPES];
export const ALLOWED_EXPECTED_RESULT_TYPES = [...EXPECTED_RESULT_TYPES];

type UnknownRecord = Record<string, unknown>;

function fail(path: string, message: string): never {
  throw new Error(`${path} ${message}`);
}

function requireRecord(value: unknown, path: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, 'must be an object');
  }
  return value as UnknownRecord;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail(path, 'must be a non-empty string');
  }
  return value;
}

function requireOptionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  return requireString(value, path);
}

function requireFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(path, 'must be a finite number');
  }
  return value;
}

function requirePositiveNumber(value: unknown, path: string): number {
  const number = requireFiniteNumber(value, path);
  if (number <= 0) fail(path, 'must be greater than 0');
  return number;
}

function requirePositiveInteger(value: unknown, path: string): number {
  const number = requireFiniteNumber(value, path);
  if (!Number.isInteger(number) || number < 1) fail(path, 'must be a positive integer');
  return number;
}

function requireIsoDate(value: unknown, path: string): string {
  const text = requireString(value, path);
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) fail(path, 'must be an ISO date string');
  return text;
}

function requireStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) fail(path, 'must be an array');
  value.forEach((item, index) => requireString(item, `${path}[${index}]`));
  return value as string[];
}

function requireUrl(value: unknown, path: string): string {
  const text = requireString(value, path);
  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      fail(path, 'must be an http or https URL');
    }
  } catch {
    fail(path, 'must be a valid URL');
  }
  return text;
}

export function validateAgentProducer(value: unknown): asserts value is AgentProducer {
  const producer = requireRecord(value, 'producer');
  requireString(producer.agentId, 'producer.agentId');
  requireOptionalString(producer.provider, 'producer.provider');
  requireOptionalString(producer.model, 'producer.model');
  requireIsoDate(producer.generatedAt, 'producer.generatedAt');
}

function validateExpectedEvent(value: unknown, path: string): asserts value is ExpectedEvent {
  const event = requireRecord(value, path);
  const type = requireString(event.type, `${path}.type`);
  if (!EXPECTED_EVENT_TYPES.includes(type as never)) {
    fail(`${path}.type`, `must be one of ${EXPECTED_EVENT_TYPES.join(', ')}`);
  }
  requireOptionalString(event.target, `${path}.target`);
  requireOptionalString(event.description, `${path}.description`);
}

function validateExpectedResult(value: unknown, path: string): asserts value is ExpectedResult {
  const result = requireRecord(value, path);
  const type = requireString(result.type, `${path}.type`);
  if (!EXPECTED_RESULT_TYPES.includes(type as never)) {
    fail(`${path}.type`, `must be one of ${EXPECTED_RESULT_TYPES.join(', ')}`);
  }

  switch (type) {
    case 'dialog-visible':
      requireOptionalString(result.text, `${path}.text`);
      break;
    case 'text-visible':
      requireString(result.text, `${path}.text`);
      break;
    case 'url-matches':
      requireString(result.pattern, `${path}.pattern`);
      break;
    case 'element-state': {
      requireString(result.target, `${path}.target`);
      const state = requireString(result.state, `${path}.state`);
      if (!['visible', 'hidden', 'enabled', 'disabled'].includes(state)) {
        fail(`${path}.state`, 'must be visible, hidden, enabled, or disabled');
      }
      break;
    }
    case 'selected-value':
      requireString(result.target, `${path}.target`);
      requireString(result.value, `${path}.value`);
      break;
    case 'tab-created':
      requireOptionalString(result.title, `${path}.title`);
      requireOptionalString(result.urlPattern, `${path}.urlPattern`);
      break;
    default:
      fail(`${path}.type`, 'is unsupported');
  }
  requireOptionalString(result.description, `${path}.description`);
}

function validateGuideAction(value: unknown, path: string): RecordingGuideAction {
  const action = requireRecord(value, path);
  requireString(action.id, `${path}.id`);
  requireString(action.segmentId, `${path}.segmentId`);
  requireString(action.title, `${path}.title`);
  requireString(action.instruction, `${path}.instruction`);
  if (!Array.isArray(action.expectedEvents)) fail(`${path}.expectedEvents`, 'must be an array');
  action.expectedEvents.forEach((event, index) => validateExpectedEvent(event, `${path}.expectedEvents[${index}]`));
  if (!Array.isArray(action.expectedResults)) fail(`${path}.expectedResults`, 'must be an array');
  action.expectedResults.forEach((result, index) => validateExpectedResult(result, `${path}.expectedResults[${index}]`));
  return action as unknown as RecordingGuideAction;
}

export function validateRecordingGuide(value: unknown): asserts value is RecordingGuide {
  const guide = requireRecord(value, 'guide');
  if (guide.version !== 1) fail('guide.version', 'must equal 1');
  requireUrl(guide.startUrl, 'guide.startUrl');
  if (!Array.isArray(guide.actions) || guide.actions.length === 0) {
    fail('guide.actions', 'must be a non-empty array');
  }

  const ids = new Set<string>();
  guide.actions.forEach((item, index) => {
    const action = validateGuideAction(item, `guide.actions[${index}]`);
    if (ids.has(action.id)) fail(`guide.actions[${index}].id`, `duplicate action id "${action.id}"`);
    ids.add(action.id);
  });
}

function validateEditSourceFields(source: UnknownRecord, path: string): void {
  requireString(source.id, `${path}.id`);
  requireString(source.path, `${path}.path`);
  requirePositiveNumber(source.durationMs, `${path}.durationMs`);
  requirePositiveNumber(source.width, `${path}.width`);
  requirePositiveNumber(source.height, `${path}.height`);
  requirePositiveNumber(source.fps, `${path}.fps`);
  requireString(source.codecName, `${path}.codecName`);
  requireString(source.pixelFormat, `${path}.pixelFormat`);
  if (typeof source.hasAudio !== 'boolean') fail(`${path}.hasAudio`, 'must be a boolean');
}

export function validateEditSource(value: unknown, path = 'source'): asserts value is EditSource {
  validateEditSourceFields(requireRecord(value, path), path);
}

function validateManualSource(value: unknown, path: string): ManualSource {
  const source = requireRecord(value, path);
  if (source.kind !== 'original' && source.kind !== 'pickup') fail(`${path}.kind`, 'must be original or pickup');
  if (source.status !== 'available' && source.status !== 'failed' && source.status !== 'superseded') {
    fail(`${path}.status`, 'must be available, failed, or superseded');
  }
  if (source.status === 'failed') {
    requireString(source.failureReason, `${path}.failureReason`);
    const metadata = [
      source.durationMs,
      source.width,
      source.height,
      source.fps,
      source.codecName,
      source.pixelFormat,
      source.hasAudio,
    ];
    const hasNoProbe = metadata.every((item) => item === null);
    if (!hasNoProbe) validateEditSourceFields(source, path);
  } else {
    validateEditSourceFields(source, path);
  }
  requireIsoDate(source.createdAt, `${path}.createdAt`);

  if (source.kind === 'original') {
    if (source.segmentId !== null) fail(`${path}.segmentId`, 'must be null for original sources');
    if (source.attempt !== null) fail(`${path}.attempt`, 'must be null for original sources');
  } else {
    requireString(source.segmentId, `${path}.segmentId`);
    requirePositiveInteger(source.attempt, `${path}.attempt`);
  }
  return source as unknown as ManualSource;
}

export function validateManualSourceCatalog(value: unknown): asserts value is ManualSourceCatalog {
  const catalog = requireRecord(value, 'catalog');
  if (catalog.version !== 1) fail('catalog.version', 'must equal 1');
  if (!Array.isArray(catalog.sources)) fail('catalog.sources', 'must be an array');
  const ids = new Set<string>();
  catalog.sources.forEach((item, index) => {
    const source = validateManualSource(item, `catalog.sources[${index}]`);
    if (ids.has(source.id)) fail(`catalog.sources[${index}].id`, `duplicate source id "${source.id}"`);
    ids.add(source.id);
  });
}

export function validateGuideAgentResponse(value: unknown): asserts value is GuideAgentResponse {
  const response = requireRecord(value, 'response');
  if (response.version !== 1) fail('response.version', 'must equal 1');
  if (response.kind !== 'manual-guide-response') fail('response.kind', 'must equal manual-guide-response');
  requirePositiveInteger(response.requestVersion, 'response.requestVersion');
  validateAgentProducer(response.producer);
  requireString(response.polishedMarkdown, 'response.polishedMarkdown');
  requireString(response.executableMarkdown, 'response.executableMarkdown');
  validateRecordingGuide(response.guide);
  requireStringArray(response.warnings, 'response.warnings');
}
