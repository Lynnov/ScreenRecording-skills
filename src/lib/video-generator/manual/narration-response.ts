import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { writeAtomicJson } from './atomic-writer.js';
import { createManualBundle, ensureManualBundleDirs, writeProtectedJson } from './bundle.js';
import {
  createNarrationAgentRequest,
  validateNarrationAgentResponseForRequest,
  type NarrationAgentRequest,
  type NarrationAgentResponse,
  type NarrationAgentSegment,
} from './narration-request.js';
import { resolvePathInsideRun } from './run-path.js';
import { validateManualSourceCatalog, validateRecordingGuide } from './schema.js';
import { buildEditFiltergraph } from '../editing/filtergraph.js';
import type { EditPlan } from '../editing/types.js';
import { availableManualSources, type ManualSourceCatalog, type RecordingGuide } from './types.js';

export interface ApprovedNarrationPointer {
  version: 1;
  narrationVersion: number;
  narrationPath: string;
  approvedAt: string;
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T;
}

async function nextVersion(agentDir: string): Promise<number> {
  await mkdir(agentDir, { recursive: true });
  const entries = await readdir(agentDir);
  return entries.reduce((maximum, entry) => {
    const match = /^narration-request\.v(\d{2,})\.json$/.exec(entry);
    return match === null ? maximum : Math.max(maximum, Number(match[1]));
  }, 0) + 1;
}

function versionFromResponsePath(filePath: string): number {
  const match = /^narration-response\.v(\d{2,})\.json$/.exec(path.basename(filePath));
  if (match === null) throw new Error(`Expected narration-response.vNN.json: ${filePath}`);
  return Number(match[1]);
}

async function readApprovedGuide(runDir: string): Promise<RecordingGuide> {
  const bundle = createManualBundle(runDir);
  const pointer = await readJson<{ guidePath?: string }>(bundle.approvedGuidePath);
  if (typeof pointer.guidePath !== 'string') throw new Error('Approved guide pointer is invalid.');
  const guide = await readJson<unknown>(resolvePathInsideRun(runDir, pointer.guidePath, 'Approved guide'));
  validateRecordingGuide(guide);
  return guide;
}

async function assertReviewComplete(runDir: string): Promise<void> {
  const bundle = createManualBundle(runDir);
  const pointer = await readJson<{ path?: string }>(bundle.reviewCurrentPath);
  if (typeof pointer.path !== 'string') throw new Error('Current review pointer is invalid.');
  const review = await readJson<{ reviewComplete?: boolean }>(resolvePathInsideRun(runDir, pointer.path, 'Current review'));
  if (review.reviewComplete !== true) throw new Error('Review is not complete; narration is blocked.');
}

export async function prepareNarrationAgentRequest(input: { runDir: string }): Promise<{ requestVersion: number; requestPath: string }> {
  const bundle = createManualBundle(input.runDir);
  await ensureManualBundleDirs(bundle);
  await assertReviewComplete(input.runDir);
  const effectivePointer = await readJson<{ path?: string }>(bundle.effectiveCurrentPlanPath);
  if (typeof effectivePointer.path !== 'string') throw new Error('Current effective plan pointer is invalid.');
  const effectivePlan = await readJson<EditPlan>(resolvePathInsideRun(input.runDir, effectivePointer.path, 'Current effective plan'));
  const catalog = await readJson<ManualSourceCatalog>(bundle.sourceCatalogPath);
  validateManualSourceCatalog(catalog);
  const request = createNarrationAgentRequest({
    approvedGuide: await readApprovedGuide(input.runDir),
    effectivePreviewTimeline: buildEditFiltergraph(effectivePlan, availableManualSources(catalog)).timeline,
  });
  const requestVersion = await nextVersion(bundle.agentDir);
  const requestPath = bundle.versionedAgentPath('narration-request', requestVersion);
  await writeProtectedJson(requestPath, request);
  return { requestVersion, requestPath };
}

export function renderNarrationMarkdown(segments: readonly NarrationAgentSegment[]): string {
  return `# Final Narration\n\n${segments.map((segment) => `## ${segment.segmentId}\n\n${segment.text.trim()}\n`).join('\n')}`;
}

export function parseNarrationMarkdown(markdown: string): Array<{ segmentId: string; text: string }> {
  const matches = [...markdown.matchAll(/(?:^|\r?\n)## ([^\r\n]+)\r?\n\r?\n([\s\S]*?)(?=\r?\n## |\s*$)/g)];
  if (matches.length === 0) throw new Error('Approved narration Markdown has no Segment sections.');
  return matches.map((match) => ({ segmentId: match[1]!.trim(), text: match[2]!.trim() }));
}

export async function applyNarrationAgentResponse(input: {
  runDir: string;
  responsePath: string;
}): Promise<{ version: number; narrationPath: string; warnings: string[] }> {
  const bundle = createManualBundle(input.runDir);
  const responsePath = resolvePathInsideRun(input.runDir, input.responsePath, 'Narration response');
  const version = versionFromResponsePath(responsePath);
  const request = await readJson<NarrationAgentRequest>(bundle.versionedAgentPath('narration-request', version));
  const response = await readJson<NarrationAgentResponse>(responsePath);
  validateNarrationAgentResponseForRequest(response, request);
  const narrationPath = bundle.versionedScriptPath('narration-final', version);
  await writeFile(narrationPath, renderNarrationMarkdown(response.segments), { encoding: 'utf8', flag: 'wx' });
  return { version, narrationPath, warnings: response.warnings };
}

export async function approveNarrationVersion(input: {
  runDir: string;
  version: number;
  approvedAt?: string;
}): Promise<ApprovedNarrationPointer> {
  const bundle = createManualBundle(input.runDir);
  const narrationPath = bundle.versionedScriptPath('narration-final', input.version);
  await access(narrationPath);
  parseNarrationMarkdown(await readFile(narrationPath, 'utf8'));
  const pointer: ApprovedNarrationPointer = {
    version: 1,
    narrationVersion: input.version,
    narrationPath,
    approvedAt: input.approvedAt ?? new Date().toISOString(),
  };
  await writeAtomicJson(bundle.approvedNarrationPath, pointer);
  return pointer;
}
