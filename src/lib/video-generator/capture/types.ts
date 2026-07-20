export interface CaptureSourceDescriptor {
  id: string;
  name: string;
}

export interface CaptureStartResult {
  rawVideoPath: string;
  firstFrameSessionTimeMs: number;
}

export interface CaptureStopResult {
  rawVideoPath: string;
  durationMs: number;
  complete: boolean;
}

export interface CaptureProvider {
  bindSource(title: string): Promise<CaptureSourceDescriptor>;
  start(): Promise<CaptureStartResult>;
  stop(): Promise<CaptureStopResult>;
}
