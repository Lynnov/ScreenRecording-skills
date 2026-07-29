const MANUAL_RECORDER_CHANNELS = {
  start: 'manual-recorder:start',
  started: 'manual-recorder:started',
  stop: 'manual-recorder:stop',
  firstChunk: 'manual-recorder:first-chunk',
  appendChunk: 'manual-recorder:append-chunk',
  flush: 'manual-recorder:flush',
  completed: 'manual-recorder:completed',
  failed: 'manual-recorder:failed',
} as const;

export = { MANUAL_RECORDER_CHANNELS };
