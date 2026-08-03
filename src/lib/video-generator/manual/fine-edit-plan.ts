import { calculateEditClipDurationMs } from '../editing/duration.js';
import type { EditClip, EditPlan, EditPlanSegment } from '../editing/types.js';
import { analyzeFineEditEvents, type FineEditEvent, type FineEditWarning } from './fine-edit-events.js';
import type { FineEditRules } from './fine-edit-rules.js';

export interface TimeInterval {
  startMs: number;
  endMs: number;
  confidence?: 'high' | 'low';
}

export interface FineEditResult {
  plan: EditPlan;
  warnings: FineEditWarning[];
  discardedEventIds: string[];
  requiredEventIdsBySegment: Record<string, string[]>;
}

interface Window extends TimeInterval {
  eventIds: string[];
  clipKind: 'context' | 'action' | 'result';
}

function eventText(event: FineEditEvent): string {
  return typeof event.target.text === 'string' ? event.target.text.trim() : '';
}

function mergeWindows(windows: Window[], maxGapMs: number): Window[] {
  const merged: Window[] = [];
  for (const window of windows.sort((left, right) => left.startMs - right.startMs)) {
    const previous = merged.at(-1);
    if (previous !== undefined && window.startMs - previous.endMs <= maxGapMs) {
      previous.endMs = Math.max(previous.endMs, window.endMs);
      previous.eventIds.push(...window.eventIds);
      if (window.clipKind === 'result') previous.clipKind = 'result';
    } else {
      merged.push({ ...window, eventIds: [...window.eventIds] });
    }
  }
  return merged;
}

function subtractBlank(
  windows: Window[],
  blanks: readonly TimeInterval[],
): Window[] {
  let result = windows;
  for (const blank of blanks.filter((interval) => interval.confidence !== 'low')) {
    result = result.flatMap((window): Window[] => {
      if (blank.endMs <= window.startMs || blank.startMs >= window.endMs) return [window];
      const pieces: Window[] = [];
      if (blank.startMs > window.startMs) pieces.push({ ...window, endMs: blank.startMs });
      if (blank.endMs < window.endMs) pieces.push({ ...window, startMs: blank.endMs });
      return pieces.filter((piece) => piece.endMs > piece.startMs);
    });
  }
  return result;
}

function windowsForClip(input: {
  clip: EditClip;
  events: readonly FineEditEvent[];
  blanks: readonly TimeInterval[];
  audioDurationMs: number;
  rules: FineEditRules;
}): { clips: EditClip[]; warnings: FineEditWarning[]; discarded: string[]; required: string[] } {
  const { clip, rules } = input;
  const events = input.events.filter((event) => event.atMs >= clip.sourceStartMs && event.atMs <= clip.sourceEndMs);
  const analysis = analyzeFineEditEvents(events);
  const actionEvents = analysis.events.filter((event) => event.type === 'pointer-click' || event.type === 'input' || event.type === 'change');
  const conflictingBlanks = input.blanks.filter((blank) => blank.confidence !== 'low'
    && actionEvents.some((event) => event.atMs >= blank.startMs && event.atMs <= blank.endMs));
  const effectiveBlanks = input.blanks.filter((blank) => !conflictingBlanks.includes(blank));
  const blankWarnings: FineEditWarning[] = conflictingBlanks.length === 0 ? [] : [{
    code: 'AMBIGUOUS_BLANK_REGION',
    message: `Preserved ${conflictingBlanks.length} blank candidate interval(s) because they contain real user actions.`,
  }];
  const retained = analysis.events.filter((event) => analysis.retainedEventIds.has(event.id)
    && (event.type === 'pointer-click' || event.type === 'input' || event.type === 'change')
    && !effectiveBlanks.some((blank) => blank.confidence !== 'low' && event.atMs >= blank.startMs && event.atMs <= blank.endMs));
  const targetDurationMs = Math.min(
    clip.sourceEndMs - clip.sourceStartMs,
    input.audioDurationMs + rules.soft.narrationTailMs,
  );
  if (retained.length === 0) {
    const windows = subtractBlank([{
      startMs: clip.sourceStartMs,
      endMs: clip.sourceEndMs,
      eventIds: [],
      clipKind: 'context',
    }], effectiveBlanks);
    const hasLeadingBlank = windows[0]?.startMs !== clip.sourceStartMs;
    const window = hasLeadingBlank
      ? windows.find((candidate) => candidate.endMs - candidate.startMs >= targetDurationMs) ?? windows[0]
      : [...windows].reverse().find((candidate) => candidate.endMs - candidate.startMs >= targetDurationMs) ?? windows.at(-1);
    if (window === undefined) throw new Error(`Fine edit removed every clip from ${clip.sourceId}`);
    return {
      clips: [{
        ...clip,
        sourceStartMs: hasLeadingBlank ? window.startMs : Math.max(window.startMs, window.endMs - targetDurationMs),
        sourceEndMs: hasLeadingBlank ? Math.min(window.endMs, window.startMs + targetDurationMs) : window.endMs,
        playbackRate: 1,
        clipKind: 'context',
        evidenceEventIds: [],
        reason: 'Stable non-blank context window sized to real TTS.',
      }],
      warnings: [...analysis.warnings, ...blankWarnings],
      discarded: [...analysis.discardedEventIds],
      required: [],
    };
  }

  let windows = retained.map((event): Window => {
    const isSave = event.type === 'pointer-click' && eventText(event) === '保存';
    return {
      startMs: Math.max(clip.sourceStartMs, event.atMs - rules.soft.actionPreRollMs),
      endMs: Math.min(clip.sourceEndMs, event.atMs + (isSave ? rules.soft.resultReactionMs : rules.soft.actionPostRollMs)),
      eventIds: [event.id],
      clipKind: isSave ? 'result' : 'action',
    };
  });
  windows = subtractBlank(mergeWindows(windows, rules.hard.shortWaitMaxMs), effectiveBlanks);

  const duration = () => windows.reduce((sum, window) => sum + (window.endMs - window.startMs), 0);
  let remaining = Math.max(0, targetDurationMs - duration());
  const last = windows.at(-1);
  if (last !== undefined && remaining > 0) {
    const extension = Math.min(remaining, rules.soft.maxSilentTailMs, clip.sourceEndMs - last.endMs);
    last.endMs += extension;
    remaining -= extension;
  }
  const first = windows[0];
  if (first !== undefined && remaining > 0) {
    const extension = Math.min(remaining, first.startMs - clip.sourceStartMs);
    first.startMs -= extension;
  }

  return {
    clips: windows.map((window) => ({
      sourceId: clip.sourceId,
      sourceStartMs: Math.round(window.startMs),
      sourceEndMs: Math.round(window.endMs),
      playbackRate: 1,
      clipKind: window.clipKind,
      evidenceEventIds: [...new Set(window.eventIds)],
      reason: window.clipKind === 'result' ? 'Required save/result window.' : 'Retained event action window.',
    })),
    warnings: [...analysis.warnings, ...blankWarnings],
    discarded: [...analysis.discardedEventIds],
    required: retained.map((event) => event.id),
  };
}

export function buildFineEditPlan(input: {
  effectivePlan: EditPlan;
  eventsBySource: ReadonlyMap<string, readonly FineEditEvent[]>;
  audioDurationBySegment: ReadonlyMap<string, number>;
  blankIntervalsBySource: ReadonlyMap<string, readonly TimeInterval[]>;
  rules: FineEditRules;
}): FineEditResult {
  const warnings: FineEditWarning[] = [];
  const discardedEventIds: string[] = [];
  const requiredEventIdsBySegment: Record<string, string[]> = {};
  const segments: EditPlanSegment[] = input.effectivePlan.segments.map((segment) => {
    const audioDurationMs = input.audioDurationBySegment.get(segment.segmentId);
    if (audioDurationMs === undefined) throw new Error(`Missing real TTS duration for ${segment.segmentId}`);
    const required: string[] = [];
    const clips = segment.clips.flatMap((clip) => {
      const result = windowsForClip({
        clip,
        events: input.eventsBySource.get(clip.sourceId) ?? [],
        blanks: input.blankIntervalsBySource.get(clip.sourceId) ?? [],
        audioDurationMs,
        rules: input.rules,
      });
      warnings.push(...result.warnings.map((warning) => ({ ...warning, segmentId: segment.segmentId })));
      discardedEventIds.push(...result.discarded);
      required.push(...result.required);
      return result.clips;
    });
    requiredEventIdsBySegment[segment.segmentId] = [...new Set(required)];
    if (clips.length === 0) throw new Error(`Fine edit removed every clip from ${segment.segmentId}`);
    const outputDurationMs = clips.reduce((sum, clip) => sum + calculateEditClipDurationMs(clip), 0);
    const softTargetMs = audioDurationMs + input.rules.soft.narrationTailMs;
    if (outputDurationMs > softTargetMs + input.rules.soft.maxSilentTailMs) warnings.push({
      segmentId: segment.segmentId,
      code: 'LONG_ACTION_AFTER_NARRATION',
      message: `Required action duration ${outputDurationMs}ms exceeds soft target ${softTargetMs}ms.`,
    });
    return {
      ...segment,
      clips,
      holdLastFrameMs: undefined,
      reason: `${segment.reason} Fine edit retained required event windows against real TTS.`,
    };
  });
  return {
    plan: { ...input.effectivePlan, segments },
    warnings,
    discardedEventIds: [...new Set(discardedEventIds)],
    requiredEventIdsBySegment,
  };
}
