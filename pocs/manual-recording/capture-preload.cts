import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('manualCapture', {
  appendChunk: (bytes: Uint8Array, sequence: number, timecode: number) => ipcRenderer.invoke('capture:append-chunk', bytes, sequence, timecode),
  markFirstChunk: (sequence: 0, timecode: number) => ipcRenderer.invoke('capture:first-chunk', sequence, timecode),
  flush: (lastSequence: number) => ipcRenderer.invoke('capture:flush', lastSequence),
  stop: () => ipcRenderer.invoke('capture:stop'),
  submitChecklist: (value: { overlayEnteredCapture: boolean; multiTabContinuous: boolean; notes: string }) => ipcRenderer.invoke('capture:submit-checklist', value),
});
