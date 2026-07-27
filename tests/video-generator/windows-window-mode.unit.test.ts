import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildEnableBorderlessCommand,
  buildRestoreWindowCommand,
  enableBorderlessWindowMode,
  restoreBorderlessWindowMode,
  type WindowsCommand,
} from '../../src/lib/video-generator/capture/windows-window-mode.js';

test('builds encoded PowerShell commands with a restorable snapshot', () => {
  const enable = buildEnableBorderlessCommand(102n);
  assert.equal(enable.command, 'powershell.exe');
  assert.ok(enable.args.includes('-EncodedCommand'));
  assert.match(enable.decodedScript, /GetWindowRect/);
  assert.match(enable.decodedScript, /SetWindowLongPtr/);
  assert.match(enable.decodedScript, /DwmGetWindowAttribute/);
  assert.match(enable.decodedScript, /DWMWA_EXTENDED_FRAME_BOUNDS|,\s*9,/);
  assert.match(enable.decodedScript, /16777216/);
  assert.match(enable.decodedScript, /ShowWindow\(\$handle,\s*9\)[\s\S]*SetWindowLongPtr64/);
  assert.match(enable.decodedScript, /appliedStyle\s*=\s*\[string\]\$appliedStyle/);
  assert.match(enable.decodedScript, /\$styleApplied[\s\S]*\$boundsApplied[\s\S]*\$applied\s*=\s*\$styleApplied\s*-and\s*\$boundsApplied/);

  const restore = buildRestoreWindowCommand(102n, {
    style: 13565952n,
    exStyle: 256n,
    bounds: { left: 10, top: 20, right: 1290, bottom: 740 },
  });
  assert.match(restore.decodedScript, /SetWindowPos/);
  assert.match(restore.decodedScript, /SWP_FRAMECHANGED/);
  assert.match(restore.decodedScript, /ShowWindow\(\$handle,\s*\$showCommand\)/);
  assert.match(restore.decodedScript, /16777216/);
  assert.match(restore.decodedScript, /13565952/);
  assert.match(restore.decodedScript, /256/);
});

test('applies a verified borderless mode and restores its complete snapshot', async () => {
  const calls: WindowsCommand[] = [];
  const mode = await enableBorderlessWindowMode('window:123456:0', async (command) => {
    calls.push(command);
    return {
      stdout: JSON.stringify({
        handle: '123456',
        snapshot: {
          style: '13565952',
          exStyle: '256',
          bounds: { left: 10, top: 20, right: 1290, bottom: 740 },
        },
        appliedBounds: { left: 0, top: 0, right: 1920, bottom: 1040 },
        applied: true,
      }),
      stderr: '',
    };
  });

  assert.equal(mode.handle, 123456n);
  assert.equal(mode.snapshot.style, 13565952n);
  assert.equal(mode.snapshot.exStyle, 256n);
  assert.deepEqual(mode.appliedBounds, { left: 0, top: 0, right: 1920, bottom: 1040 });
  assert.match(calls[0]!.decodedScript, /\[Math\]::Abs/);
  assert.match(calls[0]!.decodedScript, /-le 1/);

  await restoreBorderlessWindowMode(mode, async (command) => {
    calls.push(command);
    assert.match(command.decodedScript, /13565952/);
    assert.match(command.decodedScript, /256/);
    return { stdout: '{"restored":true}', stderr: '' };
  });
  assert.equal(calls.length, 2);
});

test('fails closed for invalid window ids and unverified PowerShell results', async () => {
  await assert.rejects(
    () => enableBorderlessWindowMode('screen:0:0', async () => ({ stdout: '{}', stderr: '' })),
    /window source id/i,
  );
  await assert.rejects(
    () => enableBorderlessWindowMode('window:123:0', async () => ({
      stdout: JSON.stringify({
        handle: '123',
        snapshot: {
          style: '1',
          exStyle: '2',
          bounds: { left: 0, top: 0, right: 100, bottom: 100 },
        },
        appliedBounds: { left: 0, top: 0, right: 100, bottom: 100 },
        applied: false,
      }),
      stderr: '',
    })),
    (error: Error) => {
      assert.match(error.message, /not verified/i);
      assert.match(error.message, /"appliedBounds"/);
      assert.match(error.message, /"applied":false/);
      return true;
    },
  );
  await assert.rejects(
    () => restoreBorderlessWindowMode({
      handle: 123n,
      snapshot: {
        style: 1n,
        exStyle: 2n,
        bounds: { left: 0, top: 0, right: 100, bottom: 100 },
      },
      appliedBounds: { left: 0, top: 0, right: 100, bottom: 100 },
      applied: true,
    }, async () => ({ stdout: '{"restored":false}', stderr: '' })),
    /not verified/i,
  );
});
