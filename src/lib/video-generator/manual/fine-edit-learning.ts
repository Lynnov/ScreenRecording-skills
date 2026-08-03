import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { writeAtomicJson } from './atomic-writer.js';
import { writeVersionedJson } from './bundle.js';
import type { FineEditQualityReport } from './fine-edit-quality.js';
import type { FineEditRules } from './fine-edit-rules.js';

export interface FineEditLearningCandidate {
  version: 1;
  runDir: string;
  eligible: boolean;
  reason: string;
  basedOnRulesVersion: number;
  proposedRules: FineEditRules;
}

function boundedAdjustment(current: number, desired: number, maximumRatio: number): number {
  const limit = Math.abs(current * maximumRatio);
  return Math.round(Math.max(current - limit, Math.min(current + limit, desired)));
}

export function buildFineEditLearningCandidate(input: {
  rules: FineEditRules;
  quality: FineEditQualityReport;
  runDir: string;
}): FineEditLearningCandidate {
  const averageSilentTailMs = input.quality.segments.length === 0
    ? input.rules.soft.resultReactionMs
    : input.quality.segments.reduce((sum, segment) => sum + segment.silentTailMs, 0) / input.quality.segments.length;
  const proposedRules: FineEditRules = {
    ...input.rules,
    hard: { ...input.rules.hard },
    soft: {
      ...input.rules.soft,
      resultReactionMs: Math.max(800, Math.min(2000, boundedAdjustment(
        input.rules.soft.resultReactionMs,
        averageSilentTailMs,
        input.rules.evolution.maxAdjustmentRatio,
      ))),
    },
    evolution: { ...input.rules.evolution },
  };
  const eligible = input.rules.evolution.enabled
    && input.quality.status === 'passed'
    && input.quality.requiredEventCoverage === 1;
  return {
    version: 1,
    runDir: input.runDir,
    eligible,
    reason: eligible
      ? 'Quality passed with complete required-event coverage.'
      : 'Only quality=passed runs with complete required-event coverage may promote learned rules.',
    basedOnRulesVersion: input.rules.version,
    proposedRules,
  };
}

export async function persistFineEditLearningCandidate(input: {
  candidate: FineEditLearningCandidate;
  candidatePath: string;
  learningDir: string;
}): Promise<string | undefined> {
  await writeAtomicJson(input.candidatePath, input.candidate);
  if (!input.candidate.eligible) return undefined;
  await mkdir(input.learningDir, { recursive: true });
  const learned = await writeVersionedJson(input.learningDir, 'profile', input.candidate.proposedRules);
  await writeAtomicJson(path.join(input.learningDir, 'current.json'), {
    version: 1,
    path: learned.path,
    sourceRunDir: input.candidate.runDir,
  });
  return learned.path;
}
