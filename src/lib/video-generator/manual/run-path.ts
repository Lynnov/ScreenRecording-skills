import path from 'node:path';

export function resolvePathInsideRun(runDir: string, candidatePath: string, label: string): string {
  const resolvedRun = path.resolve(runDir);
  const candidates = path.isAbsolute(candidatePath)
    ? [path.resolve(candidatePath)]
    : [path.resolve(candidatePath), path.resolve(resolvedRun, candidatePath)];
  for (const candidate of candidates) {
    const relative = path.relative(resolvedRun, candidate);
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
      return candidate;
    }
  }
  throw new Error(`${label} path is outside run directory: ${candidatePath}`);
}
