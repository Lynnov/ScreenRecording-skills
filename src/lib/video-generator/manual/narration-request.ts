import type { PreviewTimeline } from '../editing/types.js';
import { validateAgentProducer } from './schema.js';
import type { AgentProducer, ExpectedResult, RecordingGuide } from './types.js';

export interface NarrationAgentRequestSegment {
  segmentId: string;
  availableDurationMs: number;
  semanticConstraints: {
    title: string;
    instruction: string;
    expectedResults: ExpectedResult[];
    preserveBusinessFacts: true;
  };
}

export interface NarrationAgentRequest {
  version: 1;
  kind: 'manual-narration-request';
  approvedGuide: RecordingGuide;
  effectivePreviewTimeline: PreviewTimeline;
  segments: NarrationAgentRequestSegment[];
  constraints: {
    preserveBusinessFacts: true;
    doNotInventActions: true;
    fitAvailableDuration: true;
  };
}

export interface NarrationAgentSegment {
  segmentId: string;
  text: string;
  estimatedDurationMs: number;
}

export interface NarrationAgentResponse {
  version: 1;
  kind: 'manual-narration-response';
  requestVersion: number;
  producer: AgentProducer;
  segments: NarrationAgentSegment[];
  warnings: string[];
}

export function createNarrationAgentRequest(input: {
  approvedGuide: RecordingGuide;
  effectivePreviewTimeline: PreviewTimeline;
}): NarrationAgentRequest {
  const actions = new Map<string, RecordingGuide['actions']>();
  for (const action of input.approvedGuide.actions) {
    actions.set(action.segmentId, [...(actions.get(action.segmentId) ?? []), action]);
  }
  const segments = input.effectivePreviewTimeline.segments.map((segment) => {
    const segmentActions = actions.get(segment.segmentId);
    if (segmentActions === undefined) throw new Error(`Preview Segment ${segment.segmentId} is missing from the approved guide.`);
    return {
      segmentId: segment.segmentId,
      availableDurationMs: segment.endsAtMs - segment.startsAtMs,
      semanticConstraints: {
        title: segmentActions.map((action) => action.title).join(' / '),
        instruction: segmentActions.map((action) => action.instruction).join('\n'),
        expectedResults: segmentActions.flatMap((action) => action.expectedResults),
        preserveBusinessFacts: true as const,
      },
    };
  });
  if (segments.length !== actions.size) throw new Error('Approved guide and effective preview timeline Segment sets differ.');
  return {
    version: 1,
    kind: 'manual-narration-request',
    approvedGuide: input.approvedGuide,
    effectivePreviewTimeline: input.effectivePreviewTimeline,
    segments,
    constraints: {
      preserveBusinessFacts: true,
      doNotInventActions: true,
      fitAvailableDuration: true,
    },
  };
}

export function validateNarrationAgentResponseForRequest(
  value: unknown,
  request: NarrationAgentRequest,
): asserts value is NarrationAgentResponse {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('response must be an object');
  const response = value as Record<string, unknown>;
  if (response.version !== 1) throw new Error('response.version must equal 1');
  if (response.kind !== 'manual-narration-response') throw new Error('response.kind must equal manual-narration-response');
  if (response.requestVersion !== request.version) throw new Error(`response.requestVersion must equal ${request.version}`);
  validateAgentProducer(response.producer);
  if (!Array.isArray(response.warnings) || !response.warnings.every((warning) => typeof warning === 'string')) {
    throw new Error('response.warnings must be a string array');
  }
  if (!Array.isArray(response.segments) || response.segments.length !== request.segments.length) {
    throw new Error('response.segments must contain exactly every requested Segment');
  }
  const seen = new Set<string>();
  response.segments.forEach((unknownSegment, index) => {
    if (typeof unknownSegment !== 'object' || unknownSegment === null || Array.isArray(unknownSegment)) {
      throw new Error(`response.segments[${index}] must be an object`);
    }
    const segment = unknownSegment as Record<string, unknown>;
    const expectedId = request.segments[index]!.segmentId;
    if (typeof segment.segmentId !== 'string') throw new Error(`response.segments[${index}].segmentId must be a string`);
    if (seen.has(segment.segmentId)) throw new Error(`response.segments[${index}].segmentId is duplicate`);
    seen.add(segment.segmentId);
    if (segment.segmentId !== expectedId) throw new Error(`response.segments[${index}].segmentId must preserve request order: ${expectedId}`);
    if (typeof segment.text !== 'string' || segment.text.trim().length === 0) throw new Error(`response.segments[${index}].text must be non-empty`);
    if (typeof segment.estimatedDurationMs !== 'number' || !Number.isFinite(segment.estimatedDurationMs) || segment.estimatedDurationMs <= 0) {
      throw new Error(`response.segments[${index}].estimatedDurationMs must be positive`);
    }
  });
}
