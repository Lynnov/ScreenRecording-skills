import type { PageSnapshot, PageSnapshotCandidate } from './page-snapshot.js';
import type { ActionCandidateReport, BrowserAction, CandidateConfidence, CandidateLayer, SemanticFailureReason } from '../types.js';

type SemanticBrowserAction = Extract<BrowserAction, { type: 'semanticClick' | 'semanticFill' | 'semanticSelect' | 'semanticWaitFor' }>;

type MatchStrategy = 'exact-role-layer' | 'exact-compatible-layer' | 'contains-compatible-layer';

interface RankedCandidate {
  candidate: PageSnapshotCandidate;
  confidence: CandidateConfidence;
  strategy: MatchStrategy;
  layerRank: number;
  roleRank: number;
}

export type MatchSemanticActionResult =
  | {
      ok: true;
      candidate: PageSnapshotCandidate;
      confidence: CandidateConfidence;
      strategy: MatchStrategy;
      candidates: ActionCandidateReport[];
    }
  | {
      ok: false;
      reason: SemanticFailureReason;
      message: string;
      candidates: ActionCandidateReport[];
    };

const LAYER_PRIORITY: CandidateLayer[] = ['dropdown', 'popover', 'dialog', 'drawer', 'overlay', 'page', 'toast'];

const ROLE_PRIORITY = {
  semanticClickButton: ['button', 'menuitem', 'option'],
  semanticClickLink: ['link'],
  semanticFill: ['textbox'],
  semanticSelect: ['combobox', 'button', 'textbox'],
  semanticWaitFor: ['button', 'link', 'textbox', 'combobox', 'menuitem', 'option'],
} as const;

export function matchSemanticAction(action: SemanticBrowserAction, snapshot: PageSnapshot): MatchSemanticActionResult {
  const rankedCandidates = snapshot.candidates
    .filter((candidate) => candidate.state.visible && candidate.state.enabled)
    .map((candidate) => rankCandidate(action, candidate))
    .filter((candidate): candidate is RankedCandidate => candidate !== undefined)
    .sort(compareRankedCandidates);

  const candidates = rankedCandidates.map(toCandidateReport);
  const best = rankedCandidates[0];

  if (!best) {
    return failure('NO_TARGET_FOUND', action, candidates);
  }

  if (best.confidence === 'weak') {
    return failure('LOW_CONFIDENCE_TARGET', action, candidates);
  }

  const ambiguous = rankedCandidates.filter((candidate) =>
    candidate.confidence === best.confidence
    && candidate.layerRank === best.layerRank
    && candidate.roleRank === best.roleRank
  );

  if (ambiguous.length > 1) {
    return failure('AMBIGUOUS_TARGET', action, ambiguous.map(toCandidateReport));
  }

  return {
    ok: true,
    candidate: best.candidate,
    confidence: best.confidence,
    strategy: best.strategy,
    candidates,
  };
}

function rankCandidate(action: SemanticBrowserAction, candidate: PageSnapshotCandidate): RankedCandidate | undefined {
  const roleRank = rolePriority(action, candidate);
  if (roleRank === undefined) {
    return undefined;
  }

  const targetName = normalizeText(action.target.name);
  const candidateName = normalizeText(candidate.name);
  const candidateText = normalizeText(candidate.text);
  const exactMatch = candidateName === targetName || (action.type === 'semanticWaitFor' && candidateText === targetName);
  const containsMatch = candidateName.includes(targetName) || candidateText.includes(targetName);

  if (!exactMatch && !containsMatch) {
    return undefined;
  }

  const confidence: CandidateConfidence = exactMatch ? (roleRank === 0 ? 'strong' : 'medium') : 'weak';
  const strategy: MatchStrategy = exactMatch
    ? (roleRank === 0 ? 'exact-role-layer' : 'exact-compatible-layer')
    : 'contains-compatible-layer';

  return {
    candidate,
    confidence,
    strategy,
    layerRank: layerPriority(candidate.layer),
    roleRank,
  };
}

function rolePriority(action: SemanticBrowserAction, candidate: PageSnapshotCandidate): number | undefined {
  if (action.type === 'semanticWaitFor' && !candidate.role) {
    return 0;
  }

  const role = candidate.role;
  if (!role) {
    return undefined;
  }

  switch (action.type) {
    case 'semanticClick':
      return indexRole(action.target.kind === 'button' ? ROLE_PRIORITY.semanticClickButton : ROLE_PRIORITY.semanticClickLink, role);
    case 'semanticFill':
      return indexRole(ROLE_PRIORITY.semanticFill, role);
    case 'semanticSelect':
      return indexRole(ROLE_PRIORITY.semanticSelect, role);
    case 'semanticWaitFor':
      return indexRole(ROLE_PRIORITY.semanticWaitFor, role);
  }
}

function indexRole(roles: readonly string[], role: string): number | undefined {
  const index = roles.indexOf(role);
  return index === -1 ? undefined : index;
}

function compareRankedCandidates(left: RankedCandidate, right: RankedCandidate): number {
  return confidenceRank(right.confidence) - confidenceRank(left.confidence)
    || left.layerRank - right.layerRank
    || left.roleRank - right.roleRank;
}

function confidenceRank(confidence: CandidateConfidence): number {
  switch (confidence) {
    case 'strong':
      return 3;
    case 'medium':
      return 2;
    case 'weak':
      return 1;
  }
}

function layerPriority(layer: CandidateLayer): number {
  const index = LAYER_PRIORITY.indexOf(layer);
  return index === -1 ? LAYER_PRIORITY.length : index;
}

function normalizeText(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function toCandidateReport(rankedCandidate: RankedCandidate): ActionCandidateReport {
  const { candidate, confidence } = rankedCandidate;

  return {
    label: [candidate.context, candidate.name || candidate.text].filter(Boolean).join(' / ')
      || candidate.selectorHint
      || candidate.role
      || 'unknown',
    role: candidate.role,
    name: candidate.name,
    text: candidate.text,
    layer: candidate.layer,
    confidence,
    selectorHint: candidate.selectorHint,
  };
}

function failure(reason: SemanticFailureReason, action: SemanticBrowserAction, candidates: ActionCandidateReport[]): MatchSemanticActionResult {
  return {
    ok: false,
    reason,
    message: `${reason}: could not confidently match ${action.type} target "${action.target.name}".`,
    candidates,
  };
}
