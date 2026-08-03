# Manual Review Segment Playback and Localization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each review Segment auto-play and loop only its own preview interval, while presenting review terminology in Chinese.

**Architecture:** Keep a single `preview.mp4`; derive the selected interval from `preview-timeline.json` and enforce it in the renderer. Put timeline parsing and label formatting in a small DOM-free presenter module so behavior receives real unit coverage while the existing integration test verifies Electron wiring and visible copy.

**Tech Stack:** TypeScript ESM/CTS, Electron 43, DOM `<video>`, node:test + tsx.

---

### Task 1: Pure playback ranges and Chinese labels

**Files:**
- Create: `src/lib/video-generator/review-ui/review-presenter.ts`
- Create: `tests/video-generator/manual-review-presenter.unit.test.ts`

- [x] **Step 1: Write failing unit tests**

Cover valid/missing timeline ranges and these visible mappings: `片段 1 · 已通过`, `需要补录`, `已拒绝`, `保留`, `压缩等待`, `原始录像`, `补录素材`, `可用`, `失败`, `已替换`.

```ts
assert.deepEqual(getSegmentPlaybackRange(timeline, 'segment-002'), {
  startSeconds: 14,
  endSeconds: 20.8,
});
assert.equal(formatSegmentLabel('segment-001', 'approved', 0), '片段 1 · 已通过');
assert.throws(() => getSegmentPlaybackRange(timeline, 'missing'), /找不到.*片段/);
```

- [x] **Step 2: Verify RED**

Run: `npx tsx --test tests/video-generator/manual-review-presenter.unit.test.ts`

Expected: FAIL because `review-presenter.ts` does not exist.

- [x] **Step 3: Implement the pure presenter**

```ts
export interface SegmentPlaybackRange {
  startSeconds: number;
  endSeconds: number;
}

export function getSegmentPlaybackRange(timeline: unknown, segmentId: string): SegmentPlaybackRange {
  if (typeof timeline !== 'object' || timeline === null || !('segments' in timeline) || !Array.isArray(timeline.segments)) {
    throw new Error('预览时间轴缺少片段列表。');
  }
  const segment = timeline.segments.find((item) => typeof item === 'object' && item !== null && 'segmentId' in item && item.segmentId === segmentId);
  if (typeof segment !== 'object' || segment === null || !('startsAtMs' in segment) || !('endsAtMs' in segment)) {
    throw new Error(`预览时间轴找不到片段：${segmentId}`);
  }
  const startsAtMs = segment.startsAtMs;
  const endsAtMs = segment.endsAtMs;
  if (typeof startsAtMs !== 'number' || !Number.isFinite(startsAtMs) || startsAtMs < 0
    || typeof endsAtMs !== 'number' || !Number.isFinite(endsAtMs) || endsAtMs <= startsAtMs) {
    throw new Error(`片段播放区间无效：${segmentId}`);
  }
  return { startSeconds: startsAtMs / 1000, endSeconds: endsAtMs / 1000 };
}

const statusLabels: Record<string, string> = {
  approved: '已通过',
  'pickup-required': '需要补录',
  rejected: '已拒绝',
};

export const formatReviewStatus = (status: string): string => statusLabels[status] ?? '状态未知';
export const formatWaitStrategy = (strategy: string): string => strategy === 'compress' ? '压缩等待' : '保留';
export function formatSegmentLabel(segmentId: string, status: string, index: number): string {
  const suffix = /segment-(\d+)$/.exec(segmentId)?.[1];
  return `片段 ${suffix === undefined ? index + 1 : Number(suffix)} · ${formatReviewStatus(status)}`;
}
export function formatSourceLabel(source: unknown): string {
  const value = source as { kind?: string; status?: string; attempt?: number | null };
  const kind = value.kind === 'pickup'
    ? `补录素材${value.attempt == null ? '' : ` ${value.attempt}`}`
    : '原始录像';
  const status = value.status === 'failed' ? '失败' : value.status === 'superseded' ? '已替换' : '可用';
  return `${kind} · ${status}`;
}
```

- [x] **Step 4: Verify GREEN**

Run: `npx tsx --test tests/video-generator/manual-review-presenter.unit.test.ts`

Expected: all presenter tests pass.

### Task 2: Wire selected-interval playback into the review renderer

**Files:**
- Modify: `src/lib/video-generator/review-ui/renderer.ts`
- Modify: `src/lib/video-generator/review-ui/review.html`
- Modify: `src/lib/video-generator/review-ui/review.css`
- Modify: `src/lib/video-generator/manual/review.ts`
- Modify: `tests/video-generator/manual-review.unit.test.ts`
- Modify: `tests/video-generator/manual-review-ui.integration.test.ts`

- [x] **Step 1: Write failing integration assertions**

Require the renderer to use `getSegmentPlaybackRange`, set `currentTime`, call `play()` on Segment clicks, and handle `timeupdate` by returning to the selected start. Require Chinese option text and a visible `preview-error` alert.

```ts
assert.match(renderer, /getSegmentPlaybackRange/);
assert.match(renderer, /preview\.currentTime = range\.startSeconds/);
assert.match(renderer, /preview\.play\(\)/);
assert.match(renderer, /addEventListener\('timeupdate'/);
assert.match(html, />已通过</);
assert.match(html, /id="preview-error"/);
```

- [x] **Step 2: Verify RED**

Run: `npx tsx --test tests/video-generator/manual-review-ui.integration.test.ts`

Expected: FAIL on missing playback wiring and Chinese copy.

- [x] **Step 3: Implement interval playback**

Maintain one current playback range. Initial load seeks to Segment 1 without forced playback. A user Segment click seeks to its start and calls `play()`. On `timeupdate`, when playback reaches the selected end, reset `currentTime` to the start and continue playing. Missing/malformed intervals stop playback and show a Chinese error in `#preview-error`.

```ts
let selectedPlaybackRange: SegmentPlaybackRange | null = null;

preview?.addEventListener('timeupdate', () => {
  if (selectedPlaybackRange === null || preview.currentTime < selectedPlaybackRange.endSeconds) return;
  const wasPlaying = !preview.paused;
  preview.currentTime = selectedPlaybackRange.startSeconds;
  if (wasPlaying) void preview.play().catch((error) => showPreviewError(`无法播放所选片段：${String(error)}`));
});

function renderPreview(segment: EditReviewSegment | null, autoplay: boolean): void {
  if (preview === null || currentBundle === null || segment === null) return;
  preview.src = currentBundle.previewPath;
  preview.loop = false;
  try {
    const range = getSegmentPlaybackRange(currentBundle.previewTimeline, segment.segmentId);
    selectedPlaybackRange = range;
    const seek = () => {
      preview.currentTime = range.startSeconds;
      if (autoplay) void preview.play().catch((error) => showPreviewError(`无法播放所选片段：${String(error)}`));
    };
    preview.readyState >= HTMLMediaElement.HAVE_METADATA
      ? seek()
      : preview.addEventListener('loadedmetadata', seek, { once: true });
  } catch (error) {
    selectedPlaybackRange = null;
    preview.pause();
    showPreviewError(error instanceof Error ? error.message : String(error));
  }
}
```

- [x] **Step 4: Localize visible controls**

Keep protocol values unchanged, but render Chinese option text, Segment buttons, timeline labels, source labels, status labels, wait strategy labels, window title, and error copy.

```html
<title>人工录制审核</title>
<p id="preview-error" role="alert" hidden></p>
<option value="approved">已通过</option>
<option value="pickup-required">需要补录</option>
<option value="rejected">已拒绝</option>
<option value="keep">保留</option>
<option value="compress">压缩等待</option>
```

Change the default low-confidence review reason to `低置信度，需要人工处理。`; Agent-authored free text remains unchanged.

- [x] **Step 5: Verify GREEN and build**

Run:

```powershell
npx.cmd tsx --test tests/video-generator/manual-review-presenter.unit.test.ts tests/video-generator/manual-review-ui.integration.test.ts
npm.cmd run build:manual
```

Expected: all targeted tests pass and build exits 0.

### Task 3: Real Electron acceptance

**Files:**
- Reuse run: `video-runs/manual-full-acceptance-20260729`

- [x] **Step 1: Restart only the review Electron process**

Open the rebuilt review UI with the existing run directory.

- [x] **Step 2: Human verification**

Confirm left labels are Chinese. Clicking 片段 1/2/3 must immediately auto-play a visibly different interval and loop only within that interval. Keep 片段 3 as `需要补录` and save review.

- [x] **Step 3: Continue full product acceptance**

Run Segment 3 pickup, scoped analyze/review, narration, real DashScope TTS, subtitles, finalize, and all stage verifiers.

- [x] **Step 4: Do not commit automatically**

Report verification evidence and wait for explicit user authorization before the next commit or push.
