import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ReaderStore } from './store.js';
import { ReaderService } from './service.js';
import { createMcpServer } from './mcp.js';
import { createReaderHttpServer } from './http.js';
const root = fileURLToPath(new URL('../../', import.meta.url));
const dataDir = process.env.READER_DATA_DIR ?? (process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support', 'Reader') : process.platform === 'win32' ? join(process.env.LOCALAPPDATA ?? homedir(), 'Reader') : join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'reader-plugin'));
const service = new ReaderService(new ReaderStore(resolve(dataDir)));
const uiPath = join(root, 'dist', 'ui', 'index.html');
if (process.argv.includes('--http')) {
  const port = Number(process.env.PORT ?? 4173);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid PORT');
  const server = createReaderHttpServer(service, uiPath);
  server.listen(port, '127.0.0.1', () => { const address = server.address(); console.error(`Reader preview: http://127.0.0.1:${address && typeof address !== 'string' ? address.port : port}`); });
  const close = () => server.close(() => process.exit(0));
  process.on('SIGINT', close); process.on('SIGTERM', close);
} else {
  await createMcpServer(service, uiPath).connect(new StdioServerTransport());
}
