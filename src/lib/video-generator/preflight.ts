import type { PreflightCheck, PreflightReport, StageDiagnostic, Timeline } from './types.js';

interface LocatorLike {
  count(): Promise<number>;
}

export interface PreflightPageLike {
  locator(selector: string): LocatorLike;
}

export interface RunPreflightChecksInput {
  timeline: Timeline;
  page: PreflightPageLike;
  outputDir: string;
}

export async function runPreflightChecks(input: RunPreflightChecksInput): Promise<PreflightReport> {
  const stageDiagnostics = await collectStageDiagnostics(input.timeline, input.page);
  const checks = stageDiagnostics.flatMap(makeStageChecks);

  return {
    ok: checks.every((check) => check.ok),
    outputDir: input.outputDir,
    checks,
    stageDiagnostics,
  };
}

async function collectStageDiagnostics(timeline: Timeline, page: PreflightPageLike): Promise<StageDiagnostic[]> {
  const stages = timeline.stages ?? [];
  const diagnostics: StageDiagnostic[] = [];

  for (const stage of stages) {
    const scopeCount = stage.scope === undefined ? 1 : await page.locator(stage.scope).count();
    const anchors = [];

    for (const anchor of stage.anchors) {
      const selector = stage.scope === undefined ? anchor : `${stage.scope} >> ${anchor}`;
      const count = scopeCount > 0 ? await page.locator(selector).count() : 0;
      anchors.push({ selector: anchor, matched: count > 0, count });
    }

    const missingAnchors = anchors.filter((anchor) => !anchor.matched).map((anchor) => anchor.selector);
    diagnostics.push({
      stageName: stage.name,
      ...(stage.scope === undefined ? {} : { scope: stage.scope, scopeMatched: scopeCount > 0, scopeCount }),
      matched: scopeCount > 0 && missingAnchors.length === 0,
      anchors,
      missingAnchors,
    });
  }

  return diagnostics;
}

function makeStageChecks(diagnostic: StageDiagnostic): PreflightCheck[] {
  if (diagnostic.matched) {
    return [{ name: 'stage anchors', ok: true, stageName: diagnostic.stageName, message: `Stage ${diagnostic.stageName} anchors matched` }];
  }

  if (diagnostic.scope !== undefined && diagnostic.scopeMatched === false) {
    return [{
      name: 'stage anchors',
      ok: false,
      stageName: diagnostic.stageName,
      message: `Stage ${diagnostic.stageName} missing scope: ${diagnostic.scope}; missing anchors: ${diagnostic.missingAnchors.join(', ')}`,
    }];
  }

  return [{
    name: 'stage anchors',
    ok: false,
    stageName: diagnostic.stageName,
    message: `Stage ${diagnostic.stageName} missing anchors: ${diagnostic.missingAnchors.join(', ')}`,
  }];
}
