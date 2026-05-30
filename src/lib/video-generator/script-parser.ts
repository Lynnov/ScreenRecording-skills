import { basicDemoDataUrl } from './browser/demo-page.js';
import { estimateNarrationDurationMs } from './duration.js';
import { validateTimeline } from './timeline-validator.js';
import {
  VideoGeneratorError,
  type BrowserAction,
  type StageDefinition,
  type Timeline,
  type TimelineSegment,
  type VideoGeneratorConfig,
} from './types.js';

export function parseVideoScript(input: string, config: VideoGeneratorConfig): Timeline {
  const stageContext: StageParseContext = {
    currentStageName: undefined,
    stagesByName: new Map(),
  };
  const blocks = input
    .split(/\r?\n\s*\r?\n/u)
    .map((block) => block.trim())
    .filter(Boolean);

  const segments: TimelineSegment[] = [];
  for (const block of blocks) {
    const segment = parseBlock(block, segments.length, config, stageContext);
    if (segment) {
      segments.push(segment);
    }
  }
  const stages = Array.from(stageContext.stagesByName.values());
  const timeline: Timeline = {
    version: 1,
    title: '未命名教程视频',
    ...(stages.length > 0 ? { stages } : {}),
    segments,
  };

  validateTimeline(timeline);
  return timeline;
}

interface StageParseContext {
  currentStageName: string | undefined;
  stagesByName: Map<string, StageDefinition>;
}

function parseBlock(
  block: string,
  index: number,
  config: VideoGeneratorConfig,
  stageContext: StageParseContext,
): TimelineSegment | undefined {
  const sourceText = block.trim();
  const lines = sourceText
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const contentLines: string[] = [];
  const actionStageNames: Array<string | undefined> = [];
  for (const line of lines) {
    const parsedStage = parseStageDeclaration(line, stageContext);
    if (parsedStage) {
      continue;
    }

    contentLines.push(line);
    actionStageNames.push(stageContext.currentStageName);
  }

  if (contentLines.length === 0) {
    return undefined;
  }

  const narrationLine = contentLines.find((line) => line.startsWith('旁白：'));

  if (!narrationLine) {
    throw new VideoGeneratorError('MISSING_NARRATION', 'Each script block must contain 旁白：.');
  }

  const narration = narrationLine.slice('旁白：'.length).trim();
  const actionEntries = contentLines
    .map((line, lineIndex) => ({ line, stageName: actionStageNames[lineIndex] }))
    .filter((entry) => entry.line !== narrationLine);

  if (actionEntries.length === 0) {
    throw new VideoGeneratorError('MISSING_ACTION', 'Each script block must contain at least one action.');
  }

  const actions = actionEntries.map((entry) => withStageName(parseAction(entry.line), entry.stageName));

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

function parseStageDeclaration(line: string, stageContext: StageParseContext): boolean {
  if (!/^@stage(?:\s|$)/u.test(line)) {
    return false;
  }

  const declaration = line.slice('@stage'.length).trim();
  const tokens = readStageTokens(declaration, line);
  const stageName = tokens.shift();

  if (!stageName) {
    throw new VideoGeneratorError('UNSUPPORTED_SCRIPT_ACTION', `Stage declaration must include a stage name: ${line}`);
  }

  if (stageName.includes('=')) {
    throw new VideoGeneratorError('UNSUPPORTED_SCRIPT_ACTION', `Stage declaration must put the stage name before options: ${line}`);
  }

  const stage = stageContext.stagesByName.get(stageName) ?? { name: stageName, anchors: [] };
  for (const token of tokens) {
    const option = parseStageOption(token, line);
    if (option.name === 'scope') {
      stage.scope = option.value;
      continue;
    }

    if (!stage.anchors.includes(option.value)) {
      stage.anchors.push(option.value);
    }
  }

  stageContext.currentStageName = stageName;
  stageContext.stagesByName.set(stageName, stage);
  return true;
}

function readStageTokens(input: string, line: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      current += char;
      if (char === quote) {
        quote = undefined;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }

    if (/\s/u.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (quote) {
    throw new VideoGeneratorError('UNSUPPORTED_SCRIPT_ACTION', `Stage declaration has an unterminated quoted option: ${line}`);
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

function parseStageOption(token: string, line: string): { name: 'scope' | 'anchor'; value: string } {
  const separatorIndex = token.indexOf('=');
  if (separatorIndex < 0) {
    throw new VideoGeneratorError('UNSUPPORTED_SCRIPT_ACTION', `Stage option must use key=value syntax: ${token} in ${line}`);
  }

  const name = token.slice(0, separatorIndex);
  if (name !== 'scope' && name !== 'anchor') {
    throw new VideoGeneratorError('UNSUPPORTED_SCRIPT_ACTION', `Unsupported stage option "${name}" in ${line}`);
  }

  const rawValue = token.slice(separatorIndex + 1);
  const value = stripWrappingQuotes(rawValue);
  if (!value) {
    throw new VideoGeneratorError('UNSUPPORTED_SCRIPT_ACTION', `Stage option "${name}" must not be empty in ${line}`);
  }

  return { name, value };
}

function withStageName(action: BrowserAction, stageName: string | undefined): BrowserAction {
  return stageName ? { ...action, stageName } : action;
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

  const clickSelectorMatch = line.match(/^点击选择器\s+(.+)$/u);
  if (clickSelectorMatch) {
    return { type: 'click', selector: stripWrappingQuotes(clickSelectorMatch[1]) };
  }

  const clickMatch = line.match(/^点击\s+(.+)$/u);
  if (clickMatch) {
    return { type: 'click', text: stripWrappingQuotes(clickMatch[1]) };
  }

  const fillAction = parseFillAction(line);
  if (fillAction) {
    return fillAction;
  }

  const waitForSelectorMatch = line.match(/^等待选择器\s+(.+)$/u);
  if (waitForSelectorMatch) {
    return { type: 'waitFor', target: { type: 'selector', value: stripWrappingQuotes(waitForSelectorMatch[1]) } };
  }

  const waitForHiddenSelectorMatch = line.match(/^等待隐藏选择器\s+(.+)$/u);
  if (waitForHiddenSelectorMatch) {
    return { type: 'waitFor', target: { type: 'hiddenSelector', value: stripWrappingQuotes(waitForHiddenSelectorMatch[1]) } };
  }

  const waitForMatch = line.match(/^等待\s+(.+)$/u);
  if (waitForMatch) {
    return { type: 'waitFor', target: { type: 'text', value: stripWrappingQuotes(waitForMatch[1]) } };
  }

  const scrollToSelectorMatch = line.match(/^向下滚动到选择器\s+(.+)$/u);
  if (scrollToSelectorMatch) {
    return { type: 'scrollTo', target: { type: 'selector', value: stripWrappingQuotes(scrollToSelectorMatch[1]) } };
  }

  const scrollMatch = line.match(/^向下滚动\s+(.+)$/u);
  if (scrollMatch) {
    return { type: 'scroll', y: Number(scrollMatch[1].trim()) };
  }

  throw new VideoGeneratorError('UNSUPPORTED_SCRIPT_ACTION', `Unsupported script action: ${line}`);
}

function parseFillAction(line: string): BrowserAction | undefined {
  if (line.startsWith('在选择器 ')) {
    const afterSelectorPrefix = line.slice('在选择器 '.length).trimStart();
    const separator = ' 输入 ';
    const separatorIndex = afterSelectorPrefix.indexOf(separator);
    if (separatorIndex < 0) {
      return undefined;
    }

    return {
      type: 'fill',
      selector: stripWrappingQuotes(afterSelectorPrefix.slice(0, separatorIndex)),
      value: stripWrappingQuotes(afterSelectorPrefix.slice(separatorIndex + separator.length)),
    };
  }

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
