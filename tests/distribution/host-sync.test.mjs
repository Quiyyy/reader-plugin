import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { syncRequest, automationRequest, validateEvidence } from '../../scripts/reader-host-sync.mjs';

const thread = '12345678-1234-1234-1234-123456789abc';
const receipt = () => ({ phase: 'installed-and-verified', candidate: { version: '0.2.12', source: { commit: 'a'.repeat(40) } }, verification: { version: '0.2.12', allPersistentDataByteIdentical: true, uiSha256: 'b'.repeat(64) } });
test('an explicitly requested host diagnostic can describe a single follow-up in its own thread', () => {
  const request = syncRequest(receipt(), resolve('receipt.json'), thread), automation = automationRequest(request);
  assert.equal(request.status, 'pending'); assert.equal(request.resourceUri, 'ui://reader/v0.2.12/bookshelf.html');
  assert.equal(automation.kind, 'heartbeat'); assert.equal(automation.targetThreadId, thread); assert.match(automation.rrule, /COUNT=1/);
  assert.match(automation.prompt, /不降级/); assert.match(automation.prompt, /meta\[name="reader-version"\]/);
});
test('unverified packages or changed data cannot enter the optional host diagnostic', () => {
  for (const patch of [{ phase: 'prepared' }, { verification: { version: '0.2.11', allPersistentDataByteIdentical: true } }, { verification: { version: '0.2.12', allPersistentDataByteIdentical: false } }]) {
    assert.throws(() => syncRequest({ ...receipt(), ...patch }, resolve('receipt.json'), thread));
  }
  assert.throws(() => syncRequest(receipt(), resolve('receipt.json'), ''));
});
test('the one-off schedule has a future occurrence across hour and date boundaries', () => {
  const request = syncRequest(receipt(), resolve('receipt.json'), thread);
  assert.equal(automationRequest(request, new Date('2026-10-29T07:59:50Z'), 'Asia/Shanghai').rrule, 'FREQ=DAILY;BYHOUR=16;BYMINUTE=1;BYSECOND=50;COUNT=1');
  assert.equal(automationRequest(request, new Date('2026-10-29T15:59:50Z'), 'Asia/Shanghai').rrule, 'FREQ=DAILY;BYHOUR=0;BYMINUTE=1;BYSECOND=50;COUNT=1');
});
test('native standalone startup, stale UI and another thread cannot masquerade as host acceptance', () => {
  const request = syncRequest(receipt(), resolve('receipt.json'), thread);
  const now = new Date(Date.parse(request.requestedAt) + 1).toISOString();
  const good = { origin: 'codex-mcpapps', threadId: thread, version: request.version, registeredVersion:request.version, sourceCommit:request.sourceCommit, serverVersion:request.version, serverObservedAt:now, observedAt:now, screenshot: resolve('host.png') };
  for (const change of [{ origin: 'simulated-AppBridge-with-native-MCP' }, { origin: 'standalone' }, { version: '0.2.11' }, { registeredVersion:'0.2.11' }, { sourceCommit:'c'.repeat(40) }, { serverVersion:'0.2.11' }, { threadId: 'another-thread' }, { observedAt: '2020-01-01T00:00:00Z' }, { serverObservedAt:'2020-01-01T00:00:00Z' }]) assert.throws(() => validateEvidence(request, { ...good, ...change }));
  assert.doesNotThrow(() => validateEvidence(request, good));
  assert.throws(() => validateEvidence({ ...request, status: 'verified' }, good));
});
