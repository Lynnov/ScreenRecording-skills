const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');
const { createRecorderPreloadApi } = require('./recorder-preload-api.cjs') as typeof import('./recorder-preload-api.cjs');

contextBridge.exposeInMainWorld('manualRecorder', createRecorderPreloadApi(ipcRenderer));
