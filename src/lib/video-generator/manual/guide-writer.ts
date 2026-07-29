import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createGuideAgentRequest, validateGuideAgentRequest, validateGuideAgentResponseForRequest } from './agent-exchange.js';
import { writeAtomicJson, writeNewJson } from './atomic-writer.js';
import { createManualBundle, ensureManualBundleDirs, writeProtectedJson } from './bundle.js';
import type { GuideAgentRequest, GuideAgentResponse, RecordingGuide } from './types.js';

export const MANUAL_BUSINESS_DATA_NOTICE = 'Manual guide request includes local business script text; 第一版不做脱敏，请仅在本地可信 Agent 会话中使用。';

export interface PrepareGuideAgentRequestInput {
  sourceScriptPath: string;
  outputDir: string;
  createdAt?: string;
}

export interface PrepareGuideAgentRequestResult {
  requestVersion: number;
  requestPath: string;
  originalScriptPath: string;
  businessDataNotice: string;
}

export interface ApplyGuideAgentResponseInput {
  runDir: string;
  responsePath: string;
}

export interface ApplyGuideAgentResponseResult {
  version: number;
  polishedPath: string;
  executablePath: string;
  guidePath: string;
  guide: RecordingGuide;
  warnings: string[];
}

export interface ApproveRecordingGuideVersionInput {
  runDir: string;
  version: number;
  approvedAt?: string;
}

export interface ApprovedRecordingGuidePointer {
  version: 1;
  guideVersion: number;
  guidePath: string;
  approvedAt: string;
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T;
}

async function ensureOriginalScript(originalPath: string, sourceText: string): Promise<void> {
  try {
    await writeFile(originalPath, sourceText, { encoding: 'utf8', flag: 'wx' });
    return;
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : '';
    if (code !== 'EEXIST') throw error;
  }

  const existing = await readFile(originalPath, 'utf8');
  if (existing !== sourceText) {
    throw new Error(`scripts/original.md already exists with different content. Do not overwrite original.md: ${originalPath}`);
  }
}

function extractVersionFromPath(filePath: string, prefix: string): number {
  const match = new RegExp(`${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.v(\\d{2,})\\.json$`).exec(path.basename(filePath));
  if (match === null) throw new Error(`Expected ${prefix}.vNN.json response path: ${filePath}`);
  return Number(match[1]);
}

export async function prepareGuideAgentRequest(input: PrepareGuideAgentRequestInput): Promise<PrepareGuideAgentRequestResult> {
  const bundle = createManualBundle(input.outputDir);
  await ensureManualBundleDirs(bundle);
  const sourceText = await readFile(input.sourceScriptPath, 'utf8');
  await ensureOriginalScript(bundle.originalScriptPath, sourceText);

  const request = createGuideAgentRequest({
    sourceScriptPath: input.sourceScriptPath,
    sourceText,
  });
  validateGuideAgentRequest(request);

  const requestVersion = await nextGuideRequestVersion(bundle.agentDir);
  const requestPath = bundle.versionedAgentPath('guide-request', requestVersion);
  await writeProtectedJson(requestPath, request);
  await writeManualRunReport(bundle.rootDir, {
    stage: 'guide-prepare',
    businessDataNotice: MANUAL_BUSINESS_DATA_NOTICE,
    requestPath,
    createdAt: input.createdAt ?? new Date().toISOString(),
  });

  return {
    requestVersion,
    requestPath,
    originalScriptPath: bundle.originalScriptPath,
    businessDataNotice: MANUAL_BUSINESS_DATA_NOTICE,
  };
}

async function nextGuideRequestVersion(agentDir: string): Promise<number> {
  await mkdir(agentDir, { recursive: true });
  for (let version = 1; version < 1000; version += 1) {
    try {
      await readFile(path.join(agentDir, `guide-request.v${String(version).padStart(2, '0')}.json`), 'utf8');
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : '';
      if (code === 'ENOENT') return version;
      throw error;
    }
  }
  throw new Error('Unable to allocate guide request version.');
}

export async function applyGuideAgentResponse(input: ApplyGuideAgentResponseInput): Promise<ApplyGuideAgentResponseResult> {
  const bundle = createManualBundle(input.runDir);
  await ensureManualBundleDirs(bundle);
  const version = extractVersionFromPath(input.responsePath, 'guide-response');
  const requestPath = bundle.versionedAgentPath('guide-request', version);
  const request = await readJson<GuideAgentRequest>(requestPath);
  validateGuideAgentRequest(request);
  const response = await readJson<GuideAgentResponse>(input.responsePath);
  validateGuideAgentResponseForRequest(response, request);

  const polishedPath = bundle.versionedScriptPath('polished', version);
  const executablePath = bundle.versionedScriptPath('executable', version);
  const guidePath = bundle.versionedScriptPath('recording-guide', version);

  await writeFile(polishedPath, response.polishedMarkdown, { encoding: 'utf8', flag: 'wx' });
  await writeFile(executablePath, response.executableMarkdown, { encoding: 'utf8', flag: 'wx' });
  await writeNewJson(guidePath, response.guide);
  await writeManualRunReport(bundle.rootDir, {
    stage: 'guide-apply',
    businessDataNotice: MANUAL_BUSINESS_DATA_NOTICE,
    responsePath: input.responsePath,
    guidePath,
    producer: response.producer,
    warnings: response.warnings,
  });

  return {
    version,
    polishedPath,
    executablePath,
    guidePath,
    guide: response.guide,
    warnings: response.warnings,
  };
}

export async function approveRecordingGuideVersion(input: ApproveRecordingGuideVersionInput): Promise<ApprovedRecordingGuidePointer> {
  const bundle = createManualBundle(input.runDir);
  const guidePath = bundle.versionedScriptPath('recording-guide', input.version);
  const guide = await readJson<unknown>(guidePath);
  // Reuse guide response validation indirectly is too broad here; approved pointer only requires the guide file exists and is JSON.
  if (typeof guide !== 'object' || guide === null) {
    throw new Error(`Recording guide version ${input.version} is not a JSON object: ${guidePath}`);
  }
  const pointer: ApprovedRecordingGuidePointer = {
    version: 1,
    guideVersion: input.version,
    guidePath,
    approvedAt: input.approvedAt ?? new Date().toISOString(),
  };
  await writeAtomicJson(bundle.approvedGuidePath, pointer);
  await writeManualRunReport(bundle.rootDir, {
    stage: 'guide-approve',
    businessDataNotice: MANUAL_BUSINESS_DATA_NOTICE,
    guidePath,
    approvedAt: pointer.approvedAt,
  });
  return pointer;
}

async function writeManualRunReport(runDir: string, patch: Record<string, unknown>): Promise<void> {
  const bundle = createManualBundle(runDir);
  const reportPath = bundle.reportPath('manual-run-report');
  let previous: Record<string, unknown> = {};
  try {
    previous = JSON.parse(await readFile(reportPath, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : '';
    if (code !== 'ENOENT') throw error;
  }
  await writeAtomicJson(reportPath, { ...previous, ...patch });
}
