import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicWrite } from '../src/server/store.js';

const rename = vi.hoisted(() => vi.fn());
vi.mock('node:fs/promises', async importOriginal => ({
  ...await importOriginal<typeof import('node:fs/promises')>(), rename,
}));
const fs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
let directory: string, filename: string;
beforeEach(async () => {
  directory = await fs.mkdtemp(join(tmpdir(), 'reader-atomic-'));
  filename = join(directory, 'workspace.json');
  await fs.writeFile(filename, 'previous complete state');
  rename.mockReset().mockImplementation(fs.rename);
});
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });

it.each(['EPERM', 'EACCES', 'EBUSY'])('survives temporary %s without removing the saved state', async code => {
  const attempts: string[] = [];
  rename.mockImplementation(async (from: string, to: string) => {
    attempts.push(from);
    expect(await fs.readFile(to, 'utf8')).toBe('previous complete state');
    expect(await fs.readFile(from, 'utf8')).toBe('next complete state');
    if (attempts.length < 3) throw Object.assign(new Error('temporarily locked'), { code });
    await fs.rename(from, to);
  });
  await atomicWrite(filename, 'next complete state');
  expect(new Set(attempts).size).toBe(1);
  expect(attempts).toHaveLength(3);
  expect(await fs.readFile(filename, 'utf8')).toBe('next complete state');
  expect(await fs.readdir(directory)).toEqual(['workspace.json']);
});

it('bounds persistent sharing failures, preserves the old state and cleans its temporary file', async () => {
  const error = Object.assign(new Error('still locked'), { code: 'EPERM' });
  rename.mockRejectedValue(error);
  await expect(atomicWrite(filename, 'unsaved state')).rejects.toBe(error);
  expect(rename).toHaveBeenCalledTimes(6);
  expect(await fs.readFile(filename, 'utf8')).toBe('previous complete state');
  expect(await fs.readdir(directory)).toEqual(['workspace.json']);
});

it('reports other filesystem errors immediately without replacing the saved state', async () => {
  const error = Object.assign(new Error('device failure'), { code: 'EIO' });
  rename.mockRejectedValue(error);
  await expect(atomicWrite(filename, 'unsaved state')).rejects.toBe(error);
  expect(rename).toHaveBeenCalledTimes(1);
  expect(await fs.readFile(filename, 'utf8')).toBe('previous complete state');
  expect(await fs.readdir(directory)).toEqual(['workspace.json']);
});
