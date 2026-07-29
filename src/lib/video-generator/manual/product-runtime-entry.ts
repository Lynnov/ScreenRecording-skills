import type { CaptureSourceDescriptor } from '../capture/types.js';
import type { ManualRecordDisplayMode } from './record-controller.js';

export interface ManualProductCompositionInput {
  mode: 'recording' | 'pickup';
  runDir: string;
  displayMode: ManualRecordDisplayMode;
  segmentId?: string;
}

export interface ManualProductGuideScope {
  startUrl: string;
  actionIds: string[];
}

export interface ManualProductLoadedInput {
  guide: ManualProductGuideScope;
  segmentId: string;
  sourceId: string;
}

interface Closeable {
  close(): void | Promise<void>;
}

interface ProductChromium extends Closeable {
  bindingTitle: string;
  navigateToStartUrl(): Promise<void>;
}

export interface ManualProductCompositionReport {
  ok: boolean;
  mode: 'recording' | 'pickup';
  runDir: string;
  segmentId: string;
  errorMessage?: string;
  cleanupErrors: string[];
}

export interface ManualProductCompositionDeps {
  loadInput(input: ManualProductCompositionInput): Promise<ManualProductLoadedInput>;
  launchChromium(input: ManualProductLoadedInput): Promise<ProductChromium>;
  bindSource(bindingTitle: string): Promise<CaptureSourceDescriptor>;
  applyDisplayMode(
    source: CaptureSourceDescriptor,
    mode: ManualRecordDisplayMode,
  ): Promise<() => void | Promise<void>>;
  installObservers(input: {
    loaded: ManualProductLoadedInput;
    chromium: ProductChromium;
  }): Promise<Closeable>;
  createCapture(input: {
    loaded: ManualProductLoadedInput;
    chromium: ProductChromium;
    source: CaptureSourceDescriptor;
  }): Closeable;
  createRuntime(input: {
    loaded: ManualProductLoadedInput;
    capture: Closeable;
  }): Closeable;
  startOverlay(input: {
    loaded: ManualProductLoadedInput;
    runtime: Closeable;
  }): Promise<Closeable>;
  runController(input: {
    loaded: ManualProductLoadedInput;
    chromium: ProductChromium;
    capture: Closeable;
    runtime: Closeable;
  }): Promise<{ ok: boolean }>;
  writeReport(report: ManualProductCompositionReport): Promise<string>;
}

export async function runManualProductComposition(
  input: ManualProductCompositionInput,
  deps: ManualProductCompositionDeps,
): Promise<{ exitCode: number; reportPath: string }> {
  let loaded: ManualProductLoadedInput | undefined;
  let chromium: ProductChromium | undefined;
  let restoreDisplay: (() => void | Promise<void>) | undefined;
  let observers: Closeable | undefined;
  let capture: Closeable | undefined;
  let runtime: Closeable | undefined;
  let overlay: Closeable | undefined;
  let firstError: Error | undefined;
  let controllerOk = false;
  const cleanupErrors: string[] = [];

  try {
    loaded = await deps.loadInput(input);
    chromium = await deps.launchChromium(loaded);
    const source = await deps.bindSource(chromium.bindingTitle);
    restoreDisplay = await deps.applyDisplayMode(source, input.displayMode);
    observers = await deps.installObservers({ loaded, chromium });
    await chromium.navigateToStartUrl();
    capture = deps.createCapture({ loaded, chromium, source });
    runtime = deps.createRuntime({ loaded, capture });
    overlay = await deps.startOverlay({ loaded, runtime });
    controllerOk = (await deps.runController({ loaded, chromium, capture, runtime })).ok;
    if (!controllerOk) firstError = new Error('Manual product controller reported failure.');
  } catch (error) {
    firstError = toError(error);
  } finally {
    for (const operation of [
      () => runtime?.close(),
      () => capture?.close(),
      () => observers?.close(),
      () => restoreDisplay?.(),
      () => overlay?.close(),
      () => chromium?.close(),
    ]) {
      try {
        await operation();
      } catch (error) {
        cleanupErrors.push(toError(error).message);
      }
    }
  }

  const reportPath = await deps.writeReport({
    ok: firstError === undefined && controllerOk,
    mode: input.mode,
    runDir: input.runDir,
    segmentId: loaded?.segmentId ?? input.segmentId ?? '',
    ...(firstError === undefined ? {} : { errorMessage: firstError.message }),
    cleanupErrors,
  });
  return {
    exitCode: firstError === undefined && controllerOk ? 0 : 1,
    reportPath,
  };
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
