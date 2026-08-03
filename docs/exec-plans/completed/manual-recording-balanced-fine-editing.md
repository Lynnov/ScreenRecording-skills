# Manual Recording Balanced Fine Editing Implementation Plan

**Status:** Completed on 2026-08-03. Focused tests 34/34 passed, TypeScript typecheck passed, and the locked real run completed real TTS/ffmpeg finalization plus final-stage verification.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan inline. Do not use subagents for this task.

**Goal:** Add TTS-aware automatic fine editing, bounded learning, quality warnings, and re-render the locked real acceptance run without a second user review.

**Architecture:** Keep the approved effective plan as the immutable content decision. After real TTS is available, load versioned rules, analyze source-specific events and high-confidence white-screen intervals, generate a separate fine plan, validate required-event coverage and pacing, then render from that fine plan. Persist a per-run rules snapshot and quality report; promote only bounded soft-parameter candidates from `quality=passed` runs.

**Tech Stack:** TypeScript, Node.js, ffmpeg/ffprobe, JSON/JSONL artifacts, Node test runner.

**Execution constraints:** Stay on `main`, use no worktree or subagent, do not commit/push, preserve unrelated changes, keep the locked run `video-runs/manual-acceptance-rawpaper-master-order-20260803`, and back up existing final artifacts before replacement.

---

### Task 1: Versioned rule schema and fine-edit clip metadata

**Files:**
- Create: `src/lib/video-generator/manual/fine-edit-rules.default.json`
- Create: `src/lib/video-generator/manual/fine-edit-rules.ts`
- Modify: `src/lib/video-generator/editing/types.ts`
- Modify: `src/lib/video-generator/editing/validator.ts`
- Test: `tests/video-generator/manual-fine-edit-rules.unit.test.ts`
- Test: `tests/video-generator/editing-validator.unit.test.ts`

- [ ] Write failing tests that assert fixed product rules (`1000ms`, `3000ms`, `5x`), soft bounds, malformed-profile fallback, `clipKind` validation, and that only `mistake-wait` may use `5x` while `idle` remains at most `2x`.
- [ ] Run:

  ```powershell
  npx.cmd tsx --test tests/video-generator/manual-fine-edit-rules.unit.test.ts tests/video-generator/editing-validator.unit.test.ts
  ```

  Expected: FAIL because the rule loader and clip metadata do not exist.

- [ ] Add these public contracts:

  ```ts
  export type FineEditClipKind = 'context' | 'action' | 'result' | 'idle' | 'mistake-wait';

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
  ```

- [ ] Extend `EditClip` with optional `clipKind`, `evidenceEventIds`, and `reason`. Preserve compatibility with historical plans that omit them.
- [ ] Implement `loadFineEditRules({ runDir })` to load defaults, validate bounded learned profile data from `video-runs/.manual-fine-edit-learning/current.json`, and return defaults with a diagnostic when learned state is absent or invalid.
- [ ] Re-run the focused tests and expect PASS.

### Task 2: Source event analysis and deterministic fine-plan generation

**Files:**
- Create: `src/lib/video-generator/manual/fine-edit-events.ts`
- Create: `src/lib/video-generator/manual/fine-edit-plan.ts`
- Modify: `src/lib/video-generator/recording/types.ts`
- Test: `tests/video-generator/manual-fine-edit-events.unit.test.ts`
- Test: `tests/video-generator/manual-fine-edit-plan.unit.test.ts`

- [ ] Write failing fixtures covering original and pickup event paths, stable input `targetKey`, final-attempt selection, ambiguous generic inputs, save preservation, short waits, `5x` mistake waits, long-gap deletion, and TTS soft-target expansion.
- [ ] Run:

  ```powershell
  npx.cmd tsx --test tests/video-generator/manual-fine-edit-events.unit.test.ts tests/video-generator/manual-fine-edit-plan.unit.test.ts
  ```

  Expected: FAIL because event analysis and plan generation do not exist.

- [ ] Implement source event resolution:

  ```ts
  export function eventPathForSource(runDir: string, sourceId: string): string;
  export async function readSourceEvents(runDir: string, sourceId: string): Promise<FineEditEvent[]>;
  export function buildInputAttempts(events: readonly FineEditEvent[]): InputAttemptAnalysis;
  ```

  `original` resolves to `capture/events.jsonl`; pickup IDs resolve to `pickups/<sourceId>.events.jsonl`. Extend `RecordingEvent` with optional redacted `target`, `url`, and `frameUrl` metadata already present in runtime artifacts.

- [ ] Implement a conservative `targetKey`: prefer id/name/label/placeholder; otherwise use recent labelled click context plus frame and input type. Never use field values. When target identity remains ambiguous, preserve the events and emit `AMBIGUOUS_INPUT_TARGET`.
- [ ] Implement:

  ```ts
  export function buildFineEditPlan(input: {
    effectivePlan: EditPlan;
    eventsBySource: ReadonlyMap<string, readonly FineEditEvent[]>;
    audioDurationBySegment: ReadonlyMap<string, number>;
    blankIntervalsBySource: ReadonlyMap<string, readonly TimeInterval[]>;
    rules: FineEditRules;
  }): FineEditResult;
  ```

  Preserve reviewed sources and segment order. Keep final effective input attempts, required save/click/result windows, remove superseded attempts, use `5x` only for proven `(1000ms, 3000ms]` mistake waits, delete non-teaching gaps over `3000ms`, and expand context/result only until `max(TTS + 1000ms, required action duration + result reaction)`.
- [ ] Re-run the focused tests and expect PASS.

### Task 3: High-confidence blank detection and quality gate

**Files:**
- Create: `src/lib/video-generator/manual/fine-edit-blank.ts`
- Create: `src/lib/video-generator/manual/fine-edit-quality.ts`
- Test: `tests/video-generator/manual-fine-edit-blank.unit.test.ts`
- Test: `tests/video-generator/manual-fine-edit-quality.unit.test.ts`

- [ ] Write failing tests for parsing `blackdetect` output after `negate`, intersecting blank intervals with approved source bounds, rejecting missing required events, and warning on ambiguous blank/input detection or long action tails.
- [ ] Run:

  ```powershell
  npx.cmd tsx --test tests/video-generator/manual-fine-edit-blank.unit.test.ts tests/video-generator/manual-fine-edit-quality.unit.test.ts
  ```

  Expected: FAIL because detectors and quality reports do not exist.

- [ ] Implement ffmpeg detection against the browser content region using `crop`, `negate`, and `blackdetect`; delete only high-confidence intervals and return ambiguous intervals as warnings rather than destructive edits.
- [ ] Implement:

  ```ts
  export interface FineEditQualityReport {
    version: 1;
    status: 'passed' | 'warning' | 'failed';
    rulesVersion: number;
    requiredEventCoverage: number;
    beforeDurationMs: number;
    afterDurationMs: number;
    narrationDurationMs: number;
    segments: FineEditSegmentQuality[];
    warnings: FineEditWarning[];
    hardFailures: FineEditFailure[];
  }
  ```

  Hard-fail missing/reordered required events, invalid sources/ranges, and media failures. Warn on ambiguous input/blank detection and action-driven tails beyond the soft target.
- [ ] Re-run the focused tests and expect PASS.

### Task 4: Finalize integration, artifacts, warnings, and bounded learning

**Files:**
- Create: `src/lib/video-generator/manual/fine-edit-learning.ts`
- Modify: `src/lib/video-generator/manual/bundle.ts`
- Modify: `src/lib/video-generator/manual/final-report.ts`
- Modify: `src/lib/video-generator/manual/verifiers.ts`
- Test: `tests/video-generator/manual-fine-edit-learning.unit.test.ts`
- Test: `tests/video-generator/manual-finalize.unit.test.ts`
- Test: `tests/video-generator/manual-verifiers.unit.test.ts`

- [ ] Write failing tests proving finalize builds the fine plan after obtaining actual TTS durations, writes a rules snapshot/fine plan/quality report, blocks on hard failure, returns `ok=true + quality.status=warning` on soft failure, and promotes only bounded candidates from passed runs.
- [ ] Run:

  ```powershell
  npx.cmd tsx --test tests/video-generator/manual-fine-edit-learning.unit.test.ts tests/video-generator/manual-finalize.unit.test.ts tests/video-generator/manual-verifiers.unit.test.ts
  ```

  Expected: FAIL against the current finalize path.

- [ ] Extend `ManualBundle` with fine-plan pointers, rule snapshot, quality report, learning candidate, and local learning paths. Keep historical effective plans unchanged.
- [ ] In `finalizeManualRecording`, synthesize/reuse TTS, generate and validate the fine plan, write immutable artifacts, build the final timeline from the fine plan, render, probe, and report `renderOk` plus quality status/warnings. Never expose `DASHSCOPE_API_KEY`.
- [ ] Implement learning candidates with at most 10% soft-parameter movement, evidence hashes, atomic current-pointer promotion only for `quality=passed`, and fallback/rollback to defaults or the previous valid profile.
- [ ] Update final-stage verification to require render success, valid quality status, referenced artifacts, matching hashes, and playable media; warnings do not fail final-stage verification.
- [ ] Re-run the focused tests and expect PASS, then run `npm.cmd run typecheck`.

### Task 5: Locked-run backup, real re-edit, and acceptance

**Files:**
- Modify only generated artifacts under: `video-runs/manual-acceptance-rawpaper-master-order-20260803/`

- [ ] Resolve and verify the exact locked run path. Copy the existing `final.mp4`, `final-timeline.json`, `subtitles.srt`, `reports/final-verification.json`, and `reports/final-stage-verification.json` to versioned `pre-balanced-fine-edit.v01` history names inside the same run. Do not delete source recordings or reports.
- [ ] Run the updated finalize with the existing approved narration and real credentials. Reuse existing segment WAV files when their text/hash matches; otherwise call real DashScope TTS.
- [ ] Run only the required directional verification:

  ```powershell
  npm.cmd run verify:manual -- --run "E:\Code\ScreenRecording\video-runs\manual-acceptance-rawpaper-master-order-20260803" --stage final
  ```

- [ ] Fully decode the new final with ffmpeg, inspect ffprobe video/audio streams, check volume/silence intervals, and extract one contact sheet covering all four Segments.
- [ ] Compare before/after duration, narration coverage, Segment source mapping, retained required events, deleted/accelerated ranges, quality status/warnings, `ok=true`, and `cleanupErrors=[]`.
- [ ] Confirm no new run, commit, push, or unrelated workspace mutation occurred.
