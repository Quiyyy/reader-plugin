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
const { ReaderStore } = await import('../dist/server/store.js');
const { ReaderService } = await import('../dist/server/service.js');
const { OnlineSourceService } = await import('../dist/server/online/service.js');
const { createReaderHttpServer } = await import('../dist/server/http.js');
const { fixtureServer } = await import('../dist/test-host/online-fixture.mjs');
const fixture = await fixtureServer();
const store = new ReaderStore(dataDir);
const service = new ReaderService(store, new OnlineSourceService(store, fixture.client));
const server = createReaderHttpServer(service, new URL('../dist/ui/index.html', import.meta.url));
server.listen(4178, '127.0.0.1');
const close = () => { void fixture.close().finally(() => server.close(() => process.exit(0))); };
process.on('SIGINT', close); process.on('SIGTERM', close);
