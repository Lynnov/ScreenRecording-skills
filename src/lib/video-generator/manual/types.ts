import type { EditSource } from '../editing/types.js';

export interface AgentProducer {
  agentId: string;
  provider?: string;
  model?: string;
  generatedAt: string;
}

export const EXPECTED_EVENT_TYPES = ['click', 'input', 'change', 'scroll', 'navigation', 'tab'] as const;
export type ExpectedEventType = typeof EXPECTED_EVENT_TYPES[number];

export interface BaseExpectedEvent {
  type: ExpectedEventType;
  target?: string;
  description?: string;
}

export type ExpectedEvent = BaseExpectedEvent;

export const EXPECTED_RESULT_TYPES = [
  'dialog-visible',
  'text-visible',
  'url-matches',
  'element-state',
  'selected-value',
  'tab-created',
] as const;
export type ExpectedResultType = typeof EXPECTED_RESULT_TYPES[number];

export type ExpectedResult =
  | { type: 'dialog-visible'; text?: string; description?: string }
  | { type: 'text-visible'; text: string; description?: string }
  | { type: 'url-matches'; pattern: string; description?: string }
  | { type: 'element-state'; target: string; state: 'visible' | 'hidden' | 'enabled' | 'disabled'; description?: string }
  | { type: 'selected-value'; target: string; value: string; description?: string }
  | { type: 'tab-created'; title?: string; urlPattern?: string; description?: string };

export interface RecordingGuideAction {
  id: string;
  segmentId: string;
  title: string;
  instruction: string;
  expectedEvents: ExpectedEvent[];
  expectedResults: ExpectedResult[];
}

export interface RecordingGuide {
  version: 1;
  startUrl: string;
  actions: RecordingGuideAction[];
}

export interface GuideAgentRequest {
  version: 1;
  kind: 'manual-guide-request';
  sourceScriptPath: string;
  sourceText: string;
  constraints: {
    observerOnly: true;
    manualTabSwitching: true;
    allowedExpectedEventTypes: string[];
    allowedExpectedResultTypes: string[];
  };
}

export interface GuideAgentResponse {
  version: 1;
  kind: 'manual-guide-response';
  requestVersion: number;
  producer: AgentProducer;
  polishedMarkdown: string;
  executableMarkdown: string;
  guide: RecordingGuide;
  warnings: string[];
}

interface ManualSourceIdentity {
  id: string;
  path: string;
  kind: 'original' | 'pickup';
  segmentId: string | null;
  attempt: number | null;
  createdAt: string;
}

export interface ManualUsableSource extends EditSource, ManualSourceIdentity {
  status: 'available' | 'superseded';
  failureReason?: never;
}

export interface ManualFailedSource extends ManualSourceIdentity {
  status: 'failed';
  failureReason: string;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  codecName: string | null;
  pixelFormat: string | null;
  hasAudio: boolean | null;
}

export type ManualSource = ManualUsableSource | ManualFailedSource;

export interface ManualSourceCatalog {
  version: 1;
  sources: ManualSource[];
}

export function availableManualSources(catalog: ManualSourceCatalog): ManualUsableSource[] {
  return catalog.sources.filter((source): source is ManualUsableSource => source.status === 'available');
}
