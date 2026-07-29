const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');
const reviewIpc: typeof import('./ipc.js') = require('./ipc.js');

contextBridge.exposeInMainWorld('reviewUi', {
  loadBundle: () => ipcRenderer.invoke(reviewIpc.REVIEW_UI_CHANNELS.loadBundle),
  saveReview: async (review: unknown) => {
    if (!reviewIpc.isEditReviewLike(review)) throw new Error('Invalid edit review payload.');
    await ipcRenderer.invoke(reviewIpc.REVIEW_UI_CHANNELS.saveReview, review);
  },
  localPreview: (segmentId: string) => ipcRenderer.invoke(reviewIpc.REVIEW_UI_CHANNELS.localPreview, { segmentId }),
});
