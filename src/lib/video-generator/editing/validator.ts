import { calculateEditSegmentDurationMs } from './duration.js';
import type { EditClip, EditPlan, EditPlanSegment, EditSource } from './types.js';

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
  if (typeof value !== 'string') {
    fail(path, 'must be a string');
  }
  return value;
}

function requireFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(path, 'must be a finite number');
  }
  return value;
}

function validateSources(sources: readonly EditSource[]): Map<string, EditSource> {
  if (!Array.isArray(sources)) {
    fail('sources', 'must be an array');
  }
  const byId = new Map<string, EditSource>();
  sources.forEach((unknownSource: unknown, index) => {
    const path = `sources[${index}]`;
    const source = requireRecord(unknownSource, path);
    const id = requireString(source.id, `${path}.id`);
    if (byId.has(id)) {
      fail(`${path}.id`, `duplicates source id "${id}"`);
    }
    requireString(source.path, `${path}.path`);
    requireFiniteNumber(source.durationMs, `${path}.durationMs`);
    requireFiniteNumber(source.width, `${path}.width`);
    requireFiniteNumber(source.height, `${path}.height`);
    requireFiniteNumber(source.fps, `${path}.fps`);
    requireString(source.codecName, `${path}.codecName`);
    requireString(source.pixelFormat, `${path}.pixelFormat`);
    if (typeof source.hasAudio !== 'boolean') {
      fail(`${path}.hasAudio`, 'must be a boolean');
    }
    byId.set(id, source as unknown as EditSource);
  });
  return byId;
}

function validateClip(
  unknownClip: unknown,
  path: string,
  sources: ReadonlyMap<string, EditSource>,
): EditClip {
  const clip = requireRecord(unknownClip, path);
  const sourceId = requireString(clip.sourceId, `${path}.sourceId`);
  const source = sources.get(sourceId);
  if (source === undefined) {
    fail(`${path}.sourceId`, `references unknown source "${sourceId}"`);
  }
  const sourceStartMs = requireFiniteNumber(clip.sourceStartMs, `${path}.sourceStartMs`);
  const sourceEndMs = requireFiniteNumber(clip.sourceEndMs, `${path}.sourceEndMs`);
  const playbackRate = requireFiniteNumber(clip.playbackRate, `${path}.playbackRate`);
  if (sourceStartMs < 0) {
    fail(`${path}.sourceStartMs`, 'must be at least 0');
  }
  if (sourceEndMs <= sourceStartMs) {
    fail(`${path}.sourceEndMs`, 'must be greater than sourceStartMs');
  }
  if (sourceEndMs > source.durationMs) {
    fail(`${path}.sourceEndMs`, `exceeds source "${sourceId}" duration ${source.durationMs}ms`);
  }
  if (playbackRate < 1 || playbackRate > 2) {
    fail(`${path}.playbackRate`, 'must be between 1 and 2');
  }
  return clip as unknown as EditClip;
}

function validateSegment(
  unknownSegment: unknown,
  path: string,
  sources: ReadonlyMap<string, EditSource>,
): EditPlanSegment {
  const segment = requireRecord(unknownSegment, path);
  requireString(segment.segmentId, `${path}.segmentId`);
  requireString(segment.title, `${path}.title`);
  requireString(segment.reason, `${path}.reason`);
  if (segment.confidence !== 'high' && segment.confidence !== 'medium' && segment.confidence !== 'low') {
    fail(`${path}.confidence`, 'must be high, medium, or low');
  }
  if (!Array.isArray(segment.clips) || segment.clips.length === 0) {
    fail(`${path}.clips`, 'must be a non-empty array');
  }
  segment.clips.forEach((clip, index) => validateClip(clip, `${path}.clips[${index}]`, sources));
  if (segment.holdLastFrameMs !== undefined) {
    const hold = requireFiniteNumber(segment.holdLastFrameMs, `${path}.holdLastFrameMs`);
    if (hold < 0 || hold > 5000) {
      fail(`${path}.holdLastFrameMs`, 'must be between 0 and 5000');
    }
  }
  if (
    segment.transition !== undefined
    && segment.transition !== 'cut'
    && segment.transition !== 'short-fade'
  ) {
    fail(`${path}.transition`, 'must be cut or short-fade');
  }
  return segment as unknown as EditPlanSegment;
}

export function validateEditPlan(
  plan: unknown,
  sources: readonly EditSource[],
): asserts plan is EditPlan {
  const sourceById = validateSources(sources);
  const input = requireRecord(plan, 'plan');
  if (input.version !== 1) {
    fail('version', 'must equal 1');
  }

  const canvas = requireRecord(input.canvas, 'canvas');
  const width = requireFiniteNumber(canvas.width, 'canvas.width');
  const height = requireFiniteNumber(canvas.height, 'canvas.height');
  const fps = requireFiniteNumber(canvas.fps, 'canvas.fps');
  if (width !== 1920) fail('canvas.width', 'must equal 1920');
  if (height !== 1080) fail('canvas.height', 'must equal 1080');
  if (fps !== 30) fail('canvas.fps', 'must equal 30');

  if (!Array.isArray(input.segments)) {
    fail('segments', 'must be an array');
  }
  if (input.segments.length === 0) {
    fail('segments', 'must be a non-empty array');
  }
  const segments = input.segments.map((segment, index) => (
    validateSegment(segment, `segments[${index}]`, sourceById)
  ));
  const segmentIds = new Set<string>();
  segments.forEach((segment, index) => {
    if (segmentIds.has(segment.segmentId)) {
      fail(`segments[${index}].segmentId`, `duplicates segment id "${segment.segmentId}"`);
    }
    segmentIds.add(segment.segmentId);
  });

  segments.forEach((segment, index) => {
    if (segment.transition !== 'short-fade') return;
    if (index === segments.length - 1) {
      fail(`segments[${index}].transition`, 'short-fade requires a following segment');
    }
    if (calculateEditSegmentDurationMs(segment) <= 120) {
      fail(`segments[${index}].transition`, 'short-fade requires current segment duration greater than 120ms');
    }
    if (calculateEditSegmentDurationMs(segments[index + 1]!) <= 120) {
      fail(`segments[${index}].transition`, 'short-fade requires next segment duration greater than 120ms');
    }
  });
}
