// Generate a machine-local marketplace wrapper. No Codex settings or accounts are changed.
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { localConfig, root } from './local-config.mjs';

const { values } = parseArgs({ options: { output: { type: 'string' }, 'data-dir': { type: 'string' } } });
const manifest = JSON.parse(await readFile(join(root, '.codex-plugin', 'plugin.json'), 'utf8'));
const config = localConfig(values['data-dir']);
await access(config.mcpServers.reader.args[0]);
await access(join(root, 'dist', 'ui', 'index.html'));
const output = resolve(values.output ?? join(root, '.reader-local', manifest.version));
// Refuse even an existing empty directory; never merge into somebody else's marketplace.
await mkdir(dirname(output), { recursive: true });
await mkdir(output, { recursive: false });
const pluginDir = join(output, 'plugins', 'reader-plugin');
await mkdir(join(pluginDir, '.codex-plugin'), { recursive: true });
await mkdir(join(output, '.agents', 'plugins'), { recursive: true });
const writeJson = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
await writeJson(join(pluginDir, '.codex-plugin', 'plugin.json'), manifest);
await writeJson(join(pluginDir, '.mcp.json'), config);
await writeJson(join(output, '.agents', 'plugins', 'marketplace.json'), {
  name: 'reader-local', interface: { displayName: 'Reader' },
  plugins: [{ name: 'reader-plugin', source: { source: 'local', path: './plugins/reader-plugin' },
    policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }],
});
console.log(JSON.stringify({ marketplace: output, plugin: 'reader-plugin@reader-local', version: manifest.version,
  note: 'Generated only. Keep this checkout and Node executable in place; register the marketplace explicitly in Codex.' }, null, 2));
