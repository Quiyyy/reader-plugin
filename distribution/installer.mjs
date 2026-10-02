// Built-in Node modules only: setup itself requires no npm installation.
import * as fs from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';

const kind = 'reader-runtime-installation';
const versionPattern = /^\d+\.\d+\.\d+$/;
const ownerName = '.reader-install.json';
const catalogName = '.agents/plugins/marketplace.json';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const readJson = async path => JSON.parse(await fs.readFile(path, 'utf8'));
const missing = error => error?.code === 'ENOENT';

export function supportedNode(version) {
  const [major, minor] = version.split('.').map(Number);
  return (major === 22 && minor >= 12) || major === 24 || major >= 26;
}
function within(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}
async function canonical(path) {
  if (!path || !isAbsolute(path)) throw new Error('Installation and data directories must be absolute paths.');
  try { return await fs.realpath(path); }
  catch (error) {
    if (!missing(error)) throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(await canonical(parent), relative(parent, path));
  }
}
function defaults() {
  const home = homedir();
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local');
    return { install: join(base, 'ReaderPlugin'), data: join(base, 'Reader') };
  }
  if (process.platform === 'darwin') {
    const base = join(home, 'Library', 'Application Support');
    return { install: join(base, 'ReaderPlugin'), data: join(base, 'Reader') };
  }
  const base = process.env.XDG_DATA_HOME || join(home, '.local', 'share');
  return { install: join(base, 'reader-plugin-install'), data: join(base, 'reader-plugin') };
}
export async function filesUnder(root, prefix = '') {
  const output = [];
  for (const entry of await fs.readdir(join(root, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in the runtime package: ${name}`);
    if (entry.isDirectory()) output.push(...await filesUnder(root, name));
    else if (entry.isFile()) output.push(name);
    else throw new Error(`Unsupported package entry: ${name}`);
  }
  return output.sort();
}
export async function verifyPackage(root) {
  const actual = (await filesUnder(root)).filter(name => name !== 'package-manifest.json');
  const manifestBytes = await fs.readFile(join(root, 'package-manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  if (manifest.kind !== 'reader-runtime-package' || manifest.schemaVersion !== 1 || !versionPattern.test(manifest.version)) throw new Error('Invalid Reader runtime manifest.');
  if (!manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) throw new Error('Missing runtime file inventory.');
  const names = Object.keys(manifest.files).sort();
  for (const name of names) {
    if (!name || name.includes('\\') || isAbsolute(name) || name.split('/').some(part => !part || part === '.' || part === '..') || !/^[a-f0-9]{64}$/.test(manifest.files[name])) throw new Error('Unsafe runtime inventory path or checksum.');
  }
  if (JSON.stringify(actual) !== JSON.stringify(names)) throw new Error('Runtime files differ from the manifest; use a clean extraction.');
  for (const name of names) {
    if (hash(await fs.readFile(join(root, name))) !== manifest.files[name]) throw new Error(`Runtime checksum mismatch: ${name}`);
  }
  for (const required of ['setup.mjs', 'installer.mjs', 'runtime/dist/server/index.js', 'runtime/dist/ui/index.html', 'runtime/package.json', 'plugin.json', 'THIRD_PARTY_NOTICES.md']) {
    if (!manifest.files[required]) throw new Error(`Incomplete runtime: ${required}`);
  }
  const pkg = await readJson(join(root, 'runtime/package.json'));
  const plugin = await readJson(join(root, 'plugin.json'));
  if (pkg.version !== manifest.version || plugin.version !== manifest.version || plugin.name !== 'reader-plugin' || plugin.mcpServers !== './.mcp.json') throw new Error('Runtime/plugin versions or metadata disagree.');
  return { manifest, manifestHash: hash(manifestBytes) };
}
function catalog(version) {
  return { name: 'reader-local', interface: { displayName: 'Reader Local' }, plugins: [{
    name: 'reader-plugin', source: { source: 'local', path: `./versions/${version}/plugin` },
    policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity',
  }] };
}
async function activeVersion(root) {
  let actual;
  try { actual = await readJson(join(root, catalogName)); }
  catch (error) { if (missing(error)) return undefined; throw error; }
  const version = actual.plugins?.[0]?.source?.path?.match(/^\.\/versions\/(\d+\.\d+\.\d+)\/plugin$/)?.[1];
  if (!version || JSON.stringify(actual) !== JSON.stringify(catalog(version))) throw new Error('The existing marketplace was modified or contains unknown entries; it was not overwritten.');
  return version;
}
async function atomicWrite(path, bytes) {
  await fs.mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  const handle = await fs.open(temporary, 'wx');
  try { await handle.writeFile(bytes); await handle.sync(); }
  finally { await handle.close(); }
  // Same-directory replace: the catalog always points to a complete version.
  await fs.rename(temporary, path);
}
async function copyVerified(source, destination, manifest) {
  await fs.mkdir(destination, { recursive: false });
  for (const name of [...Object.keys(manifest.files), 'package-manifest.json']) {
    const target = join(destination, name);
    await fs.mkdir(dirname(target), { recursive: true });
    await fs.copyFile(join(source, name), target, 1); // COPYFILE_EXCL
  }
}
async function verifyInstalled(root, version, owner) {
  if (!versionPattern.test(version)) throw new Error('Invalid rollback version.');
  const directory = join(root, 'versions', version);
  if ((await fs.lstat(directory)).isSymbolicLink()) throw new Error('Installed versions must not be symlinks or junctions.');
  const installedFiles = await filesUnder(directory);
  const info = await readJson(join(directory, 'installation.json'));
  const checked = await verifyPackage(join(directory, 'package'));
  if (info.version !== version || info.manifestHash !== checked.manifestHash || info.dataDir !== owner.dataDir || info.installDir !== root) throw new Error('Installed version metadata is inconsistent; it was not overwritten.');
  for (const name of ['plugin/.mcp.json', 'plugin/.codex-plugin/plugin.json']) {
    if (hash(await fs.readFile(join(directory, name))) !== info.generated[name]) throw new Error('Installed plugin configuration was modified; it was not overwritten.');
  }
  const expected = ['installation.json', 'plugin/.mcp.json', 'plugin/.codex-plugin/plugin.json', ...Object.keys(checked.manifest.files).map(name => `package/${name}`), 'package/package-manifest.json'].sort();
  if (JSON.stringify(installedFiles) !== JSON.stringify(expected)) throw new Error('Installed version contains unknown files; it was not overwritten.');
  await fs.access(info.nodePath);
  return info;
}
async function lock(root, recover) {
  const path = join(root, '.setup-lock');
  if (recover) {
    let old;
    try { old = await readJson(path); }
    catch (error) { if (!missing(error)) throw new Error('The setup lock is unreadable; preserve it for manual recovery.'); }
    if (old) {
      if (!Number.isInteger(old.pid) || old.pid <= 0) throw new Error('The setup lock owner is invalid.');
      let dead = false;
      try { process.kill(old.pid, 0); } catch (error) { dead = error.code === 'ESRCH'; }
      if (!dead) throw new Error('Another setup process may still be running; the lock was preserved.');
      await fs.mkdir(join(root, 'backups'), { recursive: true });
      await fs.rename(path, join(root, 'backups', `stale-lock-${randomUUID()}.json`));
    }
  }
  const token = randomUUID();
  let handle;
  try { handle = await fs.open(path, 'wx'); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Setup is already locked. After an interrupted setup, use --recover-lock; no data was changed.'); throw error; }
  try { await handle.writeFile(json({ pid: process.pid, token })); } finally { await handle.close(); }
  return async () => { if ((await readJson(path)).token === token) await fs.unlink(path); };
}

export async function setup({ packageRoot, installDir, dataDir, rollback, recoverLock = false }) {
  if (!supportedNode(process.versions.node)) throw new Error('Install a compatible Node first: 22.12+ (22.x), 24.x, or 26+. Node 24 LTS is recommended.');
  const input = await verifyPackage(packageRoot);
  const paths = defaults();
  const requestedRoot = installDir ?? paths.install;
  const stat = await fs.lstat(requestedRoot).catch(error => { if (!missing(error)) throw error; return undefined; });
  if (stat?.isSymbolicLink()) throw new Error('The installation directory must not be a symlink or junction.');
  const root = await canonical(requestedRoot);
  for (const name of [ownerName, '.agents', '.agents/plugins', catalogName, 'versions', 'backups', '.setup-lock']) {
    const entry = await fs.lstat(join(root, name)).catch(error => { if (!missing(error)) throw error; return undefined; });
    if (entry?.isSymbolicLink()) throw new Error('Managed installation paths must not be symlinks or junctions.');
  }
  const source = await fs.realpath(packageRoot);
  if (within(source, root) || within(root, source)) throw new Error('Use a stable installation directory separate from the extracted download.');
  let owner;
  if (stat) {
    try { owner = await readJson(join(root, ownerName)); }
    catch { throw new Error('The installation directory already exists without a Reader ownership record; it was not changed. Choose a new directory.'); }
    if (owner.kind !== kind || owner.schemaVersion !== 1 || !isAbsolute(owner.dataDir)) throw new Error('Unknown installation ownership record; no files were changed.');
    if (dataDir && await canonical(dataDir) !== owner.dataDir) throw new Error('This installation already uses a different library. Keep its data directory; no migration was attempted.');
  } else {
    if (rollback) throw new Error('Cannot roll back an installation that does not exist.');
    owner = { kind, schemaVersion: 1, dataDir: await canonical(dataDir ?? paths.data), createdAt: new Date().toISOString() };
  }
  if (within(root, owner.dataDir) || within(owner.dataDir, root)) throw new Error('Keep the library and installation in separate directories.');
  if (within(source, owner.dataDir) || within(owner.dataDir, source)) throw new Error('Keep the library separate from the extracted download.');
  if (!stat) {
    await fs.mkdir(dirname(root), { recursive: true }); await fs.mkdir(root);
    await fs.writeFile(join(root, ownerName), json(owner), { flag: 'wx' });
  }
  const unlock = await lock(root, recoverLock);
  try {
    const previous = await activeVersion(root);
    const previousInfo = previous ? await verifyInstalled(root, previous, owner) : undefined;
    const version = rollback ?? input.manifest.version;
    if (!versionPattern.test(version)) throw new Error('Invalid version.');
    if (!rollback && previous) {
      const oldParts = previous.split('.').map(Number), newParts = version.split('.').map(Number);
      const difference = newParts.map((part, index) => part - oldParts[index]).find(part => part !== 0);
      if (difference < 0) throw new Error('A newer version is active. Use --rollback explicitly to select a retained version.');
    }
    const destination = join(root, 'versions', version);
    const exists = await fs.stat(destination).then(() => true).catch(error => { if (!missing(error)) throw error; return false; });
    if (exists) {
      const installed = version === previous ? previousInfo : await verifyInstalled(root, version, owner);
      if (!rollback && (installed.manifestHash !== input.manifestHash || installed.nodePath !== process.execPath)) throw new Error('The same version has different package bytes or a different Node path. Keep it intact and choose a new installation directory.');
    } else {
      if (rollback) throw new Error('The requested rollback version is not retained in this installation.');
      await fs.mkdir(join(root, 'versions'), { recursive: true });
      const stage = join(root, 'versions', `.staging-${randomUUID()}`);
      await fs.mkdir(stage);
      await copyVerified(source, join(stage, 'package'), input.manifest);
      const manifest = await readJson(join(source, 'plugin.json'));
      const configuration = { mcpServers: { reader: { command: process.execPath,
        args: [join(destination, 'package', 'runtime', 'dist', 'server', 'index.js')], env: { READER_DATA_DIR: owner.dataDir } } } };
      const generated = { 'plugin/.mcp.json': json(configuration), 'plugin/.codex-plugin/plugin.json': json(manifest) };
      for (const [name, contents] of Object.entries(generated)) {
        await fs.mkdir(dirname(join(stage, name)), { recursive: true });
        await fs.writeFile(join(stage, name), contents, { flag: 'wx' });
      }
      await fs.writeFile(join(stage, 'installation.json'), json({ schemaVersion: 1, version, manifestHash: input.manifestHash,
        installDir: root, dataDir: owner.dataDir, nodePath: process.execPath,
        generated: Object.fromEntries(Object.entries(generated).map(([name, text]) => [name, hash(text)])) }), { flag: 'wx' });
      await fs.rename(stage, destination);
      await verifyInstalled(root, version, owner);
    }
    let backup;
    if (previous !== version) {
      if (previous) {
        backup = join(root, 'backups', `catalog-${previous}-${randomUUID()}.json`);
        await fs.mkdir(dirname(backup), { recursive: true });
        await fs.copyFile(join(root, catalogName), backup, 1);
      }
      await atomicWrite(join(root, catalogName), json(catalog(version)));
    }
    return { status: previous === version ? 'unchanged' : rollback ? 'rolled-back' : 'installed', version,
      installDir: root, dataDir: owner.dataDir, marketplace: root, plugin: 'reader-plugin@reader-local', previousVersion: previous ?? null,
      backup: backup ?? null, retainedVersions: (await fs.readdir(join(root, 'versions'))).filter(name => versionPattern.test(name)),
      next: 'Register this local marketplace explicitly in Codex, refresh/install Reader, and restart Reader after its reading position is saved. Existing running Reader processes are not stopped.' };
  } finally { await unlock(); }
}
