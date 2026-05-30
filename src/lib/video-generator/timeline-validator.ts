import { VideoGeneratorError, type BrowserAction, type Timeline, type WaitTarget } from './types.js';

export function validateTimeline(timeline: unknown): void {
  if (!isRecord(timeline)) {
    throw new VideoGeneratorError('INVALID_TIMELINE_VERSION', 'Timeline must be an object.');
  }

  if (timeline.version !== 1) {
    throw new VideoGeneratorError('INVALID_TIMELINE_VERSION', 'Timeline version must be 1.');
  }

  if (!Array.isArray(timeline.segments) || timeline.segments.length === 0) {
    throw new VideoGeneratorError('EMPTY_SEGMENTS', 'Timeline must contain at least one segment.');
  }

  for (const segment of timeline.segments) {
    validateSegment(segment);
  }
}

function validateSegment(segment: unknown): void {
  if (!isRecord(segment)) {
    throw new VideoGeneratorError('EMPTY_NARRATION', 'Segment must be an object.');
  }

  const segmentId = typeof segment.id === 'string' ? segment.id : undefined;

  if (typeof segment.narration !== 'string' || !segment.narration.trim()) {
    throw new VideoGeneratorError('EMPTY_NARRATION', 'Segment narration must not be empty.', segmentId);
  }

  validateNonNegativeFinite(
    segment.estimatedDurationMs,
    'INVALID_ESTIMATED_DURATION',
    'Segment estimatedDurationMs must be finite and >= 0.',
    segmentId,
  );
  validateNonNegativeFinite(
    segment.bufferMs,
    'INVALID_BUFFER_MS',
    'Segment bufferMs must be finite and >= 0.',
    segmentId,
  );

  if (segment.actualAudioDurationMs !== undefined) {
    validateNonNegativeFinite(
      segment.actualAudioDurationMs,
      'INVALID_ACTUAL_AUDIO_DURATION',
      'Segment actualAudioDurationMs must be finite and >= 0.',
      segmentId,
    );
  }
  if (segment.startsAtMs !== undefined) {
    validateNonNegativeFinite(
      segment.startsAtMs,
      'INVALID_STARTS_AT',
      'Segment startsAtMs must be finite and >= 0.',
      segmentId,
    );
  }
  if (segment.endsAtMs !== undefined) {
    validateNonNegativeFinite(
      segment.endsAtMs,
      'INVALID_ENDS_AT',
      'Segment endsAtMs must be finite and >= 0.',
      segmentId,
    );
  }

  if (!Array.isArray(segment.actions) || segment.actions.length === 0) {
    throw new VideoGeneratorError('EMPTY_ACTIONS', 'Segment actions must contain at least one action.', segmentId);
  }

  for (const action of segment.actions) {
    validateAction(action, segmentId);
  }
}

function validateAction(action: unknown, segmentId: string | undefined): void {
  if (!isRecord(action) || typeof action.type !== 'string') {
    throw new VideoGeneratorError('UNSUPPORTED_SCRIPT_ACTION', 'Browser action must be an object with a type.', segmentId);
  }

  switch (action.type) {
    case 'goto':
      if (typeof action.url !== 'string' || !isAllowedGotoUrl(action.url)) {
        throw new VideoGeneratorError('INVALID_GOTO_URL', 'Goto action URL must use http, https, or a text/html data URL.', segmentId);
      }
      validateOptionalWaitFor(action.waitFor, segmentId);
      return;
    case 'click':
      if (!hasTextOrSelector(action)) {
        throw new VideoGeneratorError('INVALID_CLICK_TARGET', 'Click action must include text or selector.', segmentId);
      }
      validateOptionalWaitFor(action.waitFor, segmentId);
      return;
    case 'fill':
      if (typeof action.value !== 'string' || !action.value) {
        throw new VideoGeneratorError('INVALID_FILL_VALUE', 'Fill action must include a value.', segmentId);
      }
      if (!hasTextOrSelector(action)) {
        throw new VideoGeneratorError('INVALID_FILL_TARGET', 'Fill action must include text or selector.', segmentId);
      }
      validateOptionalWaitFor(action.waitFor, segmentId);
      return;
    case 'waitFor':
      validateWaitTarget(action.target, segmentId);
      return;
    case 'remoteSelect':
      if (typeof action.selector !== 'string' || !action.selector.trim()) {
        throw new VideoGeneratorError('INVALID_REMOTE_SELECT_TARGET', 'Remote select action must include a selector.', segmentId);
      }
      if (typeof action.keyword !== 'string') {
        throw new VideoGeneratorError('INVALID_REMOTE_SELECT_TARGET', 'Remote select action keyword must be a string.', segmentId);
      }
      if (typeof action.optionText !== 'string' || !action.optionText.trim()) {
        throw new VideoGeneratorError('INVALID_REMOTE_SELECT_TARGET', 'Remote select action must include optionText.', segmentId);
      }
      validateOptionalWaitFor(action.waitFor, segmentId);
      return;
    case 'uploadFile':
      if (typeof action.selector !== 'string' || !action.selector.trim()) {
        throw new VideoGeneratorError('INVALID_UPLOAD_FILE_TARGET', 'Upload file action must include a selector.', segmentId);
      }
      if (typeof action.filePath !== 'string' || !action.filePath.trim()) {
        throw new VideoGeneratorError('INVALID_UPLOAD_FILE_TARGET', 'Upload file action must include a filePath.', segmentId);
      }
      validateOptionalWaitFor(action.waitFor, segmentId);
      return;
    case 'scroll':
      if (typeof action.y !== 'number' || !Number.isFinite(action.y)) {
        throw new VideoGeneratorError('INVALID_SCROLL_Y', 'Scroll action y must be a finite number.', segmentId);
      }
      validateOptionalWaitFor(action.waitFor, segmentId);
      return;
    case 'scrollTo':
      validateSelectorWaitTarget(action.target, segmentId);
      validateOptionalWaitFor(action.waitFor, segmentId);
      return;
    default:
      throw new VideoGeneratorError('UNSUPPORTED_SCRIPT_ACTION', 'Unsupported browser action type.', segmentId);
  }
}

function hasTextOrSelector(action: { text?: unknown; selector?: unknown }): boolean {
  return (typeof action.text === 'string' && Boolean(action.text.trim()))
    || (typeof action.selector === 'string' && Boolean(action.selector.trim()));
}

function validateOptionalWaitFor(waitFor: unknown, segmentId: string | undefined): void {
  if (waitFor !== undefined) {
    validateWaitTarget(waitFor, segmentId);
  }
}

function validateSelectorWaitTarget(target: unknown, segmentId: string | undefined): void {
  if (!isRecord(target) || target.type !== 'selector' || typeof target.value !== 'string' || !target.value.trim()) {
    throw new VideoGeneratorError('INVALID_WAIT_TARGET', 'ScrollTo target must be a selector wait target.', segmentId);
  }
}

function validateWaitTarget(target: unknown, segmentId: string | undefined): void {
  if (!isRecord(target) || typeof target.type !== 'string') {
    throw new VideoGeneratorError('INVALID_WAIT_TARGET', 'Wait target must be an object with a type.', segmentId);
  }

  switch (target.type) {
    case 'text':
    case 'selector':
    case 'hiddenSelector':
    case 'url':
      if (typeof target.value !== 'string' || !target.value.trim()) {
        throw new VideoGeneratorError('INVALID_WAIT_TARGET', 'Wait target value must be a non-empty string.', segmentId);
      }
      return;
    case 'networkIdle':
      return;
    default:
      throw new VideoGeneratorError('INVALID_WAIT_TARGET', 'Unsupported wait target type.', segmentId);
  }
}

function validateNonNegativeFinite(
  value: unknown,
  code:
    | 'INVALID_ESTIMATED_DURATION'
    | 'INVALID_ACTUAL_AUDIO_DURATION'
    | 'INVALID_BUFFER_MS'
    | 'INVALID_STARTS_AT'
    | 'INVALID_ENDS_AT',
  message: string,
  segmentId: string | undefined,
): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new VideoGeneratorError(code, message, segmentId);
  }
}

function isAllowedGotoUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') {
      return true;
    }

    return parsedUrl.protocol === 'data:' && url.startsWith('data:text/html');
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
