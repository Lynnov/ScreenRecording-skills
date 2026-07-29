import type { RecordingEvent } from '../recording/types.js';

export interface ManualKeyframe {
  atMs: number;
  reason: string;
  fileName: string;
}

export interface ManualKeyframePlan {
  version: 1;
  frames: ManualKeyframe[];
}

export function planManualKeyframes(input: {
  events: RecordingEvent[];
  durationMs: number;
  intervalMs?: number;
}): ManualKeyframePlan {
  const intervalMs = input.intervalMs ?? 2500;
  const byTime = new Map<number, Set<string>>();
  const add = (atMs: number, reason: string) => {
    const clamped = Math.max(0, Math.min(input.durationMs, Math.round(atMs)));
    const reasons = byTime.get(clamped) ?? new Set<string>();
    reasons.add(reason);
    byTime.set(clamped, reasons);
  };

  for (let atMs = 0; atMs <= input.durationMs; atMs += intervalMs) {
    add(atMs, 'interval');
  }

  for (const event of input.events) {
    const atMs = event.videoTimeMs ?? event.sessionTimeMs;
    switch (event.type) {
      case 'recording-start':
        add(atMs, 'recording-start');
        break;
      case 'pointer-click':
      case 'click':
        add(atMs - 300, 'click-before');
        add(atMs + 500, 'click-after');
        break;
      case 'input':
      case 'change':
        add(atMs, 'input');
        break;
      case 'action-confirmed':
        add(atMs, 'result');
        add(atMs + 1, 'segment-end');
        break;
      case 'navigation':
        add(atMs, 'navigation');
        break;
      case 'tab-created':
      case 'tab-activated':
      case 'tab-closed':
        add(atMs, 'tab');
        break;
      case 'retry-start':
        add(atMs, 'retry');
        break;
      case 'recording-stop':
        add(atMs, 'segment-end');
        break;
      default:
        break;
    }
  }

  const frames = [...byTime.entries()]
    .sort(([left], [right]) => left - right)
    .map(([atMs, reasons]) => ({
      atMs,
      reason: [...reasons].join('+'),
      fileName: `frame-${String(atMs).padStart(6, '0')}.png`,
    }));
  return { version: 1, frames };
}
