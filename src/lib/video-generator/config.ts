import type { VideoGeneratorConfig } from './types.js';

export type VideoGeneratorConfigOverrides = Partial<Omit<VideoGeneratorConfig, 'viewport'>> & {
  viewport?: Partial<VideoGeneratorConfig['viewport']>;
};

const DEFAULT_CONFIG: VideoGeneratorConfig = {
  viewport: { width: 1920, height: 1080 },
  speechRateCharsPerMinute: 220,
  segmentBufferMs: 500,
  actionTimeoutMs: 15000,
  ttsProvider: 'aliyun',
  subtitleMode: 'burn-in',
  outputDir: './video-runs',
};

export function loadVideoGeneratorConfig(
  overrides: VideoGeneratorConfigOverrides = {},
): VideoGeneratorConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
    viewport: {
      ...DEFAULT_CONFIG.viewport,
      ...overrides.viewport,
    },
  };
}
