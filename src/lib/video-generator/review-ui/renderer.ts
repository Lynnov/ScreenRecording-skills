/// <reference lib="dom" />

import type { EditReview, EditReviewSegment } from '../manual/review.js';
import type { ReviewUiBundle } from './ipc.js';

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
const statusSelect = document.querySelector<HTMLSelectElement>('#review-status');
const reasons = document.querySelector<HTMLTextAreaElement>('#review-reasons');
const boundaryStart = document.querySelector<HTMLInputElement>('#boundary-start');
const boundaryEnd = document.querySelector<HTMLInputElement>('#boundary-end');
const sourceSelect = document.querySelector<HTMLSelectElement>('#source-select');
const waitStrategy = document.querySelector<HTMLSelectElement>('#wait-strategy');
const preview = document.querySelector<HTMLVideoElement>('#segment-preview');
const timelineStrip = document.querySelector<HTMLElement>('#timeline-strip');

let currentReview: EditReview | null = null;
let currentBundle: ReviewUiBundle | null = null;
let selectedSegmentId: string | null = null;

void window.reviewUi.loadBundle().then((bundle) => {
  currentBundle = bundle;
  currentReview = bundle.reviewDraft;
  selectedSegmentId = bundle.reviewDraft.segments[0]?.segmentId ?? null;
  renderReview(bundle.reviewDraft);
  renderPreview(bundle.reviewDraft.segments[0] ?? null);
  renderTimelineBundle(bundle.previewTimeline);
});

saveButton?.addEventListener('click', () => {
  if (currentReview === null) return;
  const segment = getSelectedSegment(currentReview);
  if (segment !== null) {
    updateDraftFromForm(segment);
    void window.reviewUi.saveReview(currentReview);
  }
});

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
    renderReview(currentReview);
  }
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

function renderReview(review: EditReview): void {
  if (segmentList !== null) {
    segmentList.replaceChildren(...review.segments.map((segment) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.segment = segment.segmentId;
      button.setAttribute('aria-pressed', String(segment.segmentId === selectedSegmentId));
      button.textContent = `${segment.segmentId} · ${segment.status}`;
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
  renderSources(review, segment?.selectedSourceId ?? null);
  renderPreview(segment);
  renderTimeline(review, segment);
}

function renderSources(review: EditReview, selectedSourceId: string | null): void {
  if (sourceSelect === null || currentBundle === null) return;
  const options = ((currentBundle.sourceCatalog as { sources?: Array<{ id: string; status?: string }> }).sources ?? []).map((source) => {
    const option = new Option(`${source.id} · ${source.status ?? 'available'}`, source.id);
    option.selected = source.id === selectedSourceId;
    return option;
  });
  sourceSelect.replaceChildren(...options);
}

function renderPreview(segment: EditReviewSegment | null): void {
  if (preview === null || currentBundle === null) return;
  preview.src = currentBundle.previewPath;
  preview.loop = true;
  if (segment?.adjustedStartMs !== undefined && segment.adjustedEndMs !== undefined) {
    preview.dataset.segmentStart = String(segment.adjustedStartMs);
    preview.dataset.segmentEnd = String(segment.adjustedEndMs);
  }
}

function renderTimeline(review: EditReview, segment: EditReviewSegment | null): void {
  if (timelineStrip === null) return;
  timelineStrip.textContent = review.segments.map((item) => `${item.segmentId}:${item.status}`).join(' | ');
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
