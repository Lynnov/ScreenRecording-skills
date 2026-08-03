export interface SegmentPlaybackRange {
  startSeconds: number;
  endSeconds: number;
}

interface PreviewTimelineSegment {
  segmentId: string;
  startsAtMs: number;
  endsAtMs: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTimelineSegment(value: unknown): value is PreviewTimelineSegment {
  return isRecord(value)
    && typeof value.segmentId === 'string'
    && typeof value.startsAtMs === 'number'
    && typeof value.endsAtMs === 'number';
}

export function getSegmentPlaybackRange(timeline: unknown, segmentId: string): SegmentPlaybackRange {
  if (!isRecord(timeline) || !Array.isArray(timeline.segments)) {
    throw new Error('预览时间轴缺少片段列表。');
  }
  const segment = timeline.segments.find((item) => isTimelineSegment(item) && item.segmentId === segmentId);
  if (!isTimelineSegment(segment)) {
    throw new Error(`预览时间轴找不到片段：${segmentId}`);
  }
  if (!Number.isFinite(segment.startsAtMs)
    || segment.startsAtMs < 0
    || !Number.isFinite(segment.endsAtMs)
    || segment.endsAtMs <= segment.startsAtMs) {
    throw new Error(`片段播放区间无效：${segmentId}`);
  }
  return {
    startSeconds: segment.startsAtMs / 1000,
    endSeconds: segment.endsAtMs / 1000,
  };
}

const reviewStatusLabels: Record<string, string> = {
  approved: '已通过',
  'pickup-required': '需要补录',
  rejected: '已拒绝',
};

const waitStrategyLabels: Record<string, string> = {
  keep: '保留',
  compress: '压缩等待',
};

const sourceStatusLabels: Record<string, string> = {
  available: '可用',
  failed: '失败',
  superseded: '已替换',
};

export function formatReviewStatus(status: string): string {
  return reviewStatusLabels[status] ?? '状态未知';
}

export function formatWaitStrategy(strategy: string): string {
  return waitStrategyLabels[strategy] ?? '策略未知';
}

export function formatSegmentLabel(segmentId: string, status: string, index: number): string {
  const suffix = /segment-(\d+)$/.exec(segmentId)?.[1];
  const number = suffix === undefined ? index + 1 : Number(suffix);
  return `片段 ${number} · ${formatReviewStatus(status)}`;
}

export function formatSourceLabel(source: unknown): string {
  if (!isRecord(source)) return '素材 · 状态未知';
  const attempt = typeof source.attempt === 'number' ? ` ${source.attempt}` : '';
  const kind = source.kind === 'original'
    ? '原始录像'
    : source.kind === 'pickup'
      ? `补录素材${attempt}`
      : '素材';
  const status = typeof source.status === 'string'
    ? sourceStatusLabels[source.status] ?? '状态未知'
    : '状态未知';
  return `${kind} · ${status}`;
}
