import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { createManualBundle, ensureManualBundleDirs } from './bundle.js';
import { writeAtomicJson, writeNewJson } from './atomic-writer.js';
import { planManualKeyframes } from './keyframes.js';
import { formatEditAgentReport } from './edit-report.js';
import { validateAgentProducer, validateManualSourceCatalog, validateRecordingGuide } from './schema.js';
import { availableManualSources, type ManualSourceCatalog, type RecordingGuide } from './types.js';
import type { EditAgentRequest, EditAgentResponse } from './edit-response.js';
import { validateEditPlan } from '../editing/validator.js';
import type { EditPlan } from '../editing/types.js';
import type { RecordingEvent, RecordingManifest } from '../recording/types.js';
import { resolvePathInsideRun } from './run-path.js';

const SAFE_SEGMENT_ID = /^segment-[A-Za-z0-9][A-Za-z0-9_-]*$/;

export type { EditAgentRequest } from './edit-response.js';

export interface PrepareEditAgentRequestInput {
  runDir: string;
  segmentId?: string;
}

export interface PrepareEditAgentRequestResult {
  requestVersion: number;
  requestPath: string;
}

export interface ApplyEditAgentResponseInput {
  runDir: string;
  responsePath: string;
}

export interface ApplyEditAgentResponseResult {
  version: number;
  planPath: string;
  reportPath: string;
}

export function createEditAgentRequest(
  input: Omit<EditAgentRequest, 'version' | 'kind' | 'requestVersion' | 'constraints' | 'scope' | 'continuityKeyframes'>
    & {
      requestVersion?: number;
      scope?: EditAgentRequest['scope'];
      continuityKeyframes?: EditAgentRequest['continuityKeyframes'];
    },
): EditAgentRequest {
  return {
    version: 1,
    kind: 'manual-edit-request',
    requestVersion: input.requestVersion ?? 1,
    approvedGuide: input.approvedGuide,
    manifest: input.manifest,
    events: input.events,
    sourceCatalog: input.sourceCatalog,
    keyframes: input.keyframes,
    scope: input.scope ?? null,
    continuityKeyframes: input.continuityKeyframes ?? null,
    constraints: {
      noFullVideoUpload: true,
      maxNormalPlaybackRate: 2,
      maxHoldMs: 5000,
      requireReviewReasonsForLowConfidence: true,
    },
  };
}

export async function prepareEditAgentRequest(input: PrepareEditAgentRequestInput): Promise<PrepareEditAgentRequestResult> {
  if (input.segmentId !== undefined && !SAFE_SEGMENT_ID.test(input.segmentId)) {
    throw new Error(`Invalid segmentId for manual analyze: ${input.segmentId}`);
  }
  const bundle = createManualBundle(input.runDir);
  await ensureManualBundleDirs(bundle);
  const approvedGuide = await readApprovedGuide(input.runDir);
  const manifest = JSON.parse(await readFile(bundle.recordingManifestPath, 'utf8')) as RecordingManifest;
  const sourceCatalog = JSON.parse(await readFile(bundle.sourceCatalogPath, 'utf8')) as ManualSourceCatalog;
  validateManualSourceCatalog(sourceCatalog);
  const allEvents = await readEvents(bundle.eventsPath);
  let requestGuide = approvedGuide;
  let events = allEvents;
  let scope: EditAgentRequest['scope'] = null;
  let continuityKeyframes: EditAgentRequest['continuityKeyframes'] = null;
  if (input.segmentId !== undefined) {
    const baselinePlan = await readCurrentAgentPlan(input.runDir);
    if (!baselinePlan.segments.some((segment) => segment.segmentId === input.segmentId)) {
      throw new Error(`Segment ${input.segmentId} does not exist in the current agent plan.`);
    }
    const targetActions = approvedGuide.actions.filter((action) => action.segmentId === input.segmentId);
    if (targetActions.length === 0) {
      throw new Error(`Segment ${input.segmentId} does not exist in the approved guide.`);
    }
    const actionIds = new Set(targetActions.map((action) => action.id));
    requestGuide = { ...approvedGuide, actions: targetActions };
    events = allEvents.filter((event) => {
      const payload = event.payload;
      return payload?.segmentId === input.segmentId
        || (typeof payload?.actionId === 'string' && actionIds.has(payload.actionId));
    });
    const requiredPickup = availableManualSources(sourceCatalog)
      .filter((source) => source.kind === 'pickup' && source.segmentId === input.segmentId && source.attempt !== null)
      .sort((left, right) => (right.attempt ?? 0) - (left.attempt ?? 0))[0];
    if (requiredPickup === undefined) {
      throw new Error(`Segment-scoped analyze requires an available pickup source for ${input.segmentId}.`);
    }
    scope = {
      segmentId: input.segmentId,
      baselinePlan,
      requiredSourceId: requiredPickup.id,
    };
    continuityKeyframes = await readPickupContinuityKeyframes(input.runDir, input.segmentId);
  }
  const keyframes = planManualKeyframes({ events, durationMs: manifest.recordingEndMs }).frames;
  const version = await nextRequestVersion(bundle.agentDir, 'edit-request');
  const request = createEditAgentRequest({
    approvedGuide: requestGuide,
    manifest,
    events,
    sourceCatalog,
    keyframes,
    requestVersion: version,
    scope,
    continuityKeyframes,
  });
  const requestPath = bundle.versionedAgentPath('edit-request', version);
  await writeNewJson(requestPath, request);
  return { requestVersion: version, requestPath };
}

async function readPickupContinuityKeyframes(
  runDir: string,
  segmentId: string,
): Promise<EditAgentRequest['continuityKeyframes']> {
  const bundle = createManualBundle(runDir);
  let report: unknown;
  try {
    report = JSON.parse(await readFile(bundle.reportPath(`pickup-continuity-${segmentId}`), 'utf8')) as unknown;
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : '';
    if (code === 'ENOENT') return null;
    throw error;
  }
  const root = requireRecord(report, 'pickup continuity report');
  if (root.segmentId !== segmentId) fail('pickup continuity report.segmentId', `must equal ${segmentId}`);
  const pickup = requireRecord(root.pickup, 'pickup continuity report.pickup');
  const previous = root.previous === null ? null : requireRecord(root.previous, 'pickup continuity report.previous');
  const next = root.next === null ? null : requireRecord(root.next, 'pickup continuity report.next');
  const checkedPath = async (value: unknown, label: string): Promise<string> => {
    const framePath = requireString(value, label);
    const resolvedFrame = resolvePathInsideRun(runDir, framePath, label);
    await access(resolvedFrame);
    return resolvedFrame;
  };
  const parseNeighbor = async (
    value: Record<string, unknown> | null,
    label: string,
  ): Promise<NonNullable<EditAgentRequest['continuityKeyframes']>['previous']> => {
    if (value === null) return null;
    const atMs = value.atMs;
    if (typeof atMs !== 'number' || !Number.isFinite(atMs) || atMs < 0) fail(`${label}.atMs`, 'must be non-negative');
    return {
      segmentId: requireString(value.segmentId, `${label}.segmentId`),
      sourceId: requireString(value.sourceId, `${label}.sourceId`),
      atMs,
      framePath: await checkedPath(value.framePath, `${label}.framePath`),
    };
  };
  return {
    pickup: {
      segmentId: requireString(pickup.segmentId, 'pickup continuity report.pickup.segmentId'),
      sourceId: requireString(pickup.sourceId, 'pickup continuity report.pickup.sourceId'),
      firstFramePath: await checkedPath(pickup.firstFramePath, 'pickup continuity report.pickup.firstFramePath'),
      lastFramePath: await checkedPath(pickup.lastFramePath, 'pickup continuity report.pickup.lastFramePath'),
    },
    previous: await parseNeighbor(previous, 'pickup continuity report.previous'),
    next: await parseNeighbor(next, 'pickup continuity report.next'),
  };
}

export function validateEditAgentResponseForRequest(response: unknown, request: EditAgentRequest): asserts response is EditAgentResponse {
  const value = requireRecord(response, 'response');
  if (value.version !== 1) fail('response.version', 'must equal 1');
  if (value.kind !== 'manual-edit-response') fail('response.kind', 'must equal manual-edit-response');
  if (value.requestVersion !== request.requestVersion) fail('response.requestVersion', `must equal ${request.requestVersion}`);
  validateAgentProducer(value.producer);
  validateEditPlan(value.plan, availableManualSources(request.sourceCatalog));
  validateScopedPlan(value.plan as EditPlan, request);
  if (!Array.isArray(value.decisions)) fail('response.decisions', 'must be an array');
  const segmentIds = new Set(request.approvedGuide.actions.map((action) => action.segmentId));
  for (const [index, decisionValue] of value.decisions.entries()) {
    const decision = requireRecord(decisionValue, `response.decisions[${index}]`);
    const segmentId = requireString(decision.segmentId, `response.decisions[${index}].segmentId`);
    if (!segmentIds.has(segmentId)) fail(`response.decisions[${index}].segmentId`, 'must reference an approved guide segment');
    const confidence = requireString(decision.confidence, `response.decisions[${index}].confidence`);
    if (confidence !== 'high' && confidence !== 'medium' && confidence !== 'low') fail(`response.decisions[${index}].confidence`, 'is invalid');
    requireString(decision.reason, `response.decisions[${index}].reason`);
    if (!Array.isArray(decision.reviewReasons)) fail(`response.decisions[${index}].reviewReasons`, 'must be an array');
    if (confidence === 'low' && decision.reviewReasons.length === 0) fail(`response.decisions[${index}].reviewReasons`, 'must explain low confidence');
  }
  if (request.scope !== null && value.decisions.length !== 1) {
    fail('response.decisions', `must contain exactly one decision for scoped Segment ${request.scope.segmentId}`);
  }
}

export async function applyEditAgentResponse(input: ApplyEditAgentResponseInput): Promise<ApplyEditAgentResponseResult> {
  const bundle = createManualBundle(input.runDir);
  const version = extractVersion(input.responsePath, 'edit-response');
  const request = JSON.parse(await readFile(bundle.versionedAgentPath('edit-request', version), 'utf8')) as EditAgentRequest;
  const response = JSON.parse(await readFile(input.responsePath, 'utf8')) as unknown;
  validateEditAgentResponseForRequest(response, request);
  const planPath = bundle.versionedEditPath('edit-plan.agent', version);
  const reportPath = bundle.versionedEditPath('edit-report.agent', version);
  await writeNewJson(planPath, response.plan);
  await mkdir(bundle.editDir, { recursive: true });
  await writeFile(reportPath, formatEditAgentReport(response), { encoding: 'utf8', flag: 'wx' });
  await writeAtomicJson(bundle.agentCurrentPlanPath, { version, path: planPath });
  return { version, planPath, reportPath };
}

async function readApprovedGuide(runDir: string): Promise<RecordingGuide> {
  const bundle = createManualBundle(runDir);
  const pointer = JSON.parse(await readFile(bundle.approvedGuidePath, 'utf8')) as { guidePath?: string; guideVersion?: number };
  const guidePath = pointer.guidePath ?? (pointer.guideVersion === undefined ? undefined : bundle.versionedScriptPath('recording-guide', pointer.guideVersion));
  if (guidePath === undefined) throw new Error('approved guide pointer is invalid');
  const resolvedGuide = resolvePathInsideRun(runDir, guidePath, 'Approved guide');
  const guide = JSON.parse(await readFile(resolvedGuide, 'utf8')) as unknown;
  validateRecordingGuide(guide);
  return guide;
}

async function readCurrentAgentPlan(runDir: string): Promise<EditPlan> {
  const bundle = createManualBundle(runDir);
  const pointer = JSON.parse(await readFile(bundle.agentCurrentPlanPath, 'utf8')) as { path?: string };
  if (pointer.path === undefined) throw new Error(`Current agent plan pointer is invalid: ${bundle.agentCurrentPlanPath}`);
  const resolvedPlan = resolvePathInsideRun(runDir, pointer.path, 'Current agent plan');
  return JSON.parse(await readFile(resolvedPlan, 'utf8')) as EditPlan;
}

function validateScopedPlan(plan: EditPlan, request: EditAgentRequest): void {
  if (request.scope === null) return;
  const baseline = request.scope.baselinePlan;
  const requiredSource = request.sourceCatalog.sources.find((source) => source.id === request.scope!.requiredSourceId);
  if (
    requiredSource === undefined
    || requiredSource.status !== 'available'
    || requiredSource.kind !== 'pickup'
    || requiredSource.segmentId !== request.scope.segmentId
  ) {
    throw new Error(`Scoped requiredSourceId must be an available pickup for ${request.scope.segmentId}: ${request.scope.requiredSourceId}`);
  }
  if (!isDeepStrictEqual(plan.canvas, baseline.canvas) || plan.version !== baseline.version) {
    throw new Error(`Segment-scoped response cannot change plan metadata outside target ${request.scope.segmentId}.`);
  }
  if (plan.segments.length !== baseline.segments.length) {
    throw new Error(`Segment-scoped response must preserve all Segments outside target ${request.scope.segmentId}.`);
  }
  for (const [index, baselineSegment] of baseline.segments.entries()) {
    const candidate = plan.segments[index];
    if (candidate?.segmentId !== baselineSegment.segmentId) {
      throw new Error(`Segment-scoped response changed Segment order outside target ${request.scope.segmentId}.`);
    }
    if (baselineSegment.segmentId !== request.scope.segmentId && !isDeepStrictEqual(candidate, baselineSegment)) {
      throw new Error(`Segment-scoped response changed non-target Segment ${baselineSegment.segmentId}.`);
    }
  }
  const target = plan.segments.find((segment) => segment.segmentId === request.scope!.segmentId);
  if (target === undefined || !target.clips.some((clip) => clip.sourceId === request.scope!.requiredSourceId)) {
    throw new Error(`Scoped target Segment must reference requiredSourceId ${request.scope.requiredSourceId}.`);
  }
}

async function readEvents(eventsPath: string): Promise<RecordingEvent[]> {
  const text = await readFile(eventsPath, 'utf8');
  return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as RecordingEvent);
}

async function nextRequestVersion(agentDir: string, prefix: string): Promise<number> {
  await mkdir(agentDir, { recursive: true });
  for (let version = 1; version < 1000; version += 1) {
    try {
      await readFile(`${agentDir}/${prefix}.v${String(version).padStart(2, '0')}.json`, 'utf8');
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : '';
      if (code === 'ENOENT') return version;
      throw error;
    }
  }
  throw new Error(`Unable to allocate ${prefix} version.`);
}

function extractVersion(filePath: string, prefix: string): number {
  const match = new RegExp(`${prefix}\\.v(\\d{2,})\\.json$`).exec(filePath.replace(/\\/g, '/'));
  if (match === null) throw new Error(`Expected ${prefix}.vNN.json path.`);
  return Number(match[1]);
}

type UnknownRecord = Record<string, unknown>;
function fail(path: string, message: string): never { throw new Error(`${path} ${message}`); }
function requireRecord(value: unknown, path: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, 'must be an object');
  return value as UnknownRecord;
}
function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) fail(path, 'must be a non-empty string');
  return value;
}
