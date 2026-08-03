import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface FineEditEvent {
  id: string;
  sourceId: string;
  atMs: number;
  type: string;
  target: Record<string, unknown>;
  payload: Record<string, unknown>;
  targetKey?: string;
}

export interface FineEditWarning {
  code: 'AMBIGUOUS_INPUT_TARGET' | 'AMBIGUOUS_BLANK_REGION' | 'LONG_ACTION_AFTER_NARRATION' | 'SUPERSEDED_INPUT_REMOVED';
  message: string;
  segmentId?: string;
}

export interface FineEditEventAnalysis {
  events: FineEditEvent[];
  retainedEventIds: Set<string>;
  discardedEventIds: Set<string>;
  warnings: FineEditWarning[];
}

export function eventPathForSource(runDir: string, sourceId: string, kind?: 'original' | 'pickup'): string {
  return kind === 'original' || sourceId === 'original'
    ? path.join(runDir, 'capture', 'events.jsonl')
    : path.join(runDir, 'pickups', `${sourceId}.events.jsonl`);
}

export async function readSourceEvents(runDir: string, sourceId: string, kind?: 'original' | 'pickup'): Promise<FineEditEvent[]> {
  const lines = (await readFile(eventPathForSource(runDir, sourceId, kind), 'utf8')).split(/\r?\n/).filter(Boolean);
  const events: FineEditEvent[] = [];
  lines.forEach((line, index) => {
    const value = JSON.parse(line) as Record<string, unknown>;
    if (typeof value.videoTimeMs !== 'number' || !Number.isFinite(value.videoTimeMs) || value.videoTimeMs < 0) return;
    events.push({
      id: `${sourceId}:event-${index + 1}`,
      sourceId,
      atMs: Math.round(value.videoTimeMs),
      type: typeof value.type === 'string' ? value.type : 'unknown',
      target: isRecord(value.target) ? value.target : {},
      payload: isRecord(value.payload) ? value.payload : {},
    });
  });
  return events;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function targetString(target: Record<string, unknown>, key: string): string | undefined {
  const value = target[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizedLabel(target: Record<string, unknown>): string | undefined {
  const text = targetString(target, 'text')?.replace(/\s+/g, ' ').trim();
  if (text === undefined || text === '保存' || text.length > 24) return undefined;
  return text;
}

function strongTargetKey(event: FineEditEvent): string | undefined {
  const target = event.target;
  for (const key of ['id', 'name', 'ariaLabel', 'placeholder'] as const) {
    const value = targetString(target, key);
    if (value !== undefined) return `${key}:${value}`;
  }
  return undefined;
}

export function analyzeFineEditEvents(inputEvents: readonly FineEditEvent[]): FineEditEventAnalysis {
  const events = [...inputEvents].sort((left, right) => left.atMs - right.atMs).map((event) => ({ ...event }));
  let activeLabel: string | undefined;
  const ambiguousIds: string[] = [];
  for (const event of events) {
    const tagName = targetString(event.target, 'tagName')?.toLowerCase();
    const strong = strongTargetKey(event);
    if (strong !== undefined) event.targetKey = strong;
    else if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
      if (activeLabel !== undefined) event.targetKey = `label:${activeLabel}`;
      else if (event.type === 'input' || event.type === 'change') ambiguousIds.push(event.id);
    }
    if (event.type === 'pointer-click' && tagName !== 'input' && tagName !== 'textarea' && tagName !== 'select') {
      const label = normalizedLabel(event.target);
      if (label !== undefined) activeLabel = label;
    }
  }

  const typedInputEvents = events.filter((event) => {
    const tagName = targetString(event.target, 'tagName')?.toLowerCase();
    const isInputTarget = tagName === 'input' || tagName === 'textarea' || tagName === 'select';
    return event.targetKey !== undefined
      && (event.type === 'input' || event.type === 'change' || (event.type === 'pointer-click' && isInputTarget));
  });
  const byTarget = new Map<string, FineEditEvent[]>();
  for (const event of typedInputEvents) byTarget.set(event.targetKey!, [...(byTarget.get(event.targetKey!) ?? []), event]);
  const discardedEventIds = new Set<string>();
  for (const targetEvents of byTarget.values()) {
    const attempts: FineEditEvent[][] = [];
    for (const event of targetEvents) {
      const current = attempts.at(-1);
      const previous = current?.at(-1);
      if (current === undefined || previous === undefined || previous.type === 'change' || event.atMs - previous.atMs > 1500) attempts.push([event]);
      else current.push(event);
    }
    for (const attempt of attempts.slice(0, -1)) for (const event of attempt) discardedEventIds.add(event.id);
    const firstTargetEvent = targetEvents[0];
    const finalAttemptStart = attempts.at(-1)?.[0];
    if (attempts.length > 1 && firstTargetEvent !== undefined && finalAttemptStart !== undefined) {
      for (const event of events) {
        if (event.atMs <= firstTargetEvent.atMs || event.atMs >= finalAttemptStart.atMs) continue;
        if (event.type === 'pointer-click' && targetString(event.target, 'text') === '保存') {
          discardedEventIds.add(event.id);
        }
      }
    }
  }

  const retainedEventIds = new Set(events.filter((event) => !discardedEventIds.has(event.id)).map((event) => event.id));
  const warnings: FineEditWarning[] = [];
  if (ambiguousIds.length > 0) warnings.push({
    code: 'AMBIGUOUS_INPUT_TARGET',
    message: `Preserved ${ambiguousIds.length} input events because their targets cannot be distinguished safely.`,
  });
  if (discardedEventIds.size > 0) warnings.push({
    code: 'SUPERSEDED_INPUT_REMOVED',
    message: `Removed ${discardedEventIds.size} events from superseded edits of the same input target.`,
  });
  return { events, retainedEventIds, discardedEventIds, warnings };
}
