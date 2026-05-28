export type WaitTarget =
  | { type: 'text'; value: string }
  | { type: 'selector'; value: string }
  | { type: 'hiddenSelector'; value: string }
  | { type: 'url'; value: string }
  | { type: 'networkIdle' };

export type BrowserAction =
  | { type: 'goto'; url: string; waitFor?: WaitTarget }
  | { type: 'click'; text?: string; selector?: string; waitFor?: WaitTarget }
  | { type: 'hover'; text?: string; selector?: string; waitFor?: WaitTarget }
  | { type: 'fill'; text?: string; selector?: string; value: string; waitFor?: WaitTarget }
  | { type: 'remoteSelect'; text?: string; selector?: string; query: string; option?: string; selectFirst?: boolean; waitFor?: WaitTarget }
  | { type: 'selectFirst'; text?: string; selector?: string; waitFor?: WaitTarget }
  | { type: 'waitFor'; target: WaitTarget }
  | { type: 'scroll'; y: number; waitFor?: WaitTarget }
  | { type: 'scrollTo'; target: Extract<WaitTarget, { type: 'selector' }>; waitFor?: WaitTarget }
  | { type: 'uploadFile'; text?: string; selector?: string; path: string; waitFor?: WaitTarget };

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

export type VideoGeneratorMode = 'generate' | 'dryRun';

export type ScriptDraftRole = 'original' | 'polished' | 'executable';

export interface ScriptDraftEntry {
  role: ScriptDraftRole;
  path: string;
  sourcePath: string;
  overwriteAllowed: boolean;
}

export interface ScriptDraftManifest {
  version: 1;
  sourceScriptPath: string;
  createdAt: string;
  overwriteAllowed: boolean;
  businessDataProtectionNotice: string;
  protectedBusinessTerms: string[];
  drafts: Record<ScriptDraftRole, ScriptDraftEntry>;
  manifestPath?: string;
}

export type PreflightCheckStatus = 'passed' | 'failed' | 'skipped';

export interface ActionCandidateReport {
  tagName: string;
  text?: string;
  role?: string;
  ariaLabel?: string;
  placeholder?: string;
  selector?: string;
}

export interface PreflightCheck {
  name: string;
  status: PreflightCheckStatus;
  message: string;
  segmentId?: string;
  actionIndex?: number;
  screenshotPath?: string;
  candidates?: ActionCandidateReport[];
}

export interface PreflightReport {
  ok: boolean;
  outputDir: string;
  scriptPath: string;
  storageStatePath?: string;
  checks: PreflightCheck[];
  failedSegmentId?: string;
  failedAction?: BrowserAction;
  preflightReportPath?: string;
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
  | 'INVALID_HOVER_TARGET'
  | 'INVALID_FILL_TARGET'
  | 'INVALID_FILL_VALUE'
  | 'INVALID_REMOTE_SELECT_TARGET'
  | 'INVALID_SELECT_FIRST_TARGET'
  | 'INVALID_WAIT_TARGET'
  | 'INVALID_SCROLL_Y'
  | 'INVALID_UPLOAD_FILE_TARGET'
  | 'NO_TARGET_FOUND'
  | 'UNSUPPORTED_INTERACTION_PATTERN'
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
  readonly candidates?: ActionCandidateReport[];

  constructor(
    code: VideoGeneratorErrorCode,
    message: string,
    segmentId?: string,
    failedAction?: BrowserAction,
    candidates?: ActionCandidateReport[],
  ) {
    super(message);
    this.name = 'VideoGeneratorError';
    this.code = code;
    this.segmentId = segmentId;
    this.failedAction = failedAction;
    this.candidates = candidates;
  }
}
