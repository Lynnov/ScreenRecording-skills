import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

import { createRunArtifacts } from '../../src/lib/video-generator/artifacts.js';

test('createRunArtifacts returns standard run directories and report paths', () => {
  const outputDir = path.join('tmp', 'video run with spaces');
  const artifacts = createRunArtifacts(outputDir);

  assert.equal(artifacts.scriptsDir, path.join(outputDir, 'scripts'));
  assert.equal(artifacts.authDir, path.join(outputDir, 'auth'));
  assert.equal(artifacts.clipsDir, path.join(outputDir, 'clips'));
  assert.equal(artifacts.audioDir, path.join(outputDir, 'audio'));
  assert.equal(artifacts.screenshotsDir, path.join(outputDir, 'screenshots'));
  assert.equal(artifacts.reportsDir, path.join(outputDir, 'reports'));
  assert.equal(artifacts.debugDir, path.join(outputDir, 'debug'));
  assert.equal(artifacts.preflightReportPath, path.join(outputDir, 'reports', 'preflight-report.json'));
  assert.equal(artifacts.runReportPath, path.join(outputDir, 'reports', 'run-report.json'));
  assert.equal(artifacts.candidateReportPath, path.join(outputDir, 'reports', 'candidate-report.json'));
});

test('createRunArtifacts formats debug attempt paths consistently', () => {
  const artifacts = createRunArtifacts('/runs/demo');

  assert.equal(artifacts.debugAttemptPath(1), path.join('/runs/demo', 'debug', 'attempt-001'));
  assert.equal(artifacts.debugAttemptPath(12), path.join('/runs/demo', 'debug', 'attempt-012'));
});
