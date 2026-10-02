// Prints an explicit configuration for clients without PLUGIN_ROOT expansion.
// Never installs or changes the user's host settings.
import { parseArgs } from 'node:util';
import { localConfig } from './local-config.mjs';
const { values } = parseArgs({ options: { 'data-dir': { type: 'string' } } });
console.log(JSON.stringify(localConfig(values['data-dir']), null, 2));
