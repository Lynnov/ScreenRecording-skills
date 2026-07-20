import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildEnableBorderlessCommand, buildRestoreWindowCommand } from '../../src/lib/video-generator/capture/windows-window-mode.js';

test('builds encoded PowerShell commands with a restorable snapshot', () => {
  const enable = buildEnableBorderlessCommand(102n);
  assert.equal(enable.command, 'powershell.exe');
  assert.ok(enable.args.includes('-EncodedCommand'));
  assert.match(enable.decodedScript, /GetWindowRect/);
  assert.match(enable.decodedScript, /SetWindowLongPtr/);

  const restore = buildRestoreWindowCommand(102n, {
    style: 13565952n,
    bounds: { left: 10, top: 20, right: 1290, bottom: 740 },
  });
  assert.match(restore.decodedScript, /SetWindowPos/);
  assert.match(restore.decodedScript, /SWP_FRAMECHANGED/);
  assert.match(restore.decodedScript, /13565952/);
});
