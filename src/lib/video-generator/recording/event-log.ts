import { access, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import type { RecordingEvent } from './types.js';

export async function createEventLog(filePath: string) {
  try {
    await access(filePath);
    throw new Error(`Event log already exists: ${filePath}`);
  } catch (error) {
    if (error instanceof Error && error.name !== 'Error') {
      throw error;
    }
  }

  await mkdir(path.dirname(filePath), { recursive: true });
  const handle = await open(filePath, 'ax');
  return {
    async append(event: RecordingEvent) {
      await handle.appendFile(`${JSON.stringify(event)}\n`, 'utf8');
      await handle.sync();
    },
    async close() {
      await handle.close();
    },
  };
}
