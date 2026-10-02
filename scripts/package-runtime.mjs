// Maintainer build only. End users run the included setup.mjs; no npm is needed there.
import * as fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { zipSync } from 'fflate';
import { filesUnder, verifyPackage } from '../distribution/installer.mjs';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({ options: { source: { type: 'string' }, fixture: { type: 'boolean', default: false } } });
const source = resolve(values.source ?? root);
if (source !== resolve(root) && !values.fixture) throw new Error('An alternate source is allowed only for the explicit historical test fixture.');
const pkg = JSON.parse(await fs.readFile(join(source, 'package.json'), 'utf8'));
const lock = JSON.parse(await fs.readFile(join(source, 'package-lock.json'), 'utf8'));
if (!process.env.npm_execpath) throw new Error('Maintainers must run this through npm run package:runtime.');
if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error('Invalid package version');
if (values.fixture && pkg.version !== '0.1.2') throw new Error('Only the recorded 0.1.2 legacy fixture is supported.');
for (const [name, data] of Object.entries(lock.packages)) {
  if (name && !data.dev && (data.os || data.cpu || data.hasInstallScript)) throw new Error(`Production dependency needs platform/build review: ${name}`);
}
const destination = join(root, 'artifacts', 'releases');
await fs.mkdir(destination, { recursive: true });
const stage = await fs.mkdtemp(join(root, 'artifacts', 'runtime-build-'));
const runtime = join(stage, 'runtime');
await fs.mkdir(runtime);
await fs.copyFile(join(source, 'package.json'), join(runtime, 'package.json'));
await fs.copyFile(join(source, 'package-lock.json'), join(runtime, 'package-lock.json'));
// Use Node + npm's JS entry, avoiding npm.cmd shell quoting and lifecycle hooks.
const install = await run(process.execPath, [process.env.npm_execpath, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', runtime], { maxBuffer: 8 * 1024 * 1024 });
process.stdout.write(install.stdout);
// .bin contains platform-specific command wrappers/symlinks, unused by the Node entrypoint.
await fs.rm(join(runtime, 'node_modules', '.bin'), { recursive: true, force: true });
await fs.rm(join(runtime, 'node_modules', '.package-lock.json'), { force: true });
await fs.rm(join(runtime, 'package-lock.json'));
await fs.writeFile(join(runtime, 'package.json'), JSON.stringify({ name: pkg.name, version: pkg.version, private: true, type: 'module', engines: pkg.engines, scripts: { start: 'node dist/server/index.js' } }, null, 2) + '\n');
for (const subtree of ['server', 'shared']) {
  const built = join(source, 'dist', subtree);
  for (const name of await filesUnder(built)) {
    if (!name.endsWith('.js')) continue;
    const target = join(runtime, 'dist', subtree, name);
    await fs.mkdir(dirname(target), { recursive: true }); await fs.copyFile(join(built, name), target);
  }
}
await fs.mkdir(join(runtime, 'dist', 'ui'), { recursive: true });
await fs.copyFile(join(source, 'dist', 'ui', 'index.html'), join(runtime, 'dist', 'ui', 'index.html'));
for (const name of ['setup.mjs', 'installer.mjs']) await fs.copyFile(join(root, 'distribution', name), join(stage, name));
await fs.copyFile(join(source, '.codex-plugin', 'plugin.json'), join(stage, 'plugin.json'));
await fs.copyFile(join(root, 'docs', 'INSTALL.md'), join(stage, 'INSTALL.md'));
await fs.cp(join(root, 'distribution', 'licenses'), join(stage, 'licenses'), { recursive: true });
const supplemental = JSON.parse(await fs.readFile(join(stage, 'licenses', 'sources.json'), 'utf8'));
for (const item of supplemental) {
  const bytes = await fs.readFile(join(stage, 'licenses', item.file));
  if (createHash('sha256').update(bytes).digest('hex') !== item.sha256) throw new Error(`Supplemental license checksum mismatch: ${item.file}`);
}

const production = [];
for (const [name, data] of Object.entries(lock.packages)) {
  if (!name || data.dev) continue;
  const directory = join(runtime, name);
  let installed;
  try { installed = JSON.parse(await fs.readFile(join(directory, 'package.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' && data.optional) continue; throw error; }
  if (installed.version !== data.version) throw new Error(`Production dependency version mismatch: ${name}`);
  const licenses = (await fs.readdir(directory)).filter(file => /^(licen[cs]e|copying|notice)([.-]|$)/i.test(file));
  const extra = supplemental.filter(item => item.packages.includes(`${installed.name}@${installed.version}`));
  if (!licenses.length && !extra.length) throw new Error(`Missing license text; review upstream before distributing: ${installed.name}@${installed.version}`);
  production.push({ name: installed.name, version: installed.version, license: installed.license ?? installed.licenses ?? data.license ?? 'See package notices', path: `runtime/${name}`, notices: licenses, supplementalNotices: extra.map(item => `licenses/${item.file}`), ...(extra.some(item => item.note) ? { licenseNote: extra.filter(item => item.note).map(item => item.note).join(' ') } : {}) });
}
await fs.writeFile(join(stage, 'DEPENDENCIES.json'), JSON.stringify(production, null, 2) + '\n');
await fs.writeFile(join(stage, 'THIRD_PARTY_NOTICES.md'), '# Reader runtime — third-party notices\n\nReader project: https://github.com/Quiyyy/reader-plugin\n\nThe UI is prebuilt. Complete production packages, including their upstream license/notice files and package metadata, are included under runtime/node_modules. Where npm omitted a separate license file, pinned upstream copies and provenance are in licenses/. No new license is granted for third-party material by this notice. The versioned inventory is in DEPENDENCIES.json.\n\n' + production.map(item => `- ${item.name}@${item.version} — ${typeof item.license === 'string' ? item.license : JSON.stringify(item.license)}; ${item.path}; ${[...item.notices, ...item.supplementalNotices].join(', ')}${item.licenseNote ? `; ${item.licenseNote}` : ''}`).join('\n') + '\n');
const commit = (await run('git', ['rev-parse', 'HEAD'], { cwd: source })).stdout.trim();
const dirty = !!(await run('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: source })).stdout.trim();
if (values.fixture && commit !== 'f398d0ddffc158e6f5282e77abac9cb11f1bb37a') throw new Error('Legacy fixture must use the exact published 0.1.2 commit.');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const names = await filesUnder(stage);
const inventory = {};
for (const name of names) inventory[name] = sha256(await fs.readFile(join(stage, name)));
const manifest = { kind: 'reader-runtime-package', schemaVersion: 1, version: pkg.version, source: { commit, dirty }, testFixture: values.fixture,
  runtime: 'Complete production dependencies, compiled ESM server and inline UI; system Node required.', files: inventory };
await fs.writeFile(join(stage, 'package-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
await verifyPackage(stage);
const prefix = `reader-${pkg.version}-${values.fixture ? 'test-fixture' : 'runtime'}`;
const entries = {};
for (const name of await filesUnder(stage)) entries[`${prefix}/${name}`] = [new Uint8Array(await fs.readFile(join(stage, name))), { mtime: new Date('2026-01-01T00:00:00Z') }];
const bytes = zipSync(entries, { level: 6 });
const archive = join(destination, `${prefix}.zip`);
await fs.writeFile(archive, bytes);
await fs.writeFile(`${archive}.sha256`, `${sha256(bytes)}  ${prefix}.zip\n`);
await fs.writeFile(join(destination, `${prefix}.build.json`), JSON.stringify({ archive, bytes: bytes.length, sha256: sha256(bytes), source: manifest.source, fileCount: names.length + 1, productionPackages: production.length, stage }, null, 2) + '\n');
console.log(JSON.stringify({ archive, bytes: bytes.length, sha256: sha256(bytes), files: names.length + 1, productionPackages: production.length, testFixture: values.fixture }));
