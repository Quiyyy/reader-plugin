import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { externalDirectory, isWithin } from '../../scripts/path-utils.mjs';

test('external book paths distinguish siblings, parent traversal, drive letters and UNC shares', () => {
  for (const [paths, root, child, sibling, outside] of [
    [path.posix, '/tmp/Reader 中文', '/tmp/Reader 中文/books', '/tmp/Reader 中文-old', '/var/books'],
    [path.win32, 'C:\\Reader 中文', 'c:\\reader 中文\\books', 'C:\\Reader 中文-old', 'D:\\books'],
    [path.win32, '\\\\server\\share\\Reader', '\\\\server\\share\\Reader\\books', '\\\\server\\share\\Reader-old', '\\\\server\\other\\books'],
  ]) {
    assert.equal(isWithin(root, root, paths), true);
    assert.equal(isWithin(root, child, paths), true);
    assert.equal(isWithin(root, sibling, paths), false);
    assert.equal(isWithin(root, outside, paths), false);
    assert.equal(isWithin(root, paths.join(root, '..', 'elsewhere'), paths), false);
  }
});

test('realpath rejects an external alias that points back into the checkout', async t => {
  const base = await mkdtemp(path.join(tmpdir(), 'Reader 路径 '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'repo'), inside = path.join(root, 'books'), outside = path.join(base, 'authorized books');
  await mkdir(inside, { recursive: true }); await mkdir(outside);
  const alias = path.join(base, 'alias');
  await symlink(inside, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(externalDirectory(root, alias), /outside the repository/);
  await assert.rejects(externalDirectory(root, root), /outside the repository/);
  assert.equal(await externalDirectory(root, outside), await externalDirectory(root, path.join(outside, '.')));
});
