import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createRunArtifacts } from './artifacts.js';
import type { ScriptDraftManifest, ScriptDraftRole } from './types.js';

export interface PrepareScriptDraftsInput {
  sourceScriptPath: string;
  outputDir: string;
  protectedBusinessTerms?: string[];
  createdAt?: string;
}

const DRAFT_FILE_NAMES: Record<ScriptDraftRole, string> = {
  original: 'original.md',
  polished: 'polished.md',
  executable: 'executable.md',
};

const DEFAULT_PROTECTED_BUSINESS_TERMS = [
  '客户名',
  '地址选择策略',
  '上传文件路径',
  '用户提供的业务测试数据',
];

const BUSINESS_DATA_PROTECTION_NOTICE = '不要覆盖原始脚本；不要未经用户确认替换客户名、地址选择策略、上传文件路径或其他业务测试数据。';

export async function prepareScriptDrafts(input: PrepareScriptDraftsInput): Promise<ScriptDraftManifest> {
  const artifacts = createRunArtifacts(input.outputDir);
  const sourceContent = await readFile(input.sourceScriptPath, 'utf8');
  await mkdir(artifacts.scriptsDir, { recursive: true });

  const originalPath = path.join(artifacts.scriptsDir, DRAFT_FILE_NAMES.original);
  const polishedPath = path.join(artifacts.scriptsDir, DRAFT_FILE_NAMES.polished);
  const executablePath = path.join(artifacts.scriptsDir, DRAFT_FILE_NAMES.executable);
  const manifestPath = path.join(artifacts.scriptsDir, 'script-manifest.json');

  await ensureOriginalDraft(originalPath, sourceContent);
  await writeFile(polishedPath, sourceContent, 'utf8');
  await writeFile(executablePath, sourceContent, 'utf8');

  const manifest: ScriptDraftManifest = {
    version: 1,
    sourceScriptPath: input.sourceScriptPath,
    createdAt: input.createdAt ?? new Date().toISOString(),
    overwriteAllowed: false,
    businessDataProtectionNotice: BUSINESS_DATA_PROTECTION_NOTICE,
    protectedBusinessTerms: input.protectedBusinessTerms ?? DEFAULT_PROTECTED_BUSINESS_TERMS,
    drafts: {
      original: {
        role: 'original',
        path: originalPath,
        sourcePath: input.sourceScriptPath,
        overwriteAllowed: false,
      },
      polished: {
        role: 'polished',
        path: polishedPath,
        sourcePath: originalPath,
        overwriteAllowed: true,
      },
      executable: {
        role: 'executable',
        path: executablePath,
        sourcePath: polishedPath,
        overwriteAllowed: true,
      },
    },
    manifestPath,
  };

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

async function ensureOriginalDraft(originalPath: string, sourceContent: string): Promise<void> {
  try {
    await writeFile(originalPath, sourceContent, { encoding: 'utf8', flag: 'wx' });
    return;
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'EEXIST') {
      throw error;
    }
  }

  const existingContent = await readFile(originalPath, 'utf8');
  if (existingContent !== sourceContent) {
    throw new Error(`scripts/original.md already exists with different content. Do not overwrite the user's original script; please check ${originalPath}.`);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
