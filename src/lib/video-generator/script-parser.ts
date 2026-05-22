import { basicDemoDataUrl } from './browser/demo-page.js';
import { estimateNarrationDurationMs } from './duration.js';
import { validateTimeline } from './timeline-validator.js';
import {
  VideoGeneratorError,
  type BrowserAction,
  type Timeline,
  type TimelineSegment,
  type VideoGeneratorConfig,
} from './types.js';

export function parseVideoScript(input: string, config: VideoGeneratorConfig): Timeline {
  const blocks = input
    .split(/\r?\n\s*\r?\n/u)
    .map((block) => block.trim())
    .filter(Boolean);

  const segments = blocks.map((block, index) => parseBlock(block, index, config));
  const timeline: Timeline = {
    version: 1,
    title: '未命名教程视频',
    segments,
  };

  validateTimeline(timeline);
  return timeline;
}

function parseBlock(block: string, index: number, config: VideoGeneratorConfig): TimelineSegment {
  const sourceText = block.trim();
  const lines = sourceText
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const narrationLine = lines.find((line) => line.startsWith('旁白：'));

  if (!narrationLine) {
    throw new VideoGeneratorError('MISSING_NARRATION', 'Each script block must contain 旁白：.');
  }

  const narration = narrationLine.slice('旁白：'.length).trim();
  const actionLines = lines.filter((line) => line !== narrationLine);

  if (actionLines.length === 0) {
    throw new VideoGeneratorError('MISSING_ACTION', 'Each script block must contain at least one action.');
  }

  const actions = actionLines.map((line) => parseAction(line));

  return {
    id: `seg-${String(index + 1).padStart(3, '0')}`,
    sourceText,
    narration,
    subtitle: narration,
    actions,
    estimatedDurationMs: estimateNarrationDurationMs(narration, config.speechRateCharsPerMinute),
    bufferMs: config.segmentBufferMs,
    assets: {},
  };
}

function parseAction(line: string): BrowserAction {
  if (line === '打开内置演示页') {
    return { type: 'goto', url: basicDemoDataUrl() };
  }

  const gotoMatch = line.match(/^打开\s+(.+)$/u);
  if (gotoMatch) {
    const target = gotoMatch[1].trim();
    return { type: 'goto', url: target === 'demo:basic' ? basicDemoDataUrl() : target };
  }

  const clickMatch = line.match(/^点击\s+(.+)$/u);
  if (clickMatch) {
    return { type: 'click', text: stripWrappingQuotes(clickMatch[1]) };
  }

  const fillAction = parseFillAction(line);
  if (fillAction) {
    return fillAction;
  }

  const waitForMatch = line.match(/^等待\s+(.+)$/u);
  if (waitForMatch) {
    return { type: 'waitFor', target: { type: 'text', value: stripWrappingQuotes(waitForMatch[1]) } };
  }

  const scrollMatch = line.match(/^向下滚动\s+(.+)$/u);
  if (scrollMatch) {
    return { type: 'scroll', y: Number(scrollMatch[1].trim()) };
  }

  throw new VideoGeneratorError('UNSUPPORTED_SCRIPT_ACTION', `Unsupported script action: ${line}`);
}

function parseFillAction(line: string): BrowserAction | undefined {
  if (!line.startsWith('在 ')) {
    return undefined;
  }

  const afterPrefix = line.slice('在 '.length).trimStart();
  const quotedTarget = readQuotedToken(afterPrefix);

  if (quotedTarget) {
    const rest = afterPrefix.slice(quotedTarget.length).trimStart();
    if (!rest.startsWith('输入 ')) {
      return undefined;
    }

    return { type: 'fill', text: quotedTarget.value, value: stripWrappingQuotes(rest.slice('输入 '.length)) };
  }

  const separator = ' 输入 ';
  const separatorIndex = afterPrefix.indexOf(separator);
  if (separatorIndex < 0) {
    return undefined;
  }

  return {
    type: 'fill',
    text: stripWrappingQuotes(afterPrefix.slice(0, separatorIndex)),
    value: stripWrappingQuotes(afterPrefix.slice(separatorIndex + separator.length)),
  };
}

function readQuotedToken(input: string): { value: string; length: number } | undefined {
  const quotePairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ['“', '”'],
    ['‘', '’'],
    ['「', '」'],
    ['『', '』'],
    ['《', '》'],
  ];

  for (const [open, close] of quotePairs) {
    if (!input.startsWith(open)) {
      continue;
    }

    const closeIndex = input.indexOf(close, open.length);
    if (closeIndex >= 0) {
      return {
        value: input.slice(open.length, closeIndex).trim(),
        length: closeIndex + close.length,
      };
    }
  }

  return undefined;
}

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  const quotePairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ['“', '”'],
    ['‘', '’'],
    ['「', '」'],
    ['『', '』'],
    ['《', '》'],
  ];

  for (const [open, close] of quotePairs) {
    if (trimmed.startsWith(open) && trimmed.endsWith(close)) {
      return trimmed.slice(open.length, trimmed.length - close.length).trim();
    }
  }

  return trimmed;
}
