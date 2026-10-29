import assert from 'node:assert/strict';
import { win32, join } from 'node:path';

export function readerProcessesForRegistration(processes, registration) {
  const command = registration?.transport?.command;
  assert.ok(command && win32.basename(command).toLowerCase() === 'reader-launcher.exe');
  const family = win32.dirname(win32.dirname(command)).toLowerCase() + '\\';
  return processes.filter(process => process.Name === 'reader-launcher.exe' && typeof process.ExecutablePath === 'string'
    && win32.normalize(process.ExecutablePath).toLowerCase().startsWith(family));
}

export function assertCliDeliverySafe(threadId, activeProcesses) {
  assert.ok(!threadId && activeProcesses.length === 0,
    'CLI installation cannot replace a running desktop MCP connection. Use stage, the desktop Reader Install/Update control, then complete.');
}

export function hostInstallAction(receipt) {
  assert.equal(receipt.phase, 'awaiting-host-install');
  assert.ok(receipt.inspection && receipt.candidate?.version && receipt.marketplace);
  assert.match(receipt.candidate.version, /^\d+\.\d+\.\d+$/);
  assert.match(receipt.candidate.source.commit, /^[a-f0-9]{40}$/);
  return { method: 'desktop-plugin-install', pluginName: 'reader-win32-x64', marketplaceName: 'reader-marketplace',
    marketplacePath: join(receipt.marketplace, '.agents', 'plugins', 'marketplace.json'),
    expectedVersion: receipt.candidate.version, expectedSourceCommit: receipt.candidate.source.commit,
    description: 'Use the desktop plugin directory Install/Update action for this exact Reader marketplace, then complete the package and data-integrity checks.' };
}
