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
  label?: string;
  tagName?: string;
  role?: string;
  name?: string;
  text?: string;
  layer?: CandidateLayer;
  confidence?: CandidateConfidence;
  selectorHint?: string;
  ariaLabel?: string;
  placeholder?: string;
  selector?: string;
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
  | { type: 'hover'; text?: string; selector?: string; waitFor?: WaitTarget }
  | { type: 'fill'; text?: string; selector?: string; value: string; waitFor?: WaitTarget }
  | { type: 'remoteSelect'; text?: string; selector?: string; query: string; option?: string; selectFirst?: boolean; waitFor?: WaitTarget }
  | { type: 'selectFirst'; text?: string; selector?: string; waitFor?: WaitTarget }
  | { type: 'waitFor'; target: WaitTarget }
  | { type: 'scroll'; y: number; waitFor?: WaitTarget }
  | { type: 'scrollTo'; target: Extract<WaitTarget, { type: 'selector' }>; waitFor?: WaitTarget }
  | { type: 'semanticClick'; target: Extract<SemanticActionTarget, { kind: 'button' | 'link' }>; waitFor?: WaitTarget }
  | { type: 'semanticFill'; target: Extract<SemanticActionTarget, { kind: 'field' }>; value: string; waitFor?: WaitTarget }
  | { type: 'semanticSelect'; target: Extract<SemanticActionTarget, { kind: 'field' }>; option: string; waitFor?: WaitTarget }
  | { type: 'semanticWaitFor'; target: Extract<SemanticActionTarget, { kind: 'visibleText' }> }
  | { type: 'uploadFile'; text?: string; selector?: string; path: string; waitFor?: WaitTarget };

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
    candidates?: ActionCandidateReport[],
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
    this.candidates = candidates;
  }
}
