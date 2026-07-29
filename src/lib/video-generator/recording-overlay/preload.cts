const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

const channels = {
  command: 'manual-overlay:command',
  snapshot: 'manual-overlay:snapshot',
} as const;
const commandTypes = new Set([
  'begin-countdown',
  'start-pickup',
  'confirm-action',
  'previous-action',
  'discard-attempt',
  'finish',
  'analyze',
  'review-ready',
]);

function isCommand(value: unknown): value is import('../manual/state-machine.js').ManualOverlayCommand {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && typeof (value as { type: unknown }).type === 'string'
    && commandTypes.has((value as { type: string }).type);
}

contextBridge.exposeInMainWorld('manualOverlay', {
  sendCommand: async (command: unknown) => {
    if (!isCommand(command)) {
      throw new Error('Invalid manual overlay command.');
    }
    await ipcRenderer.invoke(channels.command, command);
  },
  onSnapshot: (callback: (snapshot: import('./ipc.js').ManualOverlaySnapshot) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: unknown) => {
      callback(snapshot as import('./ipc.js').ManualOverlaySnapshot);
    };
    ipcRenderer.on(channels.snapshot, listener);
    return () => ipcRenderer.off(channels.snapshot, listener);
  },
});
