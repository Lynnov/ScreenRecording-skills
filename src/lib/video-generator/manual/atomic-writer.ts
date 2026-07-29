import { access, mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function writeAtomicJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  try {
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

export async function writeNewJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  if (await exists(filePath)) {
    throw new Error(`Protected JSON artifact already exists: ${filePath}`);
  }

  const tempPath = `${filePath}.tmp`;
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(tempPath, 'wx');
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.close();
    handle = null;
    if (await exists(filePath)) {
      throw new Error(`Protected JSON artifact already exists: ${filePath}`);
    }
    await rename(tempPath, filePath);
  } catch (error) {
    if (handle !== null) {
      await handle.close();
    }
    await rm(tempPath, { force: true });
    const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : '';
    if (code === 'EEXIST') {
      throw new Error(`Protected JSON artifact already exists: ${filePath}`);
    }
    throw error;
  }
}
