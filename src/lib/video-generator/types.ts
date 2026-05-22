export type WaitTarget =
  | { type: 'text'; value: string }
  | { type: 'selector'; value: string }
  | { type: 'hiddenSelector'; value: string }
  | { type: 'url'; value: string }
  | { type: 'networkIdle' };

export type BrowserAction =
  | { type: 'goto'; url: string; waitFor?: WaitTarget }
  | { type: 'click'; text?: string; selector?: string; waitFor?: WaitTarget }
  | { type: 'fill'; text?: string; selector?: string; value: string; waitFor?: WaitTarget }
  | { type: 'waitFor'; target: WaitTarget }
  | { type: 'scroll'; y: number; waitFor?: WaitTarget }
  | { type: 'scrollTo'; target: Extract<WaitTarget, { type: 'selector' }>; waitFor?: WaitTarget };

export interface TimelineSegmentAssets {
  audioPath?: string;
  clipPath?: string;
  screenshotPath?: string;
  videoStartMs?: number;
  videoEndMs?: number;
  [key: string]: unknown;
}

export interface TimelineSegment {
  id: string;
  sourceText: string;
  narration: string;
  subtitle: string;
  actions: BrowserAction[];
  estimatedDurationMs: number;
  actualAudioDurationMs?: number;
  bufferMs: number;
  startsAtMs?: number;
  endsAtMs?: number;
  assets: TimelineSegmentAssets;
}

export interface TimelineAssets {
  continuousClipPath?: string;
  continuousClipStartOffsetMs?: number;
  [key: string]: unknown;
}

export interface Timeline {
  version: 1;
  title: string;
  assets?: TimelineAssets;
  segments: TimelineSegment[];
}

export interface VideoGeneratorConfig {
  viewport: {
    width: number;
    height: number;
  };
  speechRateCharsPerMinute: number;
  segmentBufferMs: number;
  actionTimeoutMs: number;
  ttsProvider: 'aliyun';
  subtitleMode: 'burn-in';
  outputDir: string;
  storageStatePath?: string;
}

export interface RunReport {
  ok: boolean;
  outputDir: string;
  finalVideoPath?: string;
  timelinePath?: string;
  subtitlesPath?: string;
  failedSegmentId?: string;
  failedAction?: BrowserAction;
  errorMessage?: string;
  screenshotPath?: string;
}

export type VideoGeneratorErrorCode =
  | 'INVALID_TIMELINE_VERSION'
  | 'EMPTY_SEGMENTS'
  | 'EMPTY_NARRATION'
  | 'EMPTY_ACTIONS'
  | 'INVALID_ESTIMATED_DURATION'
  | 'INVALID_ACTUAL_AUDIO_DURATION'
  | 'INVALID_BUFFER_MS'
  | 'INVALID_STARTS_AT'
  | 'INVALID_ENDS_AT'
  | 'INVALID_GOTO_URL'
  | 'INVALID_CLICK_TARGET'
  | 'INVALID_FILL_TARGET'
  | 'INVALID_FILL_VALUE'
  | 'INVALID_WAIT_TARGET'
  | 'INVALID_SCROLL_Y'
  | 'MISSING_NARRATION'
  | 'MISSING_ACTION'
  | 'UNSUPPORTED_SCRIPT_ACTION'
  | 'FFPROBE_FAILED'
  | 'FFMPEG_FAILED'
  | 'MISSING_TTS_CONFIG'
  | 'TTS_SYNTHESIS_FAILED'
  | 'TTS_PROVIDER_NOT_IMPLEMENTED';

export class VideoGeneratorError extends Error {
  readonly code: VideoGeneratorErrorCode;
  readonly segmentId?: string;
  readonly failedAction?: BrowserAction;

  constructor(code: VideoGeneratorErrorCode, message: string, segmentId?: string, failedAction?: BrowserAction) {
    super(message);
    this.name = 'VideoGeneratorError';
    this.code = code;
    this.segmentId = segmentId;
    this.failedAction = failedAction;
  }
}
