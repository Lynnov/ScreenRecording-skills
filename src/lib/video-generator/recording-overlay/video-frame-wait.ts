interface EventTargetLike {
  addEventListener?(name: string, listener: () => void): void;
  removeEventListener?(name: string, listener: () => void): void;
}

interface VideoLike extends EventTargetLike {
  srcObject: unknown;
  addEventListener(name: string, listener: () => void): void;
  removeEventListener(name: string, listener: () => void): void;
  play(): Promise<void>;
  pause(): void;
  requestVideoFrameCallback(listener: () => void): number;
  cancelVideoFrameCallback?(handle: number): void;
}

interface StreamLike {
  getTracks(): Array<EventTargetLike>;
}

export async function waitForVideoFrame(input: {
  video: VideoLike;
  stream: StreamLike;
  signal: AbortSignal;
  timeoutMs: number;
}): Promise<void> {
  const { video, stream, signal, timeoutMs } = input;
  throwIfAborted(signal);
  video.srcObject = stream;
  let frameHandle: number | null = null;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const removals: Array<() => void> = [];

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (operation: () => void) => {
        if (settled) return;
        settled = true;
        operation();
      };
      const fail = (message: string) => settle(() => reject(new Error(message)));
      const onAbort = () => settle(() => reject(new DOMException('Video frame wait aborted', 'AbortError')));
      const onVideoError = () => fail('Video frame error');
      const onTrackEnded = () => fail('Capture track ended before first video frame');

      signal.addEventListener('abort', onAbort, { once: true });
      removals.push(() => signal.removeEventListener('abort', onAbort));
      if (signal.aborted) {
        onAbort();
        return;
      }
      video.addEventListener('error', onVideoError);
      removals.push(() => video.removeEventListener('error', onVideoError));
      for (const track of stream.getTracks()) {
        track.addEventListener?.('ended', onTrackEnded);
        removals.push(() => track.removeEventListener?.('ended', onTrackEnded));
      }
      timeoutHandle = setTimeout(() => fail(`First video frame timeout after ${timeoutMs}ms`), timeoutMs);
      void video.play().then(
        () => {
          if (settled) return;
          frameHandle = video.requestVideoFrameCallback(() => settle(resolve));
        },
        (error: unknown) => settle(() => reject(error)),
      );
    });
  } finally {
    if (timeoutHandle !== null) clearTimeout(timeoutHandle);
    if (frameHandle !== null) video.cancelVideoFrameCallback?.(frameHandle);
    for (const remove of removals) remove();
    video.pause();
    video.srcObject = null;
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException('Video frame wait aborted', 'AbortError');
  }
}
