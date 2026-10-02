// Playwright owns this process. Never use the user's Reader data directory.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'Reader 浏览器测试 '));
process.env.READER_DATA_DIR = dataDir;
process.env.PORT = '4178';
process.argv.push('--http');
process.on('exit', () => {
  try { rmSync(dataDir, { recursive: true, force: true }); }
  catch { /* A forced Windows termination may leave only this disposable temp directory. */ }
});
await import('../dist/server/index.js');
