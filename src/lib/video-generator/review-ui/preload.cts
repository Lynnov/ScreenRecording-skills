const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

const channels = {
  loadBundle: 'review-ui:load-bundle',
  saveReview: 'review-ui:save-review',
  localPreview: 'review-ui:local-preview',
} as const;

function isEditReviewLike(value: unknown): value is import('./ipc.js').ReviewUiBundle['reviewDraft'] {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && (value as { version?: unknown }).version === 1
    && Array.isArray((value as { segments?: unknown }).segments);
}

contextBridge.exposeInMainWorld('reviewUi', {
  loadBundle: () => ipcRenderer.invoke(channels.loadBundle),
  saveReview: async (review: unknown) => {
    if (!isEditReviewLike(review)) throw new Error('Invalid edit review payload.');
    await ipcRenderer.invoke(channels.saveReview, review);
  },
  localPreview: (segmentId: string) => ipcRenderer.invoke(channels.localPreview, { segmentId }),
});
