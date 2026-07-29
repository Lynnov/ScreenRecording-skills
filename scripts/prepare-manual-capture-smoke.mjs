import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const value = (flag) => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
};

const requestedOutput = value('--output');
if (!requestedOutput) throw new Error('--output is required');

const worktree = process.cwd();
const videoRuns = path.resolve(worktree, 'video-runs');
const output = path.resolve(requestedOutput);
const relative = path.relative(videoRuns, output);
if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
  throw new Error('--output must be a child directory of this worktree video-runs');
}

const scriptsDir = path.join(output, 'scripts');
const editDir = path.join(output, 'edit');
await Promise.all([
  mkdir(scriptsDir, { recursive: true }),
  mkdir(editDir, { recursive: true }),
  mkdir(path.join(output, 'capture'), { recursive: true }),
  mkdir(path.join(output, 'pickups'), { recursive: true }),
  mkdir(path.join(output, 'reports'), { recursive: true }),
]);

const guidePath = path.join(scriptsDir, 'recording-guide.v01.json');
const guide = {
  version: 1,
  startUrl: 'http://127.0.0.1:4173/product-capture-smoke.html',
  actions: [
    { id: 'action-001', segmentId: 'segment-001', title: '填写项目名称', instruction: '在项目名称中输入 Smoke 项目', expectedEvents: [{ type: 'input' }], expectedResults: [{ type: 'text-visible', text: 'Smoke 项目' }] },
    { id: 'action-002', segmentId: 'segment-002', title: '首次保存', instruction: '点击保存并确认成功提示', expectedEvents: [{ type: 'click' }], expectedResults: [{ type: 'text-visible', text: '已保存' }] },
    { id: 'action-003', segmentId: 'segment-003', title: '填写补录备注', instruction: '在备注中输入 pickup', expectedEvents: [{ type: 'input' }], expectedResults: [{ type: 'text-visible', text: 'pickup' }] },
    { id: 'action-003b', segmentId: 'segment-003', title: '保存补录内容', instruction: '点击保存并确认提示包含 pickup', expectedEvents: [{ type: 'click' }], expectedResults: [{ type: 'text-visible', text: 'pickup' }] },
    { id: 'action-004', segmentId: 'segment-004', title: '完成录制', instruction: '确认页面保持已保存状态', expectedEvents: [{ type: 'click' }], expectedResults: [{ type: 'text-visible', text: '已保存' }] },
  ],
};
await writeFile(guidePath, `${JSON.stringify(guide, null, 2)}\n`, 'utf8');
await writeFile(path.join(scriptsDir, 'recording-guide.approved.json'), `${JSON.stringify({
  version: 1,
  guideVersion: 1,
  guidePath,
  approvedAt: new Date().toISOString(),
}, null, 2)}\n`, 'utf8');

const agentPlanPath = path.join(editDir, 'edit-plan.agent.v01.json');
const agentPlan = {
  version: 1,
  canvas: { width: 1920, height: 1080, fps: 30 },
  segments: [
    { segmentId: 'segment-001', title: 'Project name', clips: [{ sourceId: 'original', sourceStartMs: 0, sourceEndMs: 1000, playbackRate: 1 }], confidence: 'high', reason: 'Smoke baseline.' },
    { segmentId: 'segment-002', title: 'Initial save', clips: [{ sourceId: 'original', sourceStartMs: 1000, sourceEndMs: 2000, playbackRate: 1 }], confidence: 'high', reason: 'Smoke baseline.' },
    { segmentId: 'segment-003', title: 'Pickup note', clips: [{ sourceId: 'original', sourceStartMs: 2000, sourceEndMs: 3000, playbackRate: 1 }], confidence: 'low', reason: 'Pickup smoke target.' },
    { segmentId: 'segment-004', title: 'Finish recording', clips: [{ sourceId: 'original', sourceStartMs: 3000, sourceEndMs: 4000, playbackRate: 1 }], confidence: 'high', reason: 'Smoke baseline.' },
  ],
};
await writeFile(agentPlanPath, `${JSON.stringify(agentPlan, null, 2)}\n`, 'utf8');
await writeFile(path.join(editDir, 'edit-plan.agent.current.json'), `${JSON.stringify({
  version: 1,
  path: agentPlanPath,
}, null, 2)}\n`, 'utf8');

const reviewPath = path.join(editDir, 'edit-review.v01.json');
const review = {
  version: 1,
  createdAt: new Date().toISOString(),
  reviewComplete: false,
  segments: ['segment-001', 'segment-002', 'segment-003', 'segment-004'].map((segmentId) => ({
    segmentId,
    status: segmentId === 'segment-003' ? 'pickup-required' : 'approved',
    reviewReasons: segmentId === 'segment-003' ? ['真实桌面 smoke 需要验证定向补录。'] : [],
  })),
};
await writeFile(reviewPath, `${JSON.stringify(review, null, 2)}\n`, 'utf8');
await writeFile(path.join(editDir, 'edit-review.current.json'), `${JSON.stringify({
  version: 1,
  path: reviewPath,
}, null, 2)}\n`, 'utf8');

console.log(`Prepared manual product capture smoke: ${output}`);
console.log('Pickup target: segment-003');
