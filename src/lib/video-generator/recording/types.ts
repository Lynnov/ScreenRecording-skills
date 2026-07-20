export type RecordingState = 'preparing' | 'recording' | 'finishing' | 'completed' | 'failed';

export interface RecordingTimestamp {
  sessionTimeMs: number;
  videoTimeMs: number | null;
}

export interface RecordingEvent extends RecordingTimestamp {
  type: string;
  tabId?: string;
  payload?: Record<string, unknown>;
}

export interface CaptureClockSample extends RecordingTimestamp {
  mediaTimeMs: number;
}

export interface RecordingAttempt {
  actionId: string;
  attempt: number;
  startMs: number;
  endMs: number | null;
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
  maxObservedDriftMs: number;
  maxAllowedDriftMs: number;
  captureComplete: boolean;
}
