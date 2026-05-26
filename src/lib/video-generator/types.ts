export type WaitTarget =
  | { type: 'text'; value: string }
  | { type: 'selector'; value: string }
  | { type: 'hiddenSelector'; value: string }
  | { type: 'url'; value: string }
  | { type: 'networkIdle' };

export type SemanticActionTarget =
  | { kind: 'button'; name: string }
  | { kind: 'link'; name: string }
  | { kind: 'field'; name: string }
  | { kind: 'visibleText'; name: string };

export type CandidateLayer = 'page' | 'dialog' | 'drawer' | 'popover' | 'dropdown' | 'toast' | 'overlay';

export type CandidateConfidence = 'strong' | 'medium' | 'weak';

export interface ActionCandidateReport {
  label: string;
  role?: string;
  name: string;
  text?: string;
  layer: CandidateLayer;
  confidence: CandidateConfidence;
  selectorHint?: string;
}

export type SemanticFailureReason =
  | 'NO_TARGET_FOUND'
  | 'AMBIGUOUS_TARGET'
  | 'LOW_CONFIDENCE_TARGET'
  | 'TARGET_OCCLUDED'
  | 'UNSUPPORTED_INTERACTION_PATTERN'
  | 'RISKY_ACTION_REQUIRES_EXPLICIT_CONFIRMATION';

export type BrowserAction =
  | { type: 'goto'; url: string; waitFor?: WaitTarget }
  | { type: 'click'; text?: string; selector?: string; waitFor?: WaitTarget }
  | { type: 'fill'; text?: string; selector?: string; value: string; waitFor?: WaitTarget }
  | { type: 'waitFor'; target: WaitTarget }
  | { type: 'scroll'; y: number; waitFor?: WaitTarget }
  | { type: 'scrollTo'; target: Extract<WaitTarget, { type: 'selector' }>; waitFor?: WaitTarget }
  | { type: 'semanticClick'; target: Extract<SemanticActionTarget, { kind: 'button' | 'link' }>; waitFor?: WaitTarget }
  | { type: 'semanticFill'; target: Extract<SemanticActionTarget, { kind: 'field' }>; value: string; waitFor?: WaitTarget }
  | { type: 'semanticSelect'; target: Extract<SemanticActionTarget, { kind: 'field' }>; option: string; waitFor?: WaitTarget }
  | { type: 'semanticWaitFor'; target: Extract<SemanticActionTarget, { kind: 'visibleText' }> };

export interface TimelineSegmentAssets {
  audioPath?: string;
  clipPath?: string;
  screenshotPath?: string;
  videoStartMs?: number;
  videoEndMs?: number;
  resolvedActions?: Array<{
    actionIndex: number;
    strategy: string;
    confidence: CandidateConfidence;
    role?: string;
    name: string;
    layer: CandidateLayer;
    selectorHint?: string;
  }>;
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
  failureReason?: SemanticFailureReason;
  candidates?: ActionCandidateReport[];
  candidateReportPath?: string;
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

export interface VideoGeneratorErrorDetails {
  segmentId?: string;
  failedAction?: BrowserAction;
  failureReason?: SemanticFailureReason;
  candidates?: ActionCandidateReport[];
  candidateReportPath?: string;
}

export class VideoGeneratorError extends Error {
  readonly code: VideoGeneratorErrorCode;
  readonly segmentId?: string;
  readonly failedAction?: BrowserAction;
  readonly failureReason?: SemanticFailureReason;
  readonly candidates?: ActionCandidateReport[];
  readonly candidateReportPath?: string;

  constructor(
    code: VideoGeneratorErrorCode,
    message: string,
    segmentIdOrDetails?: string | VideoGeneratorErrorDetails,
    failedAction?: BrowserAction,
  ) {
    super(message);
    this.name = 'VideoGeneratorError';
    this.code = code;

    if (typeof segmentIdOrDetails === 'object' && segmentIdOrDetails !== null) {
      this.segmentId = segmentIdOrDetails.segmentId;
      this.failedAction = segmentIdOrDetails.failedAction;
      this.failureReason = segmentIdOrDetails.failureReason;
      this.candidates = segmentIdOrDetails.candidates;
      this.candidateReportPath = segmentIdOrDetails.candidateReportPath;
      return;
    }

    this.segmentId = segmentIdOrDetails;
    this.failedAction = failedAction;
  }
}
