import { calculateEditSegmentDurationMs } from '../editing/duration.js';
import type { EditPlan } from '../editing/types.js';
import type { FineEditWarning } from './fine-edit-events.js';
import type { FineEditResult } from './fine-edit-plan.js';
import type { FineEditRules } from './fine-edit-rules.js';

export interface FineEditFailure {
  code: 'MISSING_REQUIRED_EVENT';
  segmentId: string;
  message: string;
}

export interface FineEditSegmentQuality {
  segmentId: string;
  beforeDurationMs: number;
  afterDurationMs: number;
  audioDurationMs: number;
  silentTailMs: number;
  requiredEventCoverage: number;
}

export interface FineEditQualityReport {
  version: 1;
  status: 'passed' | 'warning' | 'failed';
  rulesVersion: number;
  requiredEventCoverage: number;
  beforeDurationMs: number;
  afterDurationMs: number;
  narrationDurationMs: number;
  segments: FineEditSegmentQuality[];
  warnings: FineEditWarning[];
  hardFailures: FineEditFailure[];
}

function planDuration(plan: EditPlan): number {
  return plan.segments.reduce((sum, segment) => sum + calculateEditSegmentDurationMs(segment), 0);
}

export function evaluateFineEditQuality(input: {
  beforePlan: EditPlan;
  fineResult: FineEditResult;
  audioDurationBySegment: ReadonlyMap<string, number>;
  rules: FineEditRules;
}): FineEditQualityReport {
  const beforeBySegment = new Map(input.beforePlan.segments.map((segment) => [segment.segmentId, segment]));
  const hardFailures: FineEditFailure[] = [];
  let requiredCount = 0;
  let coveredCount = 0;
  const segments = input.fineResult.plan.segments.map((segment): FineEditSegmentQuality => {
    const required = input.fineResult.requiredEventIdsBySegment[segment.segmentId] ?? [];
    const covered = new Set(segment.clips.flatMap((clip) => clip.evidenceEventIds ?? []));
    const missing = required.filter((id) => !covered.has(id));
    requiredCount += required.length;
    coveredCount += required.length - missing.length;
    for (const id of missing) hardFailures.push({
      code: 'MISSING_REQUIRED_EVENT',
      segmentId: segment.segmentId,
      message: `Required event ${id} is not covered by the fine plan.`,
    });
    const before = beforeBySegment.get(segment.segmentId);
    if (before === undefined) throw new Error(`Fine plan contains unknown Segment ${segment.segmentId}`);
    const beforeDurationMs = calculateEditSegmentDurationMs(before);
    const afterDurationMs = calculateEditSegmentDurationMs(segment);
    const audioDurationMs = input.audioDurationBySegment.get(segment.segmentId);
    if (audioDurationMs === undefined) throw new Error(`Missing audio duration for ${segment.segmentId}`);
    return {
      segmentId: segment.segmentId,
      beforeDurationMs,
      afterDurationMs,
      audioDurationMs,
      silentTailMs: Math.max(0, afterDurationMs - audioDurationMs),
      requiredEventCoverage: required.length === 0 ? 1 : (required.length - missing.length) / required.length,
    };
  });
  const warnings = [...input.fineResult.warnings];
  const status = hardFailures.length > 0 ? 'failed' : warnings.length > 0 ? 'warning' : 'passed';
  return {
    version: 1,
    status,
    rulesVersion: input.rules.version,
    requiredEventCoverage: requiredCount === 0 ? 1 : coveredCount / requiredCount,
    beforeDurationMs: planDuration(input.beforePlan),
    afterDurationMs: planDuration(input.fineResult.plan),
    narrationDurationMs: segments.reduce((sum, segment) => sum + segment.audioDurationMs, 0),
    segments,
    warnings,
    hardFailures,
  };
}
