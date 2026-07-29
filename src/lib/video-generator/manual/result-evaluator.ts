import type { ExpectedResult } from './types.js';

export interface ManualResultSnapshot {
  url?: string;
  dialogs?: Array<{ text?: string }>;
  visibleTexts?: string[];
  elements?: Array<{
    target: string;
    state?: 'visible' | 'hidden' | 'enabled' | 'disabled';
    selectedValue?: string;
  }>;
  tabs?: Array<{ title?: string; url?: string }>;
}

export interface ExpectedResultEvaluation {
  expected: ExpectedResult;
  matched: boolean;
  evidence: string[];
}

export interface ExpectedResultsEvaluation {
  matched: boolean;
  results: ExpectedResultEvaluation[];
}

export function evaluateExpectedResult(expected: ExpectedResult, snapshot: ManualResultSnapshot): ExpectedResultEvaluation {
  const evidence: string[] = [];
  const matched = matchExpectedResult(expected, snapshot, evidence);
  return { expected, matched, evidence };
}

export function evaluateExpectedResults(expected: ExpectedResult[], snapshot: ManualResultSnapshot): ExpectedResultsEvaluation {
  const results = expected.map((item) => evaluateExpectedResult(item, snapshot));
  return { matched: results.every((item) => item.matched), results };
}

function matchExpectedResult(expected: ExpectedResult, snapshot: ManualResultSnapshot, evidence: string[]): boolean {
  switch (expected.type) {
    case 'dialog-visible':
      return containsText(snapshot.dialogs?.map((dialog) => dialog.text ?? '') ?? [], expected.text ?? '', evidence, 'dialog');
    case 'text-visible':
      return containsText(snapshot.visibleTexts ?? [], expected.text, evidence, 'text');
    case 'url-matches':
      return matchesPattern(snapshot.url ?? '', expected.pattern, evidence, 'url');
    case 'element-state': {
      const element = (snapshot.elements ?? []).find((item) => item.target === expected.target && item.state === expected.state);
      if (element !== undefined) evidence.push(`${expected.target} is ${expected.state}`);
      return element !== undefined;
    }
    case 'selected-value': {
      const element = (snapshot.elements ?? []).find((item) => item.target === expected.target && item.selectedValue === expected.value);
      if (element !== undefined) evidence.push(`${expected.target} selected ${expected.value}`);
      return element !== undefined;
    }
    case 'tab-created': {
      const tab = (snapshot.tabs ?? []).find((item) => {
        const titleOk = expected.title === undefined || (item.title ?? '').includes(expected.title);
        const urlOk = expected.urlPattern === undefined || matchesPattern(item.url ?? '', expected.urlPattern, [], 'tab.url');
        return titleOk && urlOk;
      });
      if (tab !== undefined) evidence.push(`tab ${tab.title ?? ''} ${tab.url ?? ''}`.trim());
      return tab !== undefined;
    }
    default:
      return false;
  }
}

function containsText(values: string[], needle: string, evidence: string[], label: string): boolean {
  const matched = values.find((value) => needle.length === 0 ? value.length > 0 : value.includes(needle));
  if (matched !== undefined) evidence.push(`${label}: ${matched}`);
  return matched !== undefined;
}

function matchesPattern(value: string, pattern: string, evidence: string[], label: string): boolean {
  try {
    const regex = new RegExp(pattern);
    const matched = regex.test(value);
    if (matched) evidence.push(`${label}: ${value}`);
    return matched;
  } catch {
    return false;
  }
}
