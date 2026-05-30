export type WaitTarget =
  | { type: 'text'; value: string }
  | { type: 'selector'; value: string }
  | { type: 'hiddenSelector'; value: string }
  | { type: 'url'; value: string }
  | { type: 'networkIdle' };

export interface BrowserActionBase {
  stageName?: string;
}

export type BrowserAction =
  | (BrowserActionBase & { type: 'goto'; url: string; waitFor?: WaitTarget })
  | (BrowserActionBase & { type: 'click'; text?: string; selector?: string; waitFor?: WaitTarget })
  | (BrowserActionBase & { type: 'fill'; text?: string; selector?: string; value: string; waitFor?: WaitTarget })
  | (BrowserActionBase & { type: 'waitFor'; target: WaitTarget })
  | (BrowserActionBase & { type: 'remoteSelect'; selector: string; keyword: string; optionText: string; waitFor?: WaitTarget })
  | (BrowserActionBase & { type: 'uploadFile'; selector: string; filePath: string; waitFor?: WaitTarget })
  | (BrowserActionBase & { type: 'scroll'; y: number; waitFor?: WaitTarget })
  | (BrowserActionBase & { type: 'scrollTo'; target: Extract<WaitTarget, { type: 'selector' }>; waitFor?: WaitTarget });

export interface StageDefinition {
  name: string;
  scope?: string;
  anchors: string[];
}

export interface StageAnchorDiagnostic {
  selector: string;
  matched: boolean;
  count: number;
}

export interface StageDiagnostic {
  stageName: string;
  scope?: string;
  scopeMatched?: boolean;
  scopeCount?: number;
  matched: boolean;
  anchors: StageAnchorDiagnostic[];
  missingAnchors: string[];
}

export interface PreflightCheck {
  name: string;
  ok: boolean;
  message: string;
  stageName?: string;
}

export interface PreflightReport {
  ok: boolean;
  outputDir: string;
  checks: PreflightCheck[];
  stageDiagnostics: StageDiagnostic[];
}

export interface ElementOverlayDiagnostic {
  tagName?: string;
  id?: string;
  className?: string;
  text?: string;
}

export interface ElementBoxDiagnostic {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ActionCandidateDiagnostic {
  index: number;
  visible: boolean;
  editable?: boolean;
  enabled?: boolean;
  boundingBox?: ElementBoxDiagnostic;
  overlayElement?: ElementOverlayDiagnostic;
}

export interface DropdownDiagnostic {
  popperCount: number;
  visibleItemCount: number;
  hiddenContainerCount: number;
  failureReason?: string;
}

export interface ActionFailureDiagnostics {
  url: string;
  stageName?: string;
  actionType: BrowserAction['type'];
  selector?: string;
  candidateCount: number;
  candidates: ActionCandidateDiagnostic[];
  overlayElement?: ElementOverlayDiagnostic;
  screenshotPath?: string;
  dropdowns?: DropdownDiagnostic;
  missingText?: string;
  failureReason: string;
}

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
  stages?: StageDefinition[];
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
  preflightReportPath?: string;
  finalVideoPath?: string;
  timelinePath?: string;
  subtitlesPath?: string;
  failedSegmentId?: string;
  failedAction?: BrowserAction;
  errorMessage?: string;
  screenshotPath?: string;
  diagnostics?: ActionFailureDiagnostics;
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
  | 'INVALID_REMOTE_SELECT_TARGET'
  | 'INVALID_UPLOAD_FILE_TARGET'
  | 'INVALID_SCROLL_Y'
  | 'MISSING_NARRATION'
  | 'MISSING_ACTION'
  | 'UNSUPPORTED_SCRIPT_ACTION'
  | 'FFPROBE_FAILED'
  | 'FFMPEG_FAILED'
  | 'INVALID_OUTPUT_DIR'
  | 'MISSING_TTS_CONFIG'
  | 'TTS_SYNTHESIS_FAILED'
  | 'TTS_PROVIDER_NOT_IMPLEMENTED';

export class VideoGeneratorError extends Error {
  readonly code: VideoGeneratorErrorCode;
  readonly segmentId?: string;
  readonly failedAction?: BrowserAction;
  readonly diagnostics?: ActionFailureDiagnostics;

  constructor(
    code: VideoGeneratorErrorCode,
    message: string,
    segmentId?: string,
    failedAction?: BrowserAction,
    diagnostics?: ActionFailureDiagnostics,
  ) {
    super(message);
    this.name = 'VideoGeneratorError';
    this.code = code;
    this.segmentId = segmentId;
    this.failedAction = failedAction;
    this.diagnostics = diagnostics;
  }
}
