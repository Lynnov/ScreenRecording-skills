export interface EditCanvas {
  width: 1920;
  height: 1080;
  fps: 30;
}

export interface EditSource {
  id: string;
  path: string;
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  codecName: string;
  pixelFormat: string;
  hasAudio: boolean;
}

export interface EditClip {
  sourceId: string;
  sourceStartMs: number;
  sourceEndMs: number;
  playbackRate: number;
}

export interface EditPlanSegment {
  segmentId: string;
  title: string;
  clips: EditClip[];
  holdLastFrameMs?: number;
  transition?: 'cut' | 'short-fade';
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

export interface EditPlan {
  version: 1;
  canvas: EditCanvas;
  segments: EditPlanSegment[];
}

export interface PreviewTimelineClip extends EditClip {
  outputStartMs: number;
  outputEndMs: number;
}

export interface PreviewTimelineSegment {
  segmentId: string;
  startsAtMs: number;
  contentEndsAtMs: number;
  endsAtMs: number;
  clips: PreviewTimelineClip[];
}

export interface PreviewTimeline {
  version: 1;
  durationMs: number;
  segments: PreviewTimelineSegment[];
}
