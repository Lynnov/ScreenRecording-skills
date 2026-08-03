import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface FineEditRules {
  version: 1;
  hard: {
    keepRequiredEvents: true;
    shortWaitMaxMs: 1000;
    mistakeWaitMaxMs: 3000;
    mistakeWaitPlaybackRate: 5;
    normalIdleMaxPlaybackRate: 2;
  };
  soft: {
    actionPreRollMs: number;
    actionPostRollMs: number;
    narrationTailMs: number;
    resultReactionMs: number;
    maxSilentTailMs: number;
    fadeMs: number;
    whiteFrameRatio: number;
  };
  evolution: {
    enabled: boolean;
    maxAdjustmentRatio: number;
    promoteOnlyPassed: true;
  };
}

export interface LoadedFineEditRules {
  rules: FineEditRules;
  source: 'default' | 'learned';
  diagnostics: string[];
  learningDir: string;
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown, label: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as UnknownRecord;
}

function exact(value: unknown, expected: unknown, label: string): void {
  if (value !== expected) throw new Error(`${label} must equal ${String(expected)}`);
}

function bounded(value: unknown, minimum: number, maximum: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

export function validateFineEditRules(value: unknown): asserts value is FineEditRules {
  const rules = record(value, 'rules');
  exact(rules.version, 1, 'rules.version');
  const hard = record(rules.hard, 'rules.hard');
  exact(hard.keepRequiredEvents, true, 'rules.hard.keepRequiredEvents');
  exact(hard.shortWaitMaxMs, 1000, 'rules.hard.shortWaitMaxMs');
  exact(hard.mistakeWaitMaxMs, 3000, 'rules.hard.mistakeWaitMaxMs');
  exact(hard.mistakeWaitPlaybackRate, 5, 'rules.hard.mistakeWaitPlaybackRate');
  exact(hard.normalIdleMaxPlaybackRate, 2, 'rules.hard.normalIdleMaxPlaybackRate');

  const soft = record(rules.soft, 'rules.soft');
  bounded(soft.actionPreRollMs, 250, 1000, 'rules.soft.actionPreRollMs');
  bounded(soft.actionPostRollMs, 250, 1000, 'rules.soft.actionPostRollMs');
  bounded(soft.narrationTailMs, 500, 2000, 'rules.soft.narrationTailMs');
  bounded(soft.resultReactionMs, 800, 2000, 'rules.soft.resultReactionMs');
  bounded(soft.maxSilentTailMs, 1000, 3000, 'rules.soft.maxSilentTailMs');
  bounded(soft.fadeMs, 100, 200, 'rules.soft.fadeMs');
  bounded(soft.whiteFrameRatio, 0.85, 0.99, 'rules.soft.whiteFrameRatio');

  const evolution = record(rules.evolution, 'rules.evolution');
  if (typeof evolution.enabled !== 'boolean') throw new Error('rules.evolution.enabled must be a boolean');
  bounded(evolution.maxAdjustmentRatio, 0, 0.1, 'rules.evolution.maxAdjustmentRatio');
  exact(evolution.promoteOnlyPassed, true, 'rules.evolution.promoteOnlyPassed');
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, 'utf8')) as unknown;
}

export async function loadFineEditRules(input: { runDir: string }): Promise<LoadedFineEditRules> {
  const defaultPath = fileURLToPath(new URL('./fine-edit-rules.default.json', import.meta.url));
  const defaults = await readJson(defaultPath);
  validateFineEditRules(defaults);
  const learningDir = path.join(path.dirname(path.resolve(input.runDir)), '.manual-fine-edit-learning');
  const diagnostics: string[] = [];
  try {
    const pointer = record(await readJson(path.join(learningDir, 'current.json')), 'learned profile pointer');
    if (typeof pointer.path !== 'string') throw new Error('learned profile pointer.path must be a string');
    const learned = await readJson(pointer.path);
    validateFineEditRules(learned);
    return { rules: learned, source: 'learned', diagnostics, learningDir };
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : '';
    if (code !== 'ENOENT') diagnostics.push(`Learned profile ignored: ${error instanceof Error ? error.message : String(error)}`);
    return { rules: defaults, source: 'default', diagnostics, learningDir };
  }
}
