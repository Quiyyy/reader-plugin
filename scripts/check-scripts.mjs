import { readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
for (const scripts of [new URL('./', import.meta.url), new URL('../distribution/', import.meta.url)]) {
  for (const name of (await readdir(scripts)).filter(name => name.endsWith('.mjs'))) {
    execFileSync(process.execPath, ['--check', fileURLToPath(new URL(name, scripts))], { stdio: 'inherit' });
  }
}
console.log('Node script syntax checks passed; TypeScript is checked by npm run typecheck.');
