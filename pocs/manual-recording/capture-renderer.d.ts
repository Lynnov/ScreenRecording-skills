export {};

declare global {
  interface ManualCaptureApi {
    appendChunk(bytes: Uint8Array, sequence: number, timecode: number): Promise<void>;
    markFirstChunk(sequence: 0, timecode: number): Promise<void>;
    flush(lastSequence: number): Promise<void>;
    stop(): Promise<void>;
    submitChecklist(value: { overlayEnteredCapture: boolean; multiTabContinuous: boolean; notes: string }): Promise<void>;
  }

  interface Window {
    manualCapture: ManualCaptureApi;
  }
}
