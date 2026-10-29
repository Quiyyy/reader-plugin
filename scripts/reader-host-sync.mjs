// A delivery handoff for the current Codex thread. Scheduling stays with the
// official automation tool; this module never connects to private host IPC.
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { isAbsolute, resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const requestFile = join(root, 'artifacts', 'reader-host-sync-request.json');
const json = path => fs.readFile(path, 'utf8').then(JSON.parse);
const write = async (path, value) => { await fs.mkdir(dirname(path), { recursive: true }); await fs.writeFile(path + '.tmp', JSON.stringify(value, null, 2) + '\n'); await fs.rename(path + '.tmp', path); };

export function syncRequest(receipt, receiptPath, threadId) {
  assert.equal(receipt.phase, 'installed-and-verified');
  assert.equal(receipt.verification?.version, receipt.candidate.version);
  assert.equal(receipt.verification?.allPersistentDataByteIdentical, true);
  assert.match(receipt.candidate.version, /^\d+\.\d+\.\d+$/);
  assert.match(receipt.candidate.source.commit, /^[a-f0-9]{40}$/);
  assert.match(receipt.verification.uiSha256, /^[a-f0-9]{64}$/);
  assert.ok(isAbsolute(receiptPath));
  assert.match(threadId ?? '', /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i, 'Host synchronization requires the delivery thread ID');
  return { schemaVersion: 1, status: 'pending', requestedAt: new Date().toISOString(), threadId, receiptPath,
    version: receipt.candidate.version, sourceCommit: receipt.candidate.source.commit,
    uiSha256: receipt.verification.uiSha256, resourceUri: `ui://reader/v${receipt.candidate.version}/bookshelf.html` };
}

export function automationRequest(request) {
  return { mode: 'create', kind: 'heartbeat', name: `Reader ${request.version} 交付后同步`, targetThreadId: request.threadId,
    status: 'ACTIVE', rrule: 'FREQ=MINUTELY;INTERVAL=2;COUNT=1',
    prompt: `完成当前 Reader 交付后的自动同步与宿主核验。先读取 ${requestFile} 和其中的交付收据；本次目标版本是 ${request.version}，来源提交为 ${request.sourceCommit}。若请求已完成或被更新版本取代，直接结束，不降级、不重复安装。\n\n这是交付后的新一轮对话，用于让宿主按最新插件注册建立连接。核对官方 CLI 的 Reader 注册版本，并通过当前聊天的 Codex MCP Apps 页面读取 meta[name="reader-version"] 的 content，确认其与目标版本一致。必要时通过受支持的宿主界面重试 Reader 页面一次。只观察版本、布局和普通菜单，不移动或编辑用户书籍和笔记。同时读取页面 html 元素的 data-reader-server-version 和 data-reader-server-checked-at，确认当前 UI 的最近工具响应来自目标后端。保存实际页面截图和 JSON 证据：registeredVersion 为官方 CLI 查得的注册版本，sourceCommit 为该注册安装目录的 manifest 提交，serverVersion 和 serverObservedAt 为这两个 DOM 属性，origin 为 codex-mcpapps，threadId 为本聊天 ID，version 为实际读取值，observedAt 为观察时间，screenshot 为截图绝对路径。\n\n仅在实际宿主页面版本一致后，运行 node scripts/reader-host-sync.mjs accept --evidence <证据绝对路径>，记录完成。如果页面尚未出现或仍使用旧连接，运行 node scripts/reader-host-sync.mjs defer --expected-version ${request.version} --reason <具体原因>，如实说明仍未完成，不以独立启动进程或预览页代替宿主结果。不使用私有控制管道，不强制结束桌面应用或其他 Reader 会话，也不新增轮询任务。最后用一句话报告核验结果。` };
}

export function validateEvidence(request, evidence) {
  assert.equal(request.status, 'pending');
  assert.equal(evidence.origin, 'codex-mcpapps', 'Only the real host page can complete activation');
  assert.equal(evidence.threadId, request.threadId);
  assert.equal(evidence.version, request.version, 'Installed and rendered versions differ');
  assert.equal(evidence.registeredVersion, request.version, 'Registered version changed');
  assert.equal(evidence.sourceCommit, request.sourceCommit, 'Registered package source changed');
  assert.equal(evidence.serverVersion, request.version, 'The UI is connected to an old backend');
  assert.ok(Number.isFinite(Date.parse(evidence.observedAt)) && Date.parse(evidence.observedAt) >= Date.parse(request.requestedAt));
  const serverAt=Date.parse(evidence.serverObservedAt),observedAt=Date.parse(evidence.observedAt);
  assert.ok(Number.isFinite(serverAt)&&serverAt>=Date.parse(request.requestedAt)&&serverAt<=observedAt+1000&&observedAt-serverAt<=30000,'Host backend evidence must come from a recent real UI response');
  assert.ok(isAbsolute(evidence.screenshot ?? ''));
}

export async function enqueueHostSync(receipt, receiptPath, threadId) {
  const request = syncRequest(receipt, resolve(receiptPath), threadId);
  await write(requestFile, request);
  return { status: 'pending', requestFile, threadId, version: request.version, requestedAt: request.requestedAt };
}

async function main() {
  const mode = process.argv[2];
  const { values } = parseArgs({ args: process.argv.slice(3), options: { receipt: { type: 'string' }, 'thread-id': { type: 'string' }, 'automation-id': { type: 'string' }, 'expected-version': { type: 'string' }, evidence: { type: 'string' }, reason: { type: 'string' } } });
  if (mode === 'request') {
    assert.ok(values.receipt); const receipt = await json(values.receipt);
    receipt.hostSync = await enqueueHostSync(receipt, values.receipt, values['thread-id'] ?? process.env.CODEX_THREAD_ID);
    await write(resolve(values.receipt), receipt);
    console.log(JSON.stringify(receipt.hostSync, null, 2)); return;
  }
  const request = await json(requestFile);
  const receipt = await json(request.receiptPath);
  if (receipt.hostSync?.requestedAt === request.requestedAt) Object.assign(request, receipt.hostSync);
  if (mode === 'scheduled' || mode === 'defer') assert.equal(values['expected-version'], request.version, 'A newer delivery replaced this synchronization request');
  if (mode === 'automation') { assert.equal(request.status, 'pending'); console.log(JSON.stringify(automationRequest(request), null, 2)); return; }
  if (mode === 'scheduled') {
    assert.ok(values['automation-id']); request.automationId = values['automation-id']; request.scheduledAt = new Date().toISOString();
  } else if (mode === 'accept') {
    assert.ok(values.evidence); const evidence = await json(values.evidence); validateEvidence(request, evidence);
    const image = await fs.readFile(evidence.screenshot); assert.ok(image.length > 0);
    request.status = 'verified'; request.verifiedAt = new Date().toISOString();
    request.evidence = { ...evidence, screenshotSha256: createHash('sha256').update(image).digest('hex') };
  } else if (mode === 'defer') {
    assert.ok(values.reason); request.lastCheckedAt = new Date().toISOString(); request.reason = values.reason;
  } else throw new Error('Use request|automation|scheduled|accept|defer');
  // Results belong to this delivery's receipt. Never overwrite the latest-request
  // pointer: another delivery may have superseded it while evidence was read.
  receipt.hostSync = { ...request, requestFile };
  if (request.status === 'verified') { receipt.realCodexUIAccepted = true; receipt.verification.realCodexUIAccepted = true; }
  await write(request.receiptPath, receipt);
  console.log(JSON.stringify({ status: request.status, version: request.version, requestFile, automationId: request.automationId }, null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
