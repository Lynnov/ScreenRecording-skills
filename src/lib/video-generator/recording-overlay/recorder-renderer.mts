import type {
  RecorderBridge,
  RecorderStreamLike,
} from './recorder-lifecycle.js';
import { createRecorderLifecycle } from './recorder-lifecycle.js';
import { waitForVideoFrame } from './video-frame-wait.js';

declare global {
  interface Window {
    manualRecorder: RecorderBridge & {
      onStart(listener: () => void): void;
      onStop(listener: () => void): void;
    };
  }
}

const lifecycle = createRecorderLifecycle({
  getDisplayMedia: () => navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }),
  waitForFirstVideoFrame: (stream, signal) => waitForFirstVideoFrame(stream, signal),
  createMediaRecorder: (stream) => new MediaRecorder(stream as MediaStream, {
    mimeType: selectMimeType(),
  }),
  bridge: window.manualRecorder,
});

window.manualRecorder.onStart(() => {
  void lifecycle.start().catch(() => undefined);
});
window.manualRecorder.onStop(() => {
  void lifecycle.stop().catch(() => undefined);
});

async function waitForFirstVideoFrame(stream: RecorderStreamLike, signal: AbortSignal): Promise<void> {
  const video = document.createElement('video');
  video.muted = true;
  await waitForVideoFrame({
    video,
    stream,
    signal,
    timeoutMs: 10_000,
  });
}

function selectMimeType(): string {
  return ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
    .find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? 'video/webm';
}

export {};
