// Prints an explicit configuration for clients without PLUGIN_ROOT expansion.
// Never installs or changes the user's host settings.
import { fileURLToPath } from 'node:url';
const entry = fileURLToPath(new URL('../dist/server/index.js', import.meta.url));
console.log(JSON.stringify({ mcpServers: { reader: { command: process.execPath, args: [entry] } } }, null, 2));
