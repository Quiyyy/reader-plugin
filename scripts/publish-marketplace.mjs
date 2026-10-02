// CI-only publication into this Reader repository. No tags, releases, user
// configuration, credentials or other repositories are changed.
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { httpAuthorizationEnvironment } from '../distribution/git-http.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({ options: { stable: { type: 'boolean', default: false } } });
const source = process.env.GITHUB_SHA, token = process.env.GITHUB_TOKEN;
if (process.env.GITHUB_REPOSITORY !== 'Quiyyy/reader-plugin' || !/^[a-f0-9]{40}$/.test(source ?? '') || !token || process.env.GITHUB_EVENT_NAME !== 'push') throw new Error('Only this Reader repository push CI can publish distribution refs.');
if (values.stable && process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('Stable distribution requires the final main CI gates.');
const work = await fs.mkdtemp(join(root, 'artifacts/publish-'));
const repository = join(work, 'objects.git');
const env = { ...process.env, ...httpAuthorizationEnvironment('https://github.com/', `basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`),
  GIT_AUTHOR_NAME: 'Reader distribution CI', GIT_AUTHOR_EMAIL: '41898282+github-actions[bot]@users.noreply.github.com',
  GIT_COMMITTER_NAME: 'Reader distribution CI', GIT_COMMITTER_EMAIL: '41898282+github-actions[bot]@users.noreply.github.com', GIT_TERMINAL_PROMPT: '0' };
delete env.GITHUB_TOKEN;
async function git(args, extra = {}, cwd = root) {
  return await new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, env: { ...env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] }); let out = '', error = '';
    child.stdout.on('data', bytes => { out += bytes; }); child.stderr.on('data', bytes => { error += bytes; });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve(out.trim()) : reject(new Error(`Git distribution operation failed (${code}): ${error.replaceAll(token, '[redacted]')}`)));
  });
}
await git(['init', '--bare', repository]);
const remote = 'https://github.com/Quiyyy/reader-plugin.git', commands = [], published = {};
async function publish(directory, branch) {
  if (!/^reader-(preview|dist)\/[a-zA-Z0-9/._-]+$/.test(branch)) throw new Error('Unexpected distribution branch');
  const ref = `refs/heads/${branch}`;
  const existing = (await git([`--git-dir=${repository}`, 'ls-remote', remote, ref])).split(/\s/)[0] || null;
  if (existing) await git([`--git-dir=${repository}`, 'fetch', '--depth=1', remote, ref]);
  const local = { GIT_DIR: repository, GIT_WORK_TREE: directory, GIT_INDEX_FILE: join(work, `index-${commands.length}`) };
  await git(['add', '--all'], local, directory);
  const tree = await git(['write-tree'], local);
  let commit = existing;
  if (!existing || tree !== await git([`--git-dir=${repository}`, 'rev-parse', `${existing}^{tree}`])) {
    if (existing && !values.stable) throw new Error(`Immutable preview changed: ${branch}`);
    commit = await git([`--git-dir=${repository}`, 'commit-tree', tree, ...(existing ? ['-p', existing] : []), '-m', `Reader ${values.stable ? 'distribution' : 'verification'} from ${source}`]);
    commands.push(`${commit}:${ref}`);
  }
  return commit;
}
const pinned = JSON.parse(await fs.readFile(join(root, 'distribution/node-runtime.json'), 'utf8'));
const prefix = values.stable ? 'reader-dist' : `reader-preview/${source}`;
const catalogs = {};
for (const kind of values.stable ? ['current'] : ['current', 'fixture']) {
  const plugins = [];
  for (const target of Object.keys(pinned.targets)) {
    const directory = join(root, 'artifacts/marketplace', `${target}${kind === 'fixture' ? '-fixture' : ''}`);
    const manifest = JSON.parse(await fs.readFile(join(directory, 'runtime-manifest.json'), 'utf8'));
    if (manifest.source.dirty || manifest.target !== target || (kind === 'current' && (manifest.source.commit !== source || manifest.testFixture))) throw new Error('Unverified distribution source');
    if (kind === 'fixture' && (!manifest.testFixture || manifest.source.commit !== '81a87e9d7bb38db31cc1f755021af5b809e79169')) throw new Error('Unexpected historical fixture');
    const branch = `${prefix}/${kind === 'current' && values.stable ? '' : kind + '/'}${target}`;
    const sha = await publish(directory, branch); published[`${kind}/${target}`] = { branch, sha, version: manifest.version };
    plugins.push({ name: `reader-${target}`, source: { source: 'url', url: remote, sha }, policy: { installation: values.stable && target.startsWith('darwin') ? 'NOT_AVAILABLE' : 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' });
  }
  const directory = join(work, `catalog-${kind}`); await fs.mkdir(join(directory, '.agents/plugins'), { recursive: true });
  await fs.writeFile(join(directory, '.agents/plugins/marketplace.json'), JSON.stringify({ name: 'reader-marketplace', interface: { displayName: 'Reader · choose your platform · preview' }, plugins }, null, 2));
  const branch = `${prefix}/${kind === 'current' && values.stable ? '' : kind + '/'}catalog`;
  catalogs[kind] = { branch, sha: await publish(directory, branch), source: `Quiyyy/reader-plugin@${branch}` };
}
if (commands.length) await git([`--git-dir=${repository}`, 'push', '--atomic', remote, ...commands]);
const result = { source, mode: values.stable ? 'stable-refs-preview-quality' : 'candidate', published, catalogs };
await fs.writeFile(join(root, 'artifacts', values.stable ? 'stable-publication.json' : 'publication.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await fs.rm(work, { recursive: true, force: true });
