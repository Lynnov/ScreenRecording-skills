import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function loadProjectEnv(cwd = process.cwd(), baseEnv: NodeJS.ProcessEnv = process.env): Promise<NodeJS.ProcessEnv> {
  const fileEnv = await readEnvFile(path.join(cwd, '.env'));
  return { ...fileEnv, ...baseEnv };
}

async function readEnvFile(filePath: string): Promise<NodeJS.ProcessEnv> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf8');
  } catch {
    return {};
  }

  const env: NodeJS.ProcessEnv = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    env[key] = stripQuotes(value);
  }

  return env;
}

function stripQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}
