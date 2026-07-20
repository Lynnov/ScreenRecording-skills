import { copyFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';

const sourceDir = path.resolve('pocs/manual-recording');
const outputDir = path.resolve('dist/manual-recording-poc/pocs/manual-recording');
await mkdir(outputDir, { recursive: true });
const htmlFiles = (await readdir(sourceDir)).filter((file) => file.endsWith('.html'));
for (const file of htmlFiles) {
  await copyFile(path.join(sourceDir, file), path.join(outputDir, file));
}
