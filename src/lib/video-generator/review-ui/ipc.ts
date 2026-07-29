import type { EditReview } from '../manual/review.js';

export const REVIEW_UI_CHANNELS = {
  loadBundle: 'review-ui:load-bundle',
  saveReview: 'review-ui:save-review',
  localPreview: 'review-ui:local-preview',
} as const;

export interface ReviewUiBundle {
  agentPlan: unknown;
  previewPath: string;
  previewTimeline: unknown;
  sourceCatalog: unknown;
  reviewDraft: EditReview;
}

export function isEditReviewLike(value: unknown): value is EditReview {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && (value as { version?: unknown }).version === 1
    && Array.isArray((value as { segments?: unknown }).segments);
}
