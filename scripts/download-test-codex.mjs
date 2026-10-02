// Maintainer/CI only. End users already run a supported host; Reader never downloads it.
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const root = fileURLToPath(new URL('../', import.meta.url)), run = promisify(execFile);
const pinned = JSON.parse(await fs.readFile(join(root, 'distribution/test-codex.json'), 'utf8'));
const target = `${process.platform}-${process.arch}`, entry = pinned.targets[target];
if (!entry) throw new Error(`No official test host for ${target}`);
const dir = join(root, 'artifacts/test-codex'); await fs.mkdir(dir, { recursive: true });
const archive = join(dir, 'official.tar.gz');
try { await fs.access(archive); } catch {
  const response = await fetch(entry.url, { signal: AbortSignal.timeout(240000) });
  if (!response.ok) throw new Error(`Official Codex download: ${response.status}`);
  await fs.writeFile(archive, Buffer.from(await response.arrayBuffer()), { flag: 'wx' });
}
if (createHash('sha256').update(await fs.readFile(archive)).digest('hex') !== entry.sha256) throw new Error('Official Codex archive checksum mismatch');
// Git Bash's GNU tar interprets a Windows drive colon as a remote host.
// Windows ships bsdtar, which accepts native drive/Unicode paths directly.
const tar = process.platform === 'win32' ? join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar';
// Windows bsdtar's argv decoding also depends on the machine code page.
// Set the Unicode cwd through Node's native API and pass only ASCII filenames.
await run(tar, ['-xzf', 'official.tar.gz'], { cwd: dir, timeout: 120000 });
const candidates = [];
async function visit(path) {
  for (const item of await fs.readdir(path, { withFileTypes: true })) {
    const name = join(path, item.name);
    if (item.isDirectory()) await visit(name);
    else if (item.name === (process.platform === 'win32' ? 'codex.exe' : 'codex')) {
      const file = await fs.open(name); const bytes = Buffer.alloc(4); await file.read(bytes, 0, 4, 0); await file.close();
      if (bytes.toString('utf8', 0, 2) !== '#!') candidates.push(name);
    }
  }
}
await visit(dir);
if (candidates.length !== 1) throw new Error(`Expected exactly one official native Codex, found ${candidates.length}`);
const cli = candidates[0];
if (process.platform !== 'win32') await fs.chmod(cli, 0o755);
const version = (await run(cli, ['--version'])).stdout.trim();
if (!version.endsWith(` ${pinned.version}`)) throw new Error(`Unexpected test host version: ${version}`);
await fs.writeFile(join(dir, 'verification.json'), JSON.stringify({ target, version, archive: entry, executable: cli }, null, 2));
if (process.env.GITHUB_ENV) await fs.appendFile(process.env.GITHUB_ENV, `READER_TEST_CODEX=${cli}\n`);
console.log(JSON.stringify({ version, cli }));
