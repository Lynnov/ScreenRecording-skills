import type { RecordingTimestamp } from './types.js';

export interface RecordingClock {
  stamp(): RecordingTimestamp;
  markFirstVideoFrame(): RecordingTimestamp;
  firstVideoFrameSessionTimeMs(): number | null;
}

export function createRecordingClock(nowNs: () => bigint = process.hrtime.bigint): RecordingClock {
  const originNs = nowNs();
  let firstFrameSessionTimeMs: number | null = null;
  let lastSessionTimeMs = -1;

  const readSessionTimeMs = (): number => Math.round(Number(nowNs() - originNs) / 1_000_000);

  const stamp = (): RecordingTimestamp => {
    const sessionTimeMs = readSessionTimeMs();
    if (sessionTimeMs < lastSessionTimeMs) {
      throw new Error(`Recording clock moved backwards: ${sessionTimeMs} < ${lastSessionTimeMs}`);
    }
    lastSessionTimeMs = sessionTimeMs;
    return {
      sessionTimeMs,
      videoTimeMs: firstFrameSessionTimeMs === null ? null : sessionTimeMs - firstFrameSessionTimeMs,
    };
  };

  return {
    stamp,
    markFirstVideoFrame() {
      if (firstFrameSessionTimeMs !== null) {
        return stamp();
      }
      const timestamp = stamp();
      firstFrameSessionTimeMs = timestamp.sessionTimeMs;
      return { sessionTimeMs: timestamp.sessionTimeMs, videoTimeMs: 0 };
    },
    firstVideoFrameSessionTimeMs() {
      return firstFrameSessionTimeMs;
    },
  };
}
