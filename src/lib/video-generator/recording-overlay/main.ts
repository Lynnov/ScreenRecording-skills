import { app, BrowserWindow, globalShortcut, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createManualCommandDispatcher,
  createManualProductRuntime,
  type ManualProductRuntime,
} from '../manual/product-runtime.js';
import type {
  CreateManualOverlayStateInput,
  ManualOverlayCommand,
} from '../manual/state-machine.js';
import {
  MANUAL_OVERLAY_CHANNELS,
  isManualOverlayCommand,
  type ManualOverlaySnapshot,
} from './ipc.js';

let overlayWindow: BrowserWindow | null = null;
let runtime: ManualProductRuntime | null = null;

function moduleDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

export function createManualOverlayWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 380,
    height: 430,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    focusable: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(moduleDir(), 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  void win.loadFile(path.join(moduleDir(), 'overlay.html'));
  return win;
}

export async function handleManualOverlayCommand(
  command: ManualOverlayCommand,
): Promise<ManualOverlaySnapshot> {
  const pending = requireRuntime().dispatch(command);
  await Promise.resolve();
  publishSnapshot();
  const snapshot = await pending;
  publishSnapshot(snapshot);
  return snapshot;
}

const commandDispatcher = createManualCommandDispatcher(handleManualOverlayCommand);

function registerIpc(): void {
  ipcMain.handle(MANUAL_OVERLAY_CHANNELS.command, async (_event, command: unknown) => {
    if (!isManualOverlayCommand(command)) {
      throw new Error('Invalid manual overlay command.');
    }
    return commandDispatcher.fromOverlay(command);
  });
  ipcMain.handle(MANUAL_OVERLAY_CHANNELS.close, () => {
    overlayWindow?.close();
  });
}

export async function stopManualRecordingOverlay(): Promise<void> {
  globalShortcut.unregisterAll();
  ipcMain.removeHandler(MANUAL_OVERLAY_CHANNELS.command);
  ipcMain.removeHandler(MANUAL_OVERLAY_CHANNELS.close);
  overlayWindow?.close();
  overlayWindow = null;
  runtime = null;
}

function dispatchShortcut(shortcut: string): void {
  void commandDispatcher.fromShortcut(shortcut).catch((error: unknown) => {
    console.error(`[manual-overlay] shortcut ${shortcut} failed: ${error instanceof Error ? error.message : String(error)}`);
  });
}

function registerShortcuts(): void {
  for (const shortcut of ['F7', 'F8', 'Shift+F8', 'F9', 'F10']) {
    if (!globalShortcut.register(shortcut, () => dispatchShortcut(shortcut))) {
      throw new Error(`Unable to register global shortcut ${shortcut}; another manual runtime may still be running.`);
    }
  }
}

function publishSnapshot(snapshot = requireRuntime().snapshot()): void {
  overlayWindow?.webContents.send(MANUAL_OVERLAY_CHANNELS.snapshot, snapshot);
}

export function configureManualOverlayRuntime(value: ManualProductRuntime): void {
  runtime = value;
}

export function configureManualOverlayState(input: CreateManualOverlayStateInput): void {
  runtime = createManualProductRuntime({
    mode: input.mode,
    segmentId: input.segmentId,
    actionIds: input.actionIds ?? [input.actionId],
    sourceId: input.mode === 'pickup' ? `pickup-${input.attempt}` : 'original',
    sourceReady: () => false,
    capture: {
      start: async () => undefined,
      stop: async () => undefined,
    },
  });
}

export async function startManualRecordingOverlay(
  input?: CreateManualOverlayStateInput,
  productRuntime?: ManualProductRuntime,
): Promise<void> {
  if (productRuntime === undefined) {
    configureManualOverlayState(input ?? parseOverlayLaunchArgs(process.argv.slice(2)));
  } else {
    configureManualOverlayRuntime(productRuntime);
  }
  await app.whenReady();
  registerIpc();
  registerShortcuts();
  overlayWindow = createManualOverlayWindow();
  overlayWindow.webContents.once('did-finish-load', () => publishSnapshot());
  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });
}

function requireRuntime(): ManualProductRuntime {
  if (runtime === null) throw new Error('Manual product runtime is not configured.');
  return runtime;
}

function parseOverlayLaunchArgs(argv: string[]): CreateManualOverlayStateInput {
  const value = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  const mode = value('--mode') === 'pickup' ? 'pickup' : 'recording';
  const attempt = Number(value('--attempt') ?? '1');
  return {
    mode,
    segmentId: value('--segment') ?? 'segment-001',
    actionId: value('--action') ?? 'action-001',
    actionIds: value('--actions')?.split(',').filter(Boolean),
    attempt: Number.isInteger(attempt) && attempt > 0 ? attempt : 1,
  };
}

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  void startManualRecordingOverlay();
}
