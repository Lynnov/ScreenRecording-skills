import type { AgentProducer, ManualSourceCatalog, RecordingGuide } from './types.js';
import type { EditPlan } from '../editing/types.js';

export interface EditAgentRequest {
  version: 1;
  kind: 'manual-edit-request';
  requestVersion: number;
  approvedGuide: RecordingGuide;
  manifest: unknown;
  events: unknown[];
  sourceCatalog: ManualSourceCatalog;
  keyframes: Array<{ atMs: number; reason: string; fileName: string }>;
  scope: {
    segmentId: string;
    baselinePlan: EditPlan;
    requiredSourceId: string;
  } | null;
  continuityKeyframes: {
    pickup: {
      segmentId: string;
      sourceId: string;
      firstFramePath: string;
      lastFramePath: string;
    };
    previous: { segmentId: string; sourceId: string; atMs: number; framePath: string } | null;
    next: { segmentId: string; sourceId: string; atMs: number; framePath: string } | null;
  } | null;
  constraints: {
    noFullVideoUpload: true;
    maxNormalPlaybackRate: 2;
    maxHoldMs: 5000;
    requireReviewReasonsForLowConfidence: true;
  };
}

export interface EditAgentResponse {
  version: 1;
  kind: 'manual-edit-response';
  requestVersion: number;
  producer: AgentProducer;
  plan: EditPlan;
  decisions: Array<{
    segmentId: string;
    confidence: 'high' | 'medium' | 'low';
    reason: string;
    reviewReasons: string[];
  }>;
}
