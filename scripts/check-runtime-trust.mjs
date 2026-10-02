// Report trust evidence without changing signatures, quarantine, security policy,
// or treating functional execution as OS publisher verification.
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const root = fileURLToPath(new URL('../', import.meta.url)), run = promisify(execFile), target = `${process.platform}-${process.arch}`;
const pkg = join(root, 'artifacts/marketplace', target), manifest = JSON.parse(await fs.readFile(join(pkg, 'runtime-manifest.json'), 'utf8'));
const directory = join(root, 'artifacts/trust-evidence'); await fs.mkdir(directory, { recursive: true });
const node = join(directory, process.platform === 'win32' ? 'upstream-node.exe' : 'upstream-node');
await fs.writeFile(node, gunzipSync(await fs.readFile(join(pkg, 'payload/node.gz'))), { mode: 0o700 });
const launcher = join(pkg, process.platform === 'win32' ? 'reader-launcher.exe' : 'reader-launcher');
const checks = [];
async function check(file, command, args) {
  try { const result = await run(command, args, { timeout: 60000 }); checks.push({ file, command, args, exitCode: 0, ...result }); }
  catch (error) { checks.push({ file, command, args, exitCode: error.code, stdout: error.stdout, stderr: error.stderr }); }
}
try {
  for (const file of [node, launcher]) {
    if (process.platform === 'darwin') {
      await check(file, '/usr/bin/codesign', ['--verify', '--strict', '--verbose=4', file]);
      await check(file, '/usr/bin/codesign', ['--display', '--verbose=4', file]);
    } else if (process.platform === 'win32') {
      await check(file, 'powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Get-AuthenticodeSignature -LiteralPath '${file.replaceAll("'", "''")}' | Select-Object Status,StatusMessage,@{Name='Signer';Expression={$_.SignerCertificate.Subject}} | ConvertTo-Json`]);
    }
  }
  await fs.writeFile(join(directory, `${target}.json`), JSON.stringify({ target, source: manifest.source, officialChecksumsURL: 'https://nodejs.org/download/release/v24.21.0/SHASUMS256.txt', nodeArchive: manifest.nodeArchive, nodeSha256: manifest.nodeSha256, checks,
    limitation: 'The Reader launcher has no Developer ID, notarization or Authenticode publisher signing. macOS distribution remains unavailable in the normal catalog pending trust validation. CLI/process tests do not establish GUI trust or native UI compatibility.' }, null, 2));
} finally { await fs.rm(node); }
