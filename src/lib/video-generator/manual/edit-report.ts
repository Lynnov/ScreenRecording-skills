import type { EditAgentResponse } from './edit-response.js';

export function formatEditAgentReport(response: EditAgentResponse): string {
  return [
    '# Agent 初剪报告',
    '',
    `Producer: ${response.producer.agentId}`,
    '',
    ...response.decisions.flatMap((decision) => [
      `## ${decision.segmentId}`,
      '',
      `- Confidence: ${decision.confidence}`,
      `- Reason: ${decision.reason}`,
      `- Review: ${decision.reviewReasons.length === 0 ? '无' : decision.reviewReasons.join('; ')}`,
      '',
    ]),
  ].join('\n');
}
