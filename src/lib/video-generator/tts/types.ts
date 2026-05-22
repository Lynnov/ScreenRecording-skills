export interface TtsRequest {
  segmentId: string;
  text: string;
  outputPath: string;
}

export interface TtsResult {
  segmentId: string;
  audioPath: string;
  durationMs: number;
}

export interface TtsProvider {
  synthesize(request: TtsRequest): Promise<TtsResult>;
}
