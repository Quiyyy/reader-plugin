import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export function localConfig(dataDir) {
  if (dataDir !== undefined && (!dataDir || !isAbsolute(dataDir))) throw new Error('--data-dir must be an absolute path');
  return { mcpServers: { reader: {
    command: process.execPath,
    args: [join(root, 'dist', 'server', 'index.js')],
    ...(dataDir === undefined ? {} : { env: { READER_DATA_DIR: dataDir } }),
  } } };
}
