import { exec } from 'node:child_process';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

import { loadProjectEnv } from '../lib/video-generator/env.js';

const execAsync = promisify(exec);

type DoctorStatus = 'ok' | 'missing';

export interface DoctorCheck {
  name: string;
  status: DoctorStatus;
  detail: string;
  agentAdvice?: string;
  blocking?: boolean;
}

interface CommandResult {
  stdout: string;
}

export interface VideoDoctorCliIo {
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  runChecks?: () => Promise<DoctorCheck[]>;
}

export interface RunVideoDoctorChecksInput {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  runCommand?: (command: string, args: string[]) => Promise<CommandResult>;
  getPlaywrightExecutablePath?: () => string;
  platform?: NodeJS.Platform;
  outputDir?: string;
}

export async function runVideoDoctorCli(argv: string[], io: VideoDoctorCliIo = {}): Promise<number> {
  const stdout = io.stdout ?? console.log;
  const stderr = io.stderr ?? console.error;

  if (argv.length > 0) {
    stderr(`Unknown argument: ${argv[0]}\nUsage: npm run video:doctor`);
    return 1;
  }

  const checks = await (io.runChecks ?? (() => runVideoDoctorChecks({ cwd: io.cwd, env: io.env })))();
  const missingCount = checks.filter((check) => check.status === 'missing' && check.blocking !== false).length;

  stdout(formatDoctorReport(checks));

  if (missingCount > 0) {
    stdout(`发现 ${missingCount} 项需要处理。请让 agent 先解释影响并请求授权，再执行安装或配置。`);
    return 1;
  }

  stdout('环境检查通过，可以继续生成内置演示视频。');
  return 0;
}

export async function runVideoDoctorChecks(input: RunVideoDoctorChecksInput = {}): Promise<DoctorCheck[]> {
  const cwd = input.cwd ?? process.cwd();
  const env = await loadProjectEnv(cwd, input.env ?? process.env);
  const runCommand = input.runCommand ?? runSystemCommand;
  const getPlaywrightExecutablePath = input.getPlaywrightExecutablePath ?? (() => chromium.executablePath());
  const platform = input.platform ?? process.platform;

  const checks: DoctorCheck[] = [];
  checks.push(platform === 'win32'
    ? { name: 'Windows', status: 'ok', detail: platform }
    : { name: 'Windows', status: 'missing', detail: `manual recording requires win32, got ${platform}` });
  checks.push(checkNodeVersion());
  checks.push(await checkCommand('npm', ['--version'], {
    okName: 'npm',
    missingDetail: 'npm command is not available',
    agentAdvice: '请确认 Node.js 安装是否包含 npm；如未安装，请向用户说明后安装 Node.js LTS。',
  }, runCommand));
  checks.push(await checkPath(path.join(cwd, 'node_modules'), {
    name: 'npm dependencies',
    okDetail: 'node_modules exists',
    missingDetail: 'node_modules not found',
    agentAdvice: '请向用户说明需要安装项目依赖，获得授权后运行：npm install',
  }));
  checks.push(await checkPath(path.join(cwd, 'node_modules', 'electron', 'dist', 'electron.exe'), {
    name: 'Electron',
    okDetail: 'electron.exe exists',
    missingDetail: 'Electron executable not found',
    agentAdvice: 'Install project dependencies before using manual recording.',
  }));
  checks.push(checkPlaywrightChromium(getPlaywrightExecutablePath));
  checks.push(await checkCommand('ffmpeg', ['-version'], {
    okName: 'ffmpeg',
    missingDetail: 'ffmpeg command is not available',
    agentAdvice: '请根据当前系统选择安装方式；Windows 可优先尝试 winget 安装 Gyan.FFmpeg，执行前必须请求用户授权。',
  }, runCommand));
  checks.push(await checkCommandOutput('ffmpeg', ['-encoders'], 'libx264', {
    name: 'ffmpeg libx264',
    missingDetail: 'ffmpeg does not report the libx264 encoder',
    agentAdvice: 'Install an ffmpeg build with libx264 enabled.',
  }, runCommand));
  checks.push(await checkCommand('ffprobe', ['-version'], {
    okName: 'ffprobe',
    missingDetail: 'ffprobe command is not available',
    agentAdvice: 'ffprobe 通常随 ffmpeg 一起安装；请请求用户授权后安装或修复 ffmpeg。',
  }, runCommand));
  checks.push(checkEnvKey(env));
  checks.push(await checkWritableOutput(input.outputDir ?? path.join(cwd, 'video-runs')));
  checks.push(await checkPath(path.join(cwd, 'examples', 'video-generator', 'basic-demo.md'), {
    name: 'basic demo script',
    okDetail: 'examples/video-generator/basic-demo.md exists',
    missingDetail: 'examples/video-generator/basic-demo.md not found',
    agentAdvice: '请确认当前工作目录是项目根目录，或检查示例文件是否被误删。',
  }));

  return checks;
}

function checkNodeVersion(): DoctorCheck {
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  const supported = major > 22 || (major === 22 && minor >= 12);
  return supported
    ? { name: 'Node.js', status: 'ok', detail: process.version }
    : { name: 'Node.js', status: 'missing', detail: `Node.js >=22.12.0 required, got ${process.version}` };
}

function formatDoctorReport(checks: DoctorCheck[]): string {
  return checks.map((check) => {
    const lines = [`${check.name}: ${check.status === 'ok' ? 'OK' : 'missing'}`, `  说明：${check.detail}`];
    if (check.status === 'missing' && check.agentAdvice !== undefined) {
      lines.push(`  建议给 agent：${check.agentAdvice}`);
    }
    return lines.join('\n');
  }).join('\n');
}

async function checkCommand(command: string, args: string[], input: {
  okName: string;
  missingDetail: string;
  agentAdvice: string;
}, runCommand: (command: string, args: string[]) => Promise<CommandResult>): Promise<DoctorCheck> {
  try {
    const result = await runCommand(command, args);
    const firstLine = result.stdout.split(/\r?\n/).find((line) => line.trim().length > 0);
    return { name: input.okName, status: 'ok', detail: firstLine ?? `${command} is available` };
  } catch {
    return { name: input.okName, status: 'missing', detail: input.missingDetail, agentAdvice: input.agentAdvice };
  }
}

async function checkCommandOutput(
  command: string,
  args: string[],
  expected: string,
  input: { name: string; missingDetail: string; agentAdvice: string },
  runCommand: (command: string, args: string[]) => Promise<CommandResult>,
): Promise<DoctorCheck> {
  try {
    const result = await runCommand(command, args);
    if (!result.stdout.includes(expected)) throw new Error(input.missingDetail);
    return { name: input.name, status: 'ok', detail: `${expected} available` };
  } catch {
    return { name: input.name, status: 'missing', detail: input.missingDetail, agentAdvice: input.agentAdvice };
  }
}

async function runSystemCommand(command: string, args: string[]): Promise<CommandResult> {
  const result = await execAsync([command, ...args].join(' '));
  return { stdout: result.stdout };
}

async function checkPath(targetPath: string, input: {
  name: string;
  okDetail: string;
  missingDetail: string;
  agentAdvice: string;
}): Promise<DoctorCheck> {
  try {
    await access(targetPath);
    return { name: input.name, status: 'ok', detail: input.okDetail };
  } catch {
    return { name: input.name, status: 'missing', detail: input.missingDetail, agentAdvice: input.agentAdvice };
  }
}

function checkPlaywrightChromium(getExecutablePath: () => string): DoctorCheck {
  try {
    const executablePath = getExecutablePath();
    return { name: 'Playwright Chromium', status: 'ok', detail: executablePath };
  } catch (error) {
    return {
      name: 'Playwright Chromium',
      status: 'missing',
      detail: error instanceof Error ? error.message : 'browser executable not found',
      agentAdvice: '请向用户说明需要下载 Chromium，获得授权后运行：npx playwright install chromium',
    };
  }
}

function checkEnvKey(env: NodeJS.ProcessEnv): DoctorCheck {
  const value = env.DASHSCOPE_API_KEY;
  if (value !== undefined && value.trim().length > 0) {
    return { name: 'DASHSCOPE_API_KEY', status: 'ok', detail: 'configured' };
  }

  return {
    name: 'DASHSCOPE_API_KEY',
    status: 'missing',
    detail: 'environment variable is empty',
    blocking: false,
    agentAdvice: '请向用户索取 DashScope API Key，获得授权后写入本机 .env 或当前终端环境。',
  };
}

async function checkWritableOutput(outputDir: string): Promise<DoctorCheck> {
  const probePath = path.join(outputDir, `.write-probe-${process.pid}`);
  try {
    await mkdir(outputDir, { recursive: true });
    await writeFile(probePath, 'ok', { flag: 'wx' });
    await rm(probePath, { force: true });
    return { name: 'manual output directory', status: 'ok', detail: outputDir };
  } catch (error) {
    await rm(probePath, { force: true }).catch(() => undefined);
    return {
      name: 'manual output directory',
      status: 'missing',
      detail: error instanceof Error ? error.message : String(error),
      agentAdvice: 'Choose a writable --output directory.',
    };
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const exitCode = await runVideoDoctorCli(process.argv.slice(2));
  process.exitCode = exitCode;
}
