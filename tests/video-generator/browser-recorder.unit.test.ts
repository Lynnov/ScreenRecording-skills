import { test } from 'node:test';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { recordTimelineSegments } from '../../src/lib/video-generator/browser/recorder.js';
import { demoDataUrl } from '../../src/lib/video-generator/browser/demo-page.js';
import { VideoGeneratorError, type Timeline, type VideoGeneratorConfig } from '../../src/lib/video-generator/types.js';

const execFileAsync = promisify(execFile);

async function readVideoDimensions(videoPath: string): Promise<{ width: number; height: number }> {
  const result = await execFileAsync('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height',
    '-of',
    'csv=s=x:p=0',
    videoPath,
  ]);
  const [width, height] = result.stdout.trim().split('x').map(Number);
  return { width: width ?? 0, height: height ?? 0 };
}

function makeConfig(outputDir: string): VideoGeneratorConfig {
  return {
    viewport: { width: 640, height: 360 },
    speechRateCharsPerMinute: 600,
    segmentBufferMs: 0,
    actionTimeoutMs: 1000,
    ttsProvider: 'aliyun',
    subtitleMode: 'burn-in',
    outputDir,
  };
}

async function withStateServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });

    if (request.url === '/start') {
      response.end(`
        <main>
          <button>Remember</button>
          <script>
            document.querySelector('button').addEventListener('click', () => {
              localStorage.setItem('browser-recorder-state', 'ready');
              document.cookie = 'browser_recorder_cookie=ready; path=/';
              history.pushState({}, '', '/ready');
              document.body.insertAdjacentHTML('beforeend', '<p>ready:' + document.cookie + '</p>');
            });
          </script>
        </main>
      `);
      return;
    }

    response.end(`
      <main>
        <h1 id="state">Loading</h1>
        <script>
          document.querySelector('#state').textContent = localStorage.getItem('browser-recorder-state') + ':' + document.cookie;
        </script>
      </main>
    `);
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));

  try {
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error?: Error) => error ? reject(error) : resolve());
    });
  }
}

async function withPreparedDomServer(run: (url: string) => Promise<void>): Promise<void> {
  const server = createServer((request, response) => {
    if (request.url === '/style.css') {
      response.writeHead(200, { 'content-type': 'text/css' });
      response.end('.prepared-asset { color: rgb(0, 128, 0); }');
      return;
    }

    if (request.url !== '/page') {
      response.writeHead(404);
      response.end('Not found');
      return;
    }

    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(`
      <!doctype html>
      <html>
        <head>
          <link rel="stylesheet" href="/style.css" />
        </head>
        <body>
          <main style="height: 2000px">
            <button>Prepare DOM</button>
            <input id="name" value="initial" />
            <textarea id="notes">initial notes</textarea>
            <input id="accepted" type="checkbox" />
          </main>
          <script>
            document.querySelector('button').addEventListener('click', () => {
              document.querySelector('#name').value = 'prepared value';
              document.querySelector('#notes').value = 'prepared notes';
              document.querySelector('#accepted').checked = true;
              document.scrollingElement.scrollTop = 350;
              document.body.insertAdjacentHTML('beforeend', '<p id="prepared-marker" class="prepared-asset">Prepared without URL change</p>');
            });
          </script>
        </body>
      </html>
    `);
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));

  try {
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}/page`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error?: Error) => error ? reject(error) : resolve());
    });
  }
}

test('recordTimelineSegments records one clip per segment', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'browser-recorder-'));

  try {
    const timeline: Timeline = {
      version: 1,
      title: 'Recorder smoke',
      segments: [
        {
          id: 'intro',
          sourceText: 'intro',
          narration: 'intro',
          subtitle: 'intro',
          estimatedDurationMs: 250,
          bufferMs: 0,
          actions: [
            { type: 'goto', url: demoDataUrl('<main><h1>Intro</h1><button>Next</button></main>'), waitFor: { type: 'text', value: 'Intro' } },
          ],
          assets: {},
        },
        {
          id: 'details',
          sourceText: 'details',
          narration: 'details',
          subtitle: 'details',
          estimatedDurationMs: 250,
          bufferMs: 0,
          actions: [
            { type: 'goto', url: demoDataUrl('<main><h1>Details</h1></main>'), waitFor: { type: 'text', value: 'Details' } },
          ],
          assets: {},
        },
      ],
    };

    const updated = await recordTimelineSegments({ timeline, config: makeConfig(outputDir), outputDir });

    for (const segment of updated.segments) {
      const clipPath = segment.assets.clipPath;
      if (clipPath === undefined) {
        assert.fail(`expected clip path for ${segment.id}`);
      }
      assert.ok(existsSync(clipPath), `expected clip at ${clipPath}`);
    }
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('recordTimelineSegments records clips at configured viewport size', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'browser-recorder-size-'));

  try {
    const config = makeConfig(outputDir);
    config.viewport = { width: 320, height: 180 };
    const timeline: Timeline = {
      version: 1,
      title: 'Recorder size',
      segments: [
        {
          id: 'sized-clip',
          sourceText: 'size',
          narration: 'size',
          subtitle: 'size',
          estimatedDurationMs: 250,
          bufferMs: 0,
          actions: [
            { type: 'goto', url: demoDataUrl('<main><h1>Size</h1></main>'), waitFor: { type: 'text', value: 'Size' } },
          ],
          assets: {},
        },
      ],
    };

    const updated = await recordTimelineSegments({ timeline, config, outputDir });
    const clipPath = updated.segments[0]?.assets.clipPath;
    assert.equal(typeof clipPath, 'string');

    const dimensions = await readVideoDimensions(clipPath as string);
    assert.deepEqual(dimensions, config.viewport);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('recordTimelineSegments preserves prepared page storage across segment contexts', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'browser-recorder-state-'));

  try {
    await withStateServer(async (baseUrl) => {
      const timeline: Timeline = {
        version: 1,
        title: 'Recorder state',
        segments: [
          {
            id: 'prepare',
            sourceText: 'prepare',
            narration: 'prepare',
            subtitle: 'prepare',
            estimatedDurationMs: 250,
            bufferMs: 0,
            actions: [
              { type: 'goto', url: `${baseUrl}/start`, waitFor: { type: 'text', value: 'Remember' } },
              { type: 'click', text: 'Remember', waitFor: { type: 'text', value: 'ready:browser_recorder_cookie=ready' } },
            ],
            assets: {},
          },
          {
            id: 'reuse-state',
            sourceText: 'reuse',
            narration: 'reuse',
            subtitle: 'reuse',
            estimatedDurationMs: 250,
            bufferMs: 0,
            actions: [
              { type: 'waitFor', target: { type: 'text', value: 'ready:browser_recorder_cookie=ready' } },
            ],
            assets: {},
          },
        ],
      };

      const updated = await recordTimelineSegments({ timeline, config: makeConfig(outputDir), outputDir });

      for (const segment of updated.segments) {
        const clipPath = segment.assets.clipPath;
        if (clipPath === undefined) {
          assert.fail(`expected clip path for ${segment.id}`);
        }
        assert.ok(existsSync(clipPath), `expected clip at ${clipPath}`);
      }

      const state = JSON.parse(await readFile(join(outputDir, 'browser-state.json'), 'utf8')) as { cookies?: unknown[]; origins?: unknown[] };
      assert.ok((state.cookies ?? []).length > 0);
      assert.ok((state.origins ?? []).length > 0);
    });
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('recordTimelineSegments records prepared DOM when action changes DOM without changing URL', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'browser-recorder-prepared-dom-'));

  try {
    await withPreparedDomServer(async (url) => {
      const timeline: Timeline = {
        version: 1,
        title: 'Recorder prepared DOM',
        segments: [
          {
            id: 'prepared-dom',
            sourceText: 'prepared',
            narration: 'prepared',
            subtitle: 'prepared',
            estimatedDurationMs: 250,
            bufferMs: 0,
            actions: [
              { type: 'goto', url, waitFor: { type: 'text', value: 'Prepare DOM' } },
              { type: 'click', text: 'Prepare DOM', waitFor: { type: 'text', value: 'Prepared without URL change' } },
            ],
            assets: {},
          },
        ],
      };

      const updated = await recordTimelineSegments({ timeline, config: makeConfig(outputDir), outputDir });
      const preparedHtmlPath = updated.segments[0]?.assets.preparedHtmlPath;

      assert.equal(typeof preparedHtmlPath, 'string');
      const preparedHtml = await readFile(preparedHtmlPath as string, 'utf8');
      assert.match(preparedHtml, /Prepared without URL change/);
      assert.match(preparedHtml, /value="prepared value"/);
      assert.match(preparedHtml, />prepared notes<\/textarea>/);
      assert.match(preparedHtml, /id="accepted"[^>]*checked/);
      assert.match(preparedHtml, new RegExp(`<base href="${url}"`));
      assert.match(preparedHtml, /data-prepared-scroll-y="350"/);
      assert.match(preparedHtml, /window\.scrollTo\(0,\s*350\)/);
    });
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('recordTimelineSegments screenshots failed segment actions', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'browser-recorder-fail-'));

  try {
    const timeline: Timeline = {
      version: 1,
      title: 'Recorder failure',
      segments: [
        {
          id: 'missing-click',
          sourceText: 'missing',
          narration: 'missing',
          subtitle: 'missing',
          estimatedDurationMs: 100,
          bufferMs: 0,
          actions: [
            { type: 'goto', url: demoDataUrl('<main><button>Exists</button></main>') },
            { type: 'click', text: 'Missing' },
          ],
          assets: {},
        },
      ],
    };

    await assert.rejects(
      () => recordTimelineSegments({ timeline, config: makeConfig(outputDir), outputDir }),
      (error) => {
        const screenshotPath = join(outputDir, 'screenshots', 'missing-click.png');
        assert.ok(error instanceof VideoGeneratorError);
        assert.equal(error.segmentId, 'missing-click');
        assert.match(error.message, /missing-click/);
        assert.match(error.message, new RegExp(screenshotPath.replaceAll('\\', '\\\\')));
        assert.equal(existsSync(screenshotPath), true);
        assert.deepEqual((error as { failedAction?: unknown }).failedAction, { type: 'click', text: 'Missing' });
        return true;
      },
    );
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
