export type RecordingState = 'preparing' | 'recording' | 'finishing' | 'completed' | 'failed';

export interface RecordingTimestamp {
  sessionTimeMs: number;
  videoTimeMs: number | null;
}

export interface RecordingEvent extends RecordingTimestamp {
  type: string;
  tabId?: string;
  payload?: Record<string, unknown>;
  url?: string;
  frameUrl?: string;
  target?: Record<string, unknown>;
}

export interface CaptureClockSample extends RecordingTimestamp {
  mediaTimeMs: number;
}

export interface RecordingAttempt {
  actionId: string;
  segmentId: string;
  sourceId: string;
  attempt: number;
  startMs: number;
  endMs: number | null;
  confirmedAtMs: number | null;
  status: 'recording' | 'discarded' | 'confirmed';
}

export interface RecordingManifest {
  version: 1;
  platform: 'win32';
  video:
    | {
        status: 'available';
        path: string;
        width: number;
        height: number;
        fps: number;
        durationMs: number;
        hasAudio: false;
      }
    | {
        status: 'unavailable';
        path: null;
        reason: string;
      };
  rawVideoPath: string;
  eventsPath: string;
  tabsPath: string;
  recordingStartMs: number;
  recordingEndMs: number;
  firstVideoFrameSessionTimeMs: number | null;
  attempts: RecordingAttempt[];
  clockStatus: 'ok' | 'drift-detected';
  slopePpm: number;
  maxResidualMs: number;
  maxAllowedResidualMs: number;
  ffprobeDurationDeltaMs: number;
  maxAllowedFfprobeDurationDeltaMs: number;
  markerEvidence: MarkerEvidence[];
  captureComplete: boolean;
}
import type { MarkerEvidence } from './marker-evidence.js';
