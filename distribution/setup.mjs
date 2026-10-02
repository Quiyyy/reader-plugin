import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { setup } from './installer.mjs';

try {
  const { values } = parseArgs({ options: {
    'install-dir': { type: 'string' }, 'data-dir': { type: 'string' },
    rollback: { type: 'string' }, 'recover-lock': { type: 'boolean', default: false },
  } });
  console.log(JSON.stringify(await setup({ packageRoot: fileURLToPath(new URL('./', import.meta.url)),
    installDir: values['install-dir'], dataDir: values['data-dir'], rollback: values.rollback,
    recoverLock: values['recover-lock'] }), null, 2));
} catch (error) {
  console.error(`Reader setup: ${error.message}`);
  process.exitCode = 1;
}
