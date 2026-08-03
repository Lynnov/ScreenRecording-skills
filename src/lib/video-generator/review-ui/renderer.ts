/// <reference lib="dom" />

import type { EditReview, EditReviewSegment } from '../manual/review.js';
import type { ReviewUiBundle } from './ipc.js';
import {
  formatSegmentLabel,
  formatSourceLabel,
  getSegmentPlaybackRange,
  type SegmentPlaybackRange,
} from './review-presenter.js';

declare global {
  interface Window {
    reviewUi: {
      loadBundle(): Promise<ReviewUiBundle>;
      saveReview(review: EditReview): Promise<void>;
      localPreview?(segmentId: string): Promise<{ ok: boolean; path?: string; error?: string }>;
    };
  }
}

const segmentList = document.querySelector<HTMLElement>('#segment-list');
const agentReason = document.querySelector<HTMLElement>('#agent-reason');
const saveButton = document.querySelector<HTMLButtonElement>('#save-review');
const saveStatus = document.querySelector<HTMLElement>('#save-status');
const statusSelect = document.querySelector<HTMLSelectElement>('#review-status');
const reasons = document.querySelector<HTMLTextAreaElement>('#review-reasons');
const boundaryStart = document.querySelector<HTMLInputElement>('#boundary-start');
const boundaryEnd = document.querySelector<HTMLInputElement>('#boundary-end');
const sourceSelect = document.querySelector<HTMLSelectElement>('#source-select');
const waitStrategy = document.querySelector<HTMLSelectElement>('#wait-strategy');
const preview = document.querySelector<HTMLVideoElement>('#segment-preview');
const timelineStrip = document.querySelector<HTMLElement>('#timeline-strip');
const previewError = document.querySelector<HTMLElement>('#preview-error');

let currentReview: EditReview | null = null;
let currentBundle: ReviewUiBundle | null = null;
let selectedSegmentId: string | null = null;
let selectedPlaybackRange: SegmentPlaybackRange | null = null;
let previewRenderVersion = 0;

void window.reviewUi.loadBundle().then((bundle) => {
  currentBundle = bundle;
  currentReview = bundle.reviewDraft;
  selectedSegmentId = bundle.reviewDraft.segments[0]?.segmentId ?? null;
  renderReview(bundle.reviewDraft, false);
  renderTimelineBundle(bundle.previewTimeline);
});

saveButton?.addEventListener('click', () => {
  void saveCurrentReview();
});

async function saveCurrentReview(): Promise<void> {
  if (currentReview === null) return;
  const segment = getSelectedSegment(currentReview);
  if (segment === null || saveButton === null) return;
  updateDraftFromForm(segment);
  saveButton.disabled = true;
  saveButton.textContent = '保存中…';
  showSaveStatus('保存中…', 'pending');
  try {
    await window.reviewUi.saveReview(currentReview);
    showSaveStatus('已保存', 'success');
  } catch (error) {
    showSaveStatus(`保存失败：${error instanceof Error ? error.message : String(error)}`, 'error');
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = '保存审核';
  }
}

segmentList?.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const segmentId = target.dataset.segment;
  if (segmentId === undefined) return;
  if (currentReview !== null) {
    const currentSegment = getSelectedSegment(currentReview);
    if (currentSegment !== null) updateDraftFromForm(currentSegment);
  }
  selectedSegmentId = segmentId;
  if (currentReview !== null) {
    renderReview(currentReview, true);
  }
});

preview?.addEventListener('timeupdate', () => {
  const range = selectedPlaybackRange;
  if (range === null || preview.currentTime < range.endSeconds - 0.03) return;
  const wasPlaying = !preview.paused;
  preview.currentTime = range.startSeconds;
  if (wasPlaying) void playSelectedPreview();
});

timelineStrip?.addEventListener('dblclick', () => {
  if (selectedSegmentId === null || window.reviewUi.localPreview === undefined) return;
  void window.reviewUi.localPreview(selectedSegmentId).then((result) => {
    if (!result.ok && timelineStrip !== null) timelineStrip.dataset.localPreviewError = result.error ?? 'local preview failed';
  });
});

function getSelectedSegment(review: EditReview): EditReviewSegment | null {
  return review.segments.find((segment) => segment.segmentId === selectedSegmentId) ?? review.segments[0] ?? null;
}

function updateDraftFromForm(segment: EditReviewSegment): void {
  const status = statusSelect?.value;
  if (status === 'approved' || status === 'pickup-required' || status === 'rejected') segment.status = status;
  const startValue = boundaryStart?.valueAsNumber;
  const endValue = boundaryEnd?.valueAsNumber;
  if (Number.isFinite(startValue)) segment.adjustedStartMs = startValue;
  if (Number.isFinite(endValue)) segment.adjustedEndMs = endValue;
  const selectedSource = sourceSelect?.value;
  if (selectedSource !== undefined && selectedSource.length > 0) segment.selectedSourceId = selectedSource;
  const strategy = waitStrategy?.value;
  if (strategy === 'keep' || strategy === 'compress') segment.waitStrategy = strategy;
  segment.reviewReasons = reasons?.value.split(/\r?\n/).filter(Boolean) ?? segment.reviewReasons;
}

function renderReview(review: EditReview, autoplay: boolean): void {
  if (segmentList !== null) {
    segmentList.replaceChildren(...review.segments.map((segment, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.segment = segment.segmentId;
      button.setAttribute('aria-pressed', String(segment.segmentId === selectedSegmentId));
      button.textContent = formatSegmentLabel(segment.segmentId, segment.status, index);
      return button;
    }));
  }
  const segment = getSelectedSegment(review);
  if (agentReason !== null) agentReason.textContent = segment?.reviewReasons.join('; ') ?? '无';
  if (statusSelect !== null && segment !== null) statusSelect.value = segment.status;
  if (reasons !== null && segment !== null) reasons.value = segment.reviewReasons.join('\n');
  if (boundaryStart !== null) boundaryStart.value = String(segment?.adjustedStartMs ?? '');
  if (boundaryEnd !== null) boundaryEnd.value = String(segment?.adjustedEndMs ?? '');
  if (waitStrategy !== null) waitStrategy.value = segment?.waitStrategy ?? 'keep';
  renderSources(segment?.selectedSourceId ?? null);
  renderPreview(segment, autoplay);
  renderTimeline(review, segment);
}

function renderSources(selectedSourceId: string | null): void {
  if (sourceSelect === null || currentBundle === null) return;
  const options = ((currentBundle.sourceCatalog as { sources?: Array<{ id: string; kind?: string; status?: string; attempt?: number | null }> }).sources ?? []).map((source) => {
    const option = new Option(formatSourceLabel(source), source.id);
    option.selected = source.id === selectedSourceId;
    return option;
  });
  sourceSelect.replaceChildren(...options);
}

function renderPreview(segment: EditReviewSegment | null, autoplay: boolean): void {
  if (preview === null || currentBundle === null || segment === null) return;
  const renderVersion = ++previewRenderVersion;
  preview.loop = false;
  if (preview.getAttribute('src') !== currentBundle.previewPath) {
    preview.src = currentBundle.previewPath;
  }
  if (segment?.adjustedStartMs !== undefined && segment.adjustedEndMs !== undefined) {
    preview.dataset.segmentStart = String(segment.adjustedStartMs);
    preview.dataset.segmentEnd = String(segment.adjustedEndMs);
  }
  try {
    const range = getSegmentPlaybackRange(currentBundle.previewTimeline, segment.segmentId);
    selectedPlaybackRange = range;
    showPreviewError(null);
    const seek = (): void => {
      if (renderVersion !== previewRenderVersion || selectedPlaybackRange !== range) return;
      preview.currentTime = range.startSeconds;
      if (autoplay) void playSelectedPreview();
    };
    if (preview.readyState >= 1) seek();
    else preview.addEventListener('loadedmetadata', seek, { once: true });
  } catch (error) {
    selectedPlaybackRange = null;
    preview.pause();
    showPreviewError(error instanceof Error ? error.message : String(error));
  }
}

async function playSelectedPreview(): Promise<void> {
  if (preview === null) return;
  try {
    await preview.play();
    showPreviewError(null);
  } catch (error) {
    showPreviewError(`无法播放所选片段：${error instanceof Error ? error.message : String(error)}`);
  }
}

function showPreviewError(message: string | null): void {
  if (previewError === null) return;
  previewError.hidden = message === null;
  previewError.textContent = message ?? '';
}

function showSaveStatus(message: string, state: 'pending' | 'success' | 'error'): void {
  if (saveStatus === null) return;
  saveStatus.textContent = message;
  saveStatus.dataset.state = state;
}

function renderTimeline(review: EditReview, segment: EditReviewSegment | null): void {
  if (timelineStrip === null) return;
  timelineStrip.textContent = review.segments
    .map((item, index) => formatSegmentLabel(item.segmentId, item.status, index))
    .join(' | ');
  if (segment !== null) {
    timelineStrip.dataset.selectedSegment = segment.segmentId;
  }
}

function renderTimelineBundle(previewTimeline: unknown): void {
  if (timelineStrip === null) return;
  const durationMs = typeof previewTimeline === 'object' && previewTimeline !== null && 'durationMs' in previewTimeline
    ? String((previewTimeline as { durationMs: unknown }).durationMs)
    : 'unknown';
  timelineStrip.dataset.previewDurationMs = durationMs;
}
