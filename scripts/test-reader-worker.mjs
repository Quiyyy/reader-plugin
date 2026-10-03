// Only the Playwright test parent starts this worker. No production switches.
import { ReaderStore } from '../dist/server/store.js';
import { ReaderService } from '../dist/server/service.js';
import { OnlineSourceService } from '../dist/server/online/service.js';
import { createReaderHttpServer } from '../dist/server/http.js';
import { fixtureServer } from '../dist/test-host/online-fixture.mjs';
if (!process.send || !process.env.READER_DATA_DIR) throw new Error('Test parent required');
const fixture = process.env.READER_TEST_PUBLIC_SOURCES === '1' ? null : await fixtureServer();
const store = new ReaderStore(process.env.READER_DATA_DIR);
const service = new ReaderService(store, new OnlineSourceService(store, fixture?.client));
const server = createReaderHttpServer(service, new URL('../dist/ui/index.html', import.meta.url));
server.listen(4178, '127.0.0.1', () => process.send({ ready: true }));
process.on('message', async message => {
  if (message.type === 'stop') { await fixture?.close(); server.closeAllConnections(); server.close(() => process.exit(0)); return; }
  if (message.type === 'offline') fixture?.setOffline(message.value);
  process.send({ id: message.id, data: message.type === 'requests' ? { requests: fixture?.requests ?? [] } : { offline: message.value, fixture: !!fixture } });
});
