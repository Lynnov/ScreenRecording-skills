/// <reference path="./capture-renderer.d.ts" />

type RecorderMimeType = 'video/webm;codecs=vp9' | 'video/webm;codecs=vp8' | 'video/webm';

const startButton = document.querySelector<HTMLButtonElement>('#start');
const stopButton = document.querySelector<HTMLButtonElement>('#stop');
const statusText = document.querySelector<HTMLElement>('#status');
const checklist = document.querySelector<HTMLFieldSetElement>('#checklist');
const overlayClear = document.querySelector<HTMLInputElement>('#overlay-clear');
const multiTab = document.querySelector<HTMLInputElement>('#multi-tab');
const notes = document.querySelector<HTMLTextAreaElement>('#notes');
const submitChecklist = document.querySelector<HTMLButtonElement>('#submit-checklist');

let activeRecorder: MediaRecorder | null = null;
let activeStream: MediaStream | null = null;
let writeQueue = Promise.resolve();
let sequence = 0;
let firstChunkMarked = false;
let stopTimer: number | undefined;

window.addEventListener('manual-capture-stop-request', () => {
  void stopCapture();
});

startButton?.addEventListener('click', () => {
  void startCapture();
});

stopButton?.addEventListener('click', () => {
  void stopCapture();
});

submitChecklist?.addEventListener('click', () => {
  if (overlayClear === null || multiTab === null || notes === null) {
    return;
  }
  void window.manualCapture.submitChecklist({
    overlayEnteredCapture: !overlayClear.checked,
    multiTabContinuous: multiTab.checked,
    notes: notes.value,
  }).then(() => setStatus('checklist-submitted'));
});

async function startCapture(): Promise<void> {
  setStatus('requesting-display-media');
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  activeStream = stream;
  const video = document.createElement('video');
  video.muted = true;
  video.srcObject = stream;
  await video.play();
  await new Promise<void>((resolve) => video.requestVideoFrameCallback(() => resolve()));

  const recorder = new MediaRecorder(stream, { mimeType: pickRecorderMimeType() });
  activeRecorder = recorder;
  sequence = 0;
  firstChunkMarked = false;
  writeQueue = Promise.resolve();
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size === 0) {
      return;
    }
    const current = sequence++;
    writeQueue = writeQueue.then(async () => {
      if (!firstChunkMarked) {
        firstChunkMarked = true;
        await window.manualCapture.markFirstChunk(0, event.timecode);
      }
      const bytes = new Uint8Array(await event.data.arrayBuffer());
      await window.manualCapture.appendChunk(bytes, current, event.timecode);
    });
  });
  recorder.start(250);
  const durationSeconds = readDurationSeconds();
  if (durationSeconds !== null) {
    stopTimer = window.setTimeout(() => {
      void stopCapture();
    }, durationSeconds * 1000);
  }
  setStatus('recording');
}

async function stopCapture(): Promise<void> {
  const recorder = activeRecorder;
  const stream = activeStream;
  if (recorder === null || stream === null) {
    return;
  }
  setStatus('stopping');
  if (stopTimer !== undefined) {
    window.clearTimeout(stopTimer);
    stopTimer = undefined;
  }
  const stopped = new Promise<void>((resolve) => recorder.addEventListener('stop', () => resolve(), { once: true }));
  recorder.stop();
  await stopped;
  await writeQueue;
  await window.manualCapture.flush(sequence - 1);
  stream.getTracks().forEach((track) => track.stop());
  await window.manualCapture.stop();
  checklist?.removeAttribute('hidden');
  setStatus('stopped');
}

function pickRecorderMimeType(): RecorderMimeType {
  const candidates: RecorderMimeType[] = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? 'video/webm';
}

function readDurationSeconds(): number | null {
  const argument = location.search.match(/[?&]durationSeconds=(\d+)/)?.[1];
  if (argument === undefined) {
    return null;
  }
  const value = Number(argument);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function setStatus(status: string): void {
  if (statusText !== null) {
    statusText.textContent = status;
  }
}
