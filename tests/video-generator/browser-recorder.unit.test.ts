import { test } from 'node:test';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
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

async function readVideoDurationMs(videoPath: string): Promise<number> {
  const result = await execFileAsync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    videoPath,
  ]);
  return Number.parseFloat(result.stdout.trim()) * 1000;
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

async function withStorageStateServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(`
      <main>
        <h1 id="auth">Loading</h1>
        <script>
          document.querySelector('#auth').textContent = localStorage.getItem('video-generator-auth') + ':' + document.cookie;
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

async function withGapTimingServer(run: (baseUrl: string, getSecondRequestDelayMs: () => number | undefined) => Promise<void>): Promise<void> {
  let firstRequestAtMs: number | undefined;
  let secondRequestDelayMs: number | undefined;

  const server = createServer((request, response) => {
    if (request.url === '/first') {
      firstRequestAtMs = Date.now();
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<main><h1>First</h1></main>');
      return;
    }

    if (request.url === '/second') {
      if (firstRequestAtMs !== undefined) {
        secondRequestDelayMs = Date.now() - firstRequestAtMs;
      }
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<main><h1>Second</h1></main>');
      return;
    }

    response.writeHead(404);
    response.end('Not found');
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));

  try {
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`, () => secondRequestDelayMs);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error?: Error) => error ? reject(error) : resolve());
    });
  }
}

async function withHangingResourceServer(run: (url: string) => Promise<void>): Promise<void> {
  const server = createServer((request, response) => {
    if (request.url === '/pending') {
      return;
    }

    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<main><h1>Ready</h1><script>fetch("/pending").catch(() => undefined)</script></main>');
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

async function withPopupNavigationServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });

    if (request.url === '/start') {
      response.end('<main><h1>Start</h1><a href="/detail" target="_blank">Open detail</a></main>');
      return;
    }

    response.end('<main><h1>Detail</h1></main>');
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

    if (request.url === '/slow-replay.js') {
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
              const slowScript = document.createElement('script');
              slowScript.src = '/slow-replay.js';
              document.body.append(slowScript);
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

test('recordTimelineSegments records multiple segments into one continuous clip', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'browser-recorder-continuous-'));

  try {
    const timeline: Timeline = {
      version: 1,
      title: 'Continuous recorder',
      segments: [
        {
          id: 'open',
          sourceText: 'open',
          narration: 'open',
          subtitle: 'open',
          estimatedDurationMs: 250,
          bufferMs: 0,
          actions: [
            { type: 'goto', url: demoDataUrl('<main><h1>Open</h1><button>Next</button></main>'), waitFor: { type: 'text', value: 'Open' } },
          ],
          assets: {},
        },
        {
          id: 'click',
          sourceText: 'click',
          narration: 'click',
          subtitle: 'click',
          estimatedDurationMs: 250,
          bufferMs: 0,
          actions: [
            { type: 'click', text: 'Next' },
          ],
          assets: {},
        },
      ],
    };

    const updated = await recordTimelineSegments({ timeline, config: makeConfig(outputDir), outputDir });

    assert.equal(typeof updated.assets?.continuousClipPath, 'string');
    assert.ok(existsSync(updated.assets?.continuousClipPath as string));
    assert.equal(updated.segments[0]?.assets.clipPath, updated.assets?.continuousClipPath);
    assert.equal(updated.segments[1]?.assets.clipPath, updated.assets?.continuousClipPath);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('recordTimelineSegments assigns continuous clip to each segment', async () => {
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

test('recordTimelineSegments starts first segment after initial actions complete', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'browser-recorder-initial-action-'));

  try {
    const timeline: Timeline = {
      version: 1,
      title: 'Initial action timing',
      segments: [
        {
          id: 'intro',
          sourceText: 'intro',
          narration: 'intro',
          subtitle: 'intro',
          estimatedDurationMs: 200,
          bufferMs: 0,
          actions: [
            { type: 'goto', url: demoDataUrl('<main><h1>Loading</h1><script>setTimeout(() => document.querySelector(\'h1\').textContent = \'Ready\', 600)</script></main>'), waitFor: { type: 'text', value: 'Ready' } },
          ],
          assets: {},
        },
      ],
    };

    const updated = await recordTimelineSegments({ timeline, config: makeConfig(outputDir), outputDir });

    assert.equal(updated.segments[0]?.startsAtMs, 0);
    assert.equal(updated.segments[0]?.endsAtMs, 200);
    assert.ok((updated.segments[0]?.assets.videoStartMs ?? 0) >= 600);
    assert.equal(
      (updated.segments[0]?.assets.videoEndMs ?? 0) - (updated.segments[0]?.assets.videoStartMs ?? 0),
      200,
    );
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('recordTimelineSegments waits explicit gaps and preserves relative timestamps', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'browser-recorder-gap-'));

  try {
    await withGapTimingServer(async (baseUrl, getSecondRequestDelayMs) => {
      const timeline: Timeline = {
        version: 1,
        title: 'Recorder gaps',
        segments: [
          {
            id: 'first',
            sourceText: 'first',
            narration: 'first',
            subtitle: 'first',
            estimatedDurationMs: 200,
            bufferMs: 0,
            startsAtMs: 0,
            endsAtMs: 200,
            actions: [
              { type: 'goto', url: `${baseUrl}/first`, waitFor: { type: 'text', value: 'First' } },
            ],
            assets: {},
          },
          {
            id: 'second',
            sourceText: 'second',
            narration: 'second',
            subtitle: 'second',
            estimatedDurationMs: 200,
            bufferMs: 0,
            startsAtMs: 700,
            endsAtMs: 900,
            actions: [
              { type: 'goto', url: `${baseUrl}/second`, waitFor: { type: 'text', value: 'Second' } },
            ],
            assets: {},
          },
        ],
      };

      const updated = await recordTimelineSegments({ timeline, config: makeConfig(outputDir), outputDir });
      const clipPath = updated.assets?.continuousClipPath;

      assert.equal(updated.segments[0]?.startsAtMs, 0);
      assert.equal(updated.segments[0]?.endsAtMs, 200);
      assert.equal(updated.segments[1]?.startsAtMs, 700);
      assert.equal(updated.segments[1]?.endsAtMs, 900);
      assert.ok((updated.segments[1]?.assets.videoStartMs ?? 0) >= 700);
      assert.equal(typeof clipPath, 'string');
      assert.ok(existsSync(clipPath as string));
      assert.ok((getSecondRequestDelayMs() ?? 0) >= 600, `expected second action after timeline gap, got ${getSecondRequestDelayMs()}ms`);

      const durationMs = await readVideoDurationMs(clipPath as string);
      assert.ok(durationMs >= 700, `expected recording to include timeline gap, got ${durationMs}ms`);
    });
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('recordTimelineSegments does not wait for network idle after visible targets are ready', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'browser-recorder-networkidle-'));

  try {
    await withHangingResourceServer(async (url) => {
      const timeline: Timeline = {
        version: 1,
        title: 'Recorder hanging resource',
        segments: [
          {
            id: 'ready-page',
            sourceText: 'ready',
            narration: 'ready',
            subtitle: 'ready',
            estimatedDurationMs: 200,
            bufferMs: 0,
            actions: [
              { type: 'goto', url, waitFor: { type: 'text', value: 'Ready' } },
            ],
            assets: {},
          },
        ],
      };
      const config = makeConfig(outputDir);
      config.actionTimeoutMs = 1500;

      const startedAtMs = Date.now();
      await recordTimelineSegments({ timeline, config, outputDir });
      const elapsedMs = Date.now() - startedAtMs;

      assert.ok(elapsedMs < 1000, `expected visible target readiness not to wait for network idle timeout, got ${elapsedMs}ms`);
    });
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('recordTimelineSegments shifts following segments when an action overruns narration timing', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'browser-recorder-action-shift-'));

  try {
    const timeline: Timeline = {
      version: 1,
      title: 'Recorder action shift',
      segments: [
        {
          id: 'intro',
          sourceText: 'intro',
          narration: 'intro',
          subtitle: 'intro',
          estimatedDurationMs: 200,
          bufferMs: 0,
          actions: [
            { type: 'goto', url: demoDataUrl('<main><h1>Intro</h1><button>Show</button><script>document.querySelector(\'button\').addEventListener(\'click\', () => setTimeout(() => document.body.insertAdjacentHTML(\'beforeend\', \'<p>Ready</p>\'), 600))</script></main>'), waitFor: { type: 'text', value: 'Intro' } },
          ],
          assets: {},
        },
        {
          id: 'slow-action',
          sourceText: 'slow',
          narration: 'slow',
          subtitle: 'slow',
          estimatedDurationMs: 200,
          bufferMs: 0,
          startsAtMs: 200,
          endsAtMs: 400,
          actions: [
            { type: 'click', text: 'Show', waitFor: { type: 'text', value: 'Ready' } },
          ],
          assets: {},
        },
        {
          id: 'next-action',
          sourceText: 'next',
          narration: 'next',
          subtitle: 'next',
          estimatedDurationMs: 200,
          bufferMs: 0,
          startsAtMs: 400,
          endsAtMs: 600,
          actions: [
            { type: 'waitFor', target: { type: 'text', value: 'Ready' } },
          ],
          assets: {},
        },
      ],
    };

    const updated = await recordTimelineSegments({ timeline, config: makeConfig(outputDir), outputDir });
    const slowEndsAtMs = updated.segments[1]?.endsAtMs ?? 0;

    assert.equal(slowEndsAtMs, 400);
    assert.equal(updated.segments[2]?.startsAtMs, 400);
    assert.equal(updated.segments[2]?.endsAtMs, 600);
    assert.ok((updated.segments[1]?.assets.videoStartMs ?? 0) >= 800);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('recordTimelineSegments extends segment timing when actions take longer than narration', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'browser-recorder-action-duration-'));

  try {
    const timeline: Timeline = {
      version: 1,
      title: 'Recorder action duration',
      segments: [
        {
          id: 'intro',
          sourceText: 'intro',
          narration: 'intro',
          subtitle: 'intro',
          estimatedDurationMs: 200,
          bufferMs: 0,
          actions: [
            { type: 'goto', url: demoDataUrl('<main><h1>Intro</h1><button>Show</button><script>document.querySelector(\'button\').addEventListener(\'click\', () => setTimeout(() => document.body.insertAdjacentHTML(\'beforeend\', \'<p>Ready</p>\'), 600))</script></main>'), waitFor: { type: 'text', value: 'Intro' } },
          ],
          assets: {},
        },
        {
          id: 'slow-action',
          sourceText: 'slow',
          narration: 'slow',
          subtitle: 'slow',
          estimatedDurationMs: 200,
          bufferMs: 0,
          startsAtMs: 200,
          endsAtMs: 400,
          actions: [
            { type: 'click', text: 'Show', waitFor: { type: 'text', value: 'Ready' } },
          ],
          assets: {},
        },
      ],
    };

    const startedAtMs = Date.now();
    const updated = await recordTimelineSegments({ timeline, config: makeConfig(outputDir), outputDir });
    const elapsedMs = Date.now() - startedAtMs;
    const clipPath = updated.assets?.continuousClipPath;

    assert.equal(updated.segments[1]?.startsAtMs, 200);
    assert.equal(updated.segments[1]?.endsAtMs, 400);
    assert.ok((updated.segments[1]?.assets.videoStartMs ?? 0) >= 800);
    assert.equal(typeof clipPath, 'string');
    assert.ok(elapsedMs < 1600, `expected action time not to receive an extra full segment wait, got ${elapsedMs}ms`);
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

test('recordTimelineSegments loads Playwright storage state before recording', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'browser-recorder-storage-state-'));

  try {
    await withStorageStateServer(async (baseUrl) => {
      const storageStatePath = join(outputDir, 'storage-state.json');
      await writeFile(storageStatePath, JSON.stringify({
        cookies: [
          {
            name: 'video_generator_session',
            value: 'cookie-authenticated',
            domain: '127.0.0.1',
            path: '/',
            expires: -1,
            httpOnly: false,
            secure: false,
            sameSite: 'Lax',
          },
        ],
        origins: [
          {
            origin: baseUrl,
            localStorage: [
              { name: 'video-generator-auth', value: 'local-authenticated' },
            ],
          },
        ],
      }), 'utf8');

      const timeline: Timeline = {
        version: 1,
        title: 'Recorder storage state',
        segments: [
          {
            id: 'auth-state',
            sourceText: 'auth',
            narration: 'auth',
            subtitle: 'auth',
            estimatedDurationMs: 250,
            bufferMs: 0,
            actions: [
              {
                type: 'goto',
                url: baseUrl,
                waitFor: { type: 'text', value: 'local-authenticated:video_generator_session=cookie-authenticated' },
              },
            ],
            assets: {},
          },
        ],
      };
      const config = makeConfig(outputDir);
      config.storageStatePath = storageStatePath;

      const updated = await recordTimelineSegments({ timeline, config, outputDir });
      const clipPath = updated.assets?.continuousClipPath;

      assert.equal(typeof clipPath, 'string');
      assert.equal(updated.segments[0]?.assets.clipPath, clipPath);
      assert.ok(existsSync(clipPath as string));
    });
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('recordTimelineSegments preserves live page storage across continuous segments', async () => {
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

      assert.equal(updated.segments[0]?.assets.clipPath, updated.assets?.continuousClipPath);
      assert.equal(updated.segments[1]?.assets.clipPath, updated.assets?.continuousClipPath);
    });
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('recordTimelineSegments keeps target blank navigation in one continuous clip', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'browser-recorder-popup-'));

  try {
    await withPopupNavigationServer(async (baseUrl) => {
      const timeline: Timeline = {
        version: 1,
        title: 'Popup navigation recorder',
        segments: [
          {
            id: 'open-list',
            sourceText: 'open',
            narration: 'open',
            subtitle: 'open',
            estimatedDurationMs: 250,
            bufferMs: 0,
            actions: [
              { type: 'goto', url: `${baseUrl}/start`, waitFor: { type: 'text', value: 'Start' } },
            ],
            assets: {},
          },
          {
            id: 'open-detail',
            sourceText: 'detail',
            narration: 'detail',
            subtitle: 'detail',
            estimatedDurationMs: 250,
            bufferMs: 0,
            actions: [
              { type: 'click', text: 'Open detail', waitFor: { type: 'text', value: 'Detail' } },
            ],
            assets: {},
          },
        ],
      };

      const updated = await recordTimelineSegments({ timeline, config: makeConfig(outputDir), outputDir });
      const clipFiles = (await readdir(join(outputDir, 'clips'))).filter((file) => file.endsWith('.webm'));

      assert.equal(clipFiles.length, 1);
      assert.equal(updated.segments[0]?.assets.clipPath, updated.assets?.continuousClipPath);
      assert.equal(updated.segments[1]?.assets.clipPath, updated.assets?.continuousClipPath);
    });
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('recordTimelineSegments records live DOM changes without prepared HTML output', async () => {
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
      const continuousClipPath = updated.assets?.continuousClipPath;
      const clipPath = updated.segments[0]?.assets.clipPath;

      assert.equal(typeof continuousClipPath, 'string');
      assert.equal(clipPath, continuousClipPath);
      assert.ok(existsSync(continuousClipPath as string));
      assert.equal(updated.segments[0]?.assets.preparedHtmlPath, undefined);
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
