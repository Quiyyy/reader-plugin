import { afterEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { CodexClient } from '../src/server/codex-client.js';

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), access: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('node:fs/promises', () => ({ access: mocks.access }));
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

function processFixture() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(), stderr: new PassThrough(),
    stdin: { write: vi.fn(), end: vi.fn() },
    exitCode: null as number | null, signalCode: null,
    kill: vi.fn(),
  });
  child.stdin.write.mockImplementation((line: string) => {
    const request = JSON.parse(line);
    if (request.id !== undefined) queueMicrotask(() => child.stdout.write(JSON.stringify({ id: request.id, result: { account: { type: 'chatgpt' } } }) + '\n'));
  });
  vi.stubEnv('READER_CODEX_PATH', process.platform === 'win32' ? 'C:\\reader-test\\codex.exe' : '/reader-test/codex');
  mocks.access.mockResolvedValue(undefined); mocks.spawn.mockReturnValue(child);
  return child;
}

it('waits for its process to exit and never reopens a closed client', async () => {
  const child = processFixture(), client = new CodexClient();
  await client.request('account/read');
  let released = false;
  const closing = client.close().then(() => { released = true; });
  await Promise.resolve();
  expect(released).toBe(false); expect(child.stdin.end).toHaveBeenCalledOnce();
  await expect(client.request('thread/resume', { threadId: 'previous-thread' })).rejects.toThrow('连接已关闭');
  child.exitCode = 0; child.emit('exit', 0);
  await closing; await client.close();
  expect(released).toBe(true); expect(mocks.spawn).toHaveBeenCalledOnce();
});

it('does not launch a delayed process after cancellation during executable discovery', async () => {
  processFixture();
  let release!: () => void;
  mocks.access.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
  const client = new CodexClient();
  const request = client.request('thread/start');
  const rejected = expect(request).rejects.toThrow('连接已关闭');
  await client.close(); release(); await rejected;
  expect(mocks.spawn).not.toHaveBeenCalled();
});
