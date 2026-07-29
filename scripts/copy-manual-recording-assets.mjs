import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const assetGroups = [
  {
    // Includes overlay.html and the product recorder.html; never source assets from POCs.
    sourceDir: path.resolve('src/lib/video-generator/recording-overlay'),
    outputDir: path.resolve('dist/manual-recording/src/lib/video-generator/recording-overlay'),
  },
  {
    sourceDir: path.resolve('src/lib/video-generator/review-ui'),
    outputDir: path.resolve('dist/manual-recording/src/lib/video-generator/review-ui'),
  },
];

export function selectManualRecordingAssets(sourceDir, files) {
  const normalized = sourceDir.replaceAll('\\', '/');
  if (normalized.endsWith('recording-overlay')) {
    return files.filter((file) => file === 'overlay.html' || file === 'recorder.html');
  }
  return files.filter((file) => file.endsWith('.html') || file.endsWith('.css'));
}

export async function copyManualRecordingAssets() {
  for (const { sourceDir, outputDir } of assetGroups) {
    await mkdir(outputDir, { recursive: true });
    const files = selectManualRecordingAssets(sourceDir, await readdir(sourceDir));
    for (const file of files) {
      await copyFile(path.join(sourceDir, file), path.join(outputDir, file));
    }
  }
  await build({
    entryPoints: [path.resolve('src/lib/video-generator/recording-overlay/recorder-renderer.mts')],
    outfile: path.resolve('dist/manual-recording/src/lib/video-generator/recording-overlay/recorder-renderer.bundle.js'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'chrome120',
    logLevel: 'silent',
  });
  await writeFile(
    path.resolve('dist/manual-recording/bootstrap.cjs'),
    [
      "import('./src/lib/video-generator/recording-overlay/product-main.js').catch((error) => {",
      "  console.error(error instanceof Error ? error.stack ?? error.message : String(error));",
      '  process.exit(1);',
      '});',
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    path.resolve('dist/manual-recording/package.json'),
    `${JSON.stringify({
      private: true,
      type: 'module',
      main: 'bootstrap.cjs',
    }, null, 2)}\n`,
    'utf8',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await copyManualRecordingAssets();
}
