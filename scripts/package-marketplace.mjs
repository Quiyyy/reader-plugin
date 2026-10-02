// Maintainer-only build. Users install the resulting Git marketplace package.
import * as fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { gzipSync } from 'node:zlib';
import { builtinModules } from 'node:module';
import { build } from 'esbuild';
import { unzipSync } from 'fflate';
import { filesUnder } from '../distribution/installer.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const run = promisify(execFile), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const readJson = async path => JSON.parse(await fs.readFile(path, 'utf8'));
const { values } = parseArgs({ options: { target: { type: 'string' }, archive: { type: 'string' }, source: { type: 'string' }, fixture: { type: 'boolean', default: false } } });
const pinned = await readJson(join(root, 'distribution/node-runtime.json'));
const target = pinned.targets[values.target];
if (!target) throw new Error(`Choose an explicit supported target: ${Object.keys(pinned.targets).join(', ')}`);
const source = resolve(values.source ?? root);
if (source !== resolve(root) && !values.fixture) throw new Error('Alternate source requires an explicit historical fixture build.');
const pkg = await readJson(join(source, 'package.json'));
const commit = (await run('git', ['rev-parse', 'HEAD'], { cwd: source })).stdout.trim();
const dirty = !!(await run('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: source })).stdout.trim();
if (values.fixture && (pkg.version !== '0.1.3' || commit !== '81a87e9d7bb38db31cc1f755021af5b809e79169')) throw new Error('The fixture must use the exact final 0.1.3 source.');
if (process.env.CI && dirty) throw new Error('CI refuses a dirty package source.');
const artifacts = join(root, 'artifacts'); await fs.mkdir(artifacts, { recursive: true });
const stage = await fs.mkdtemp(join(artifacts, 'marketplace-stage-'));
const output = join(root, 'artifacts/marketplace', `${values.target}${values.fixture ? '-fixture' : ''}`);
const app = join(stage, 'app'); await fs.mkdir(join(app, 'dist/server'), { recursive: true });
await fs.mkdir(join(app, 'dist/ui'), { recursive: true });
const bundled = await build({ entryPoints: [join(source, 'src/server/index.ts')], bundle: true, platform: 'node', format: 'esm', target: 'node24',
  outfile: join(app, 'dist/server/index.js'), metafile: true,
  banner: { js: "import { createRequire as __readerCreateRequire } from 'node:module'; const require = __readerCreateRequire(import.meta.url);" },
  plugins: [{ name: 'upstream-text-only-canvas-fallback', setup(builder) {
    // Reader is text-only and never depended on native canvas. Bundle linkedom's
    // existing fallback instead of resolving an optional module outside the plugin.
    builder.onResolve({ filter: /^canvas$/ }, () => ({ path: join(source, 'node_modules/linkedom/commonjs/canvas-shim.cjs') }));
  } }],
});
const builtins = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));
for (const item of Object.values(bundled.metafile.outputs).flatMap(item => item.imports)) {
  if (item.external && !builtins.has(item.path)) throw new Error(`Runtime has an unpackaged dependency: ${item.path}`);
}
await fs.copyFile(join(source, 'dist/ui/index.html'), join(app, 'dist/ui/index.html'));
await fs.writeFile(join(app, 'package.json'), json({ type: 'module', version: pkg.version }));

const archiveURL = `https://nodejs.org/download/release/v${pinned.version}/${target.archive}`;
const downloads = join(root, 'artifacts/runtime-downloads'); await fs.mkdir(downloads, { recursive: true });
const archive = values.archive ? resolve(values.archive) : join(downloads, target.archive);
try { await fs.access(archive); } catch {
  if (values.archive) throw new Error('Explicit Node archive is missing.');
  const response = await fetch(archiveURL, { signal: AbortSignal.timeout(240000) });
  if (!response.ok) throw new Error(`Official Node download failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (hash(bytes) !== target.sha256) throw new Error('Official Node archive checksum mismatch.');
  await fs.writeFile(archive, bytes, { flag: 'wx' });
}
const archiveBytes = await fs.readFile(archive);
if (hash(archiveBytes) !== target.sha256) throw new Error('Node archive checksum differs from the pinned official release.');
const archiveRoot = target.archive.replace(/\.(?:tar\.gz|zip)$/, '');
const nodeMember = `${archiveRoot}/${target.goos === 'windows' ? 'node.exe' : 'bin/node'}`;
let node, nodeLicense;
if (target.archive.endsWith('.zip')) {
  const parts = unzipSync(archiveBytes, { filter: file => [nodeMember, `${archiveRoot}/LICENSE`].includes(file.name) });
  node = parts[nodeMember]; nodeLicense = parts[`${archiveRoot}/LICENSE`];
} else {
  const extracted = await fs.mkdtemp(join(artifacts, 'node-extract-'));
  await run('tar', ['-xzf', archive, '-C', extracted, nodeMember, `${archiveRoot}/LICENSE`], { timeout: 120000 });
  node = await fs.readFile(join(extracted, nodeMember)); nodeLicense = await fs.readFile(join(extracted, archiveRoot, 'LICENSE'));
  await fs.rm(extracted, { recursive: true });
}
if (!node?.length || !nodeLicense?.length) throw new Error('Official Node archive omitted the executable or license.');
const compressed = gzipSync(node, { level: 9 });
await fs.mkdir(join(stage, 'payload')); await fs.writeFile(join(stage, 'payload/node.gz'), compressed);
await fs.mkdir(join(stage, 'licenses')); await fs.writeFile(join(stage, 'licenses/NODE-LICENSE'), nodeLicense);

const go = process.env.READER_GO || 'go';
const goVersion = (await run(go, ['version'])).stdout.trim();
if (!goVersion.includes('go1.27.1 ')) throw new Error('Use the pinned official Go 1.27.1 build toolchain.');
const goRoot = (await run(go, ['env', 'GOROOT'])).stdout.trim();
await fs.copyFile(join(goRoot, 'LICENSE'), join(stage, 'licenses/GO-LICENSE'));
await fs.cp(join(root, 'distribution/licenses'), join(stage, 'licenses/upstream'), { recursive: true });
const supplemental = await readJson(join(root, 'distribution/licenses/sources.json'));
for (const notice of supplemental) if (hash(await fs.readFile(join(stage, 'licenses/upstream', notice.file))) !== notice.sha256) throw new Error('Supplemental license mismatch.');
const lock = await readJson(join(source, 'package-lock.json')), dependencies = [];
for (const [path, entry] of Object.entries(lock.packages)) {
  if (!path || entry.dev) continue;
  const directory = join(source, path), installed = await readJson(join(directory, 'package.json'));
  if (installed.version !== entry.version) throw new Error(`Dependency differs from lock: ${path}`);
  const files = (await fs.readdir(directory, { withFileTypes: true })).filter(item => item.isFile() && /^(licen[cs]e|copying|notice)([.-]|$)/i.test(item.name));
  const extra = supplemental.filter(item => item.packages.includes(`${installed.name}@${installed.version}`));
  if (!files.length && !extra.length) throw new Error(`Missing license for ${installed.name}@${installed.version}`);
  const notices = [];
  for (let i = 0; i < files.length; i++) {
    const name = `dependency-${dependencies.length}-${i}.txt`;
    await fs.copyFile(join(directory, files[i].name), join(stage, 'licenses', name)); notices.push(`licenses/${name}`);
  }
  dependencies.push({ name: installed.name, version: installed.version, license: installed.license ?? entry.license, notices,
    supplemental: extra.map(item => ({ path: `licenses/upstream/${item.file}`, source: item.source, sha256: item.sha256, note: item.note })) });
}
await fs.writeFile(join(stage, 'DEPENDENCIES.json'), json(dependencies));
await fs.writeFile(join(stage, 'THIRD_PARTY_NOTICES.md'), '# Reader bundled runtime notices\n\nNode.js and the Go runtime retain their upstream licenses in licenses/. JavaScript dependency licenses and pinned supplemental notices are listed in DEPENDENCIES.json. Reader uses text-only EPUB rendering; native canvas is not included. The upstream Node executable is compressed without modification; startup verifies and restores its exact bytes. This package does not claim Apple notarization or Windows publisher signing.\n');
const id = `reader-${values.target}`;
const executable = target.goos === 'windows' ? 'reader-launcher.exe' : 'reader-launcher';
await fs.writeFile(join(stage, 'plugin.json'), json({ $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: id, version: pkg.version,
  description: `Local TXT and DRM-free EPUB reader; bundled runtime for ${target.label}.`, author: { name: 'Quiyyy' }, repository: 'https://github.com/Quiyyy/reader-plugin',
  extensions: { 'com.openai': { interface: { displayName: `Reader · ${target.label}`, shortDescription: '本地阅读，无需安装 Node 或 npm。', longDescription: 'Choose only the package matching this device. Book storage is separate from the plugin cache. System trust prompts may apply.', developerName: 'Quiyyy', category: 'Productivity', capabilities: ['Interactive', 'Write'], defaultPrompt: ['打开 Reader 书架'] } } } }));
await fs.writeFile(join(stage, 'mcp.json'), json({ $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json', mcpServers: { reader: { type: 'stdio', command: `./${executable}`, args: [], env: { NODE_OPTIONS: '', NODE_PATH: '' } } } }));
const files = {};
for (const name of ['app/package.json', 'app/dist/server/index.js', 'app/dist/ui/index.html', 'payload/node.gz']) files[name] = hash(await fs.readFile(join(stage, name)));
const manifest = { kind: 'reader-bundled-runtime', version: pkg.version, goos: target.goos, goarch: target.goarch, nodeVersion: pinned.version,
  nodeSha256: hash(node), nodeBytes: node.length, compressedSha256: hash(compressed), files,
  source: { commit, dirty }, testFixture: values.fixture, target: values.target, nodeArchive: { url: archiveURL, sha256: target.sha256 }, goVersion,
  dependencyLockSha256: hash(await fs.readFile(join(source, 'package-lock.json'))) };
const manifestBytes = json(manifest); await fs.writeFile(join(stage, 'runtime-manifest.json'), manifestBytes);
await fs.mkdir(join(root, 'artifacts/go-cache'), { recursive: true });
await run(go, ['build', '-trimpath', '-buildvcs=false', '-ldflags', `-s -w -buildid= -X main.manifestSHA=${hash(manifestBytes)}`, '-o', join(stage, executable), '.'], {
  cwd: join(root, 'distribution/launcher'), env: { ...process.env, GOOS: target.goos, GOARCH: target.goarch, CGO_ENABLED: '0', GOTOOLCHAIN: 'local', GOPROXY: 'off', GOSUMDB: 'off', GOCACHE: join(root, 'artifacts/go-cache') }, timeout: 180000,
});
await fs.chmod(join(stage, executable), 0o755);
const inventory = {};
for (const name of await filesUnder(stage)) inventory[name] = hash(await fs.readFile(join(stage, name)));
await fs.writeFile(join(stage, 'PACKAGE-SHA256.json'), json(inventory));
await fs.mkdir(dirname(output), { recursive: true });
await fs.rm(output, { recursive: true, force: true }); await fs.rename(stage, output);
const packageBytes = (await Promise.all((await filesUnder(output)).map(async name => (await fs.stat(join(output, name))).size))).reduce((a,b)=>a+b,0);
console.log(json({ output, plugin: id, version: pkg.version, target: values.target, packageBytes, nodeBytes: node.length, compressedNodeBytes: compressed.length, source: manifest.source, testFixture: values.fixture }));
