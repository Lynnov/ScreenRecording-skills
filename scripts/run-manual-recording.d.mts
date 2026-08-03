export interface BuildManualRecordingSpawnInput {
  electronPath: string;
  entryPath: string;
  mode: string;
  runDir: string;
  displayMode: string;
  segmentId?: string;
}

export interface ManualRecordingSpawnConfig {
  command: string;
  args: string[];
  options: {
    stdio: 'inherit';
    windowsHide: false;
  };
}

export function buildManualRecordingSpawn(
  input: BuildManualRecordingSpawnInput,
): ManualRecordingSpawnConfig;
