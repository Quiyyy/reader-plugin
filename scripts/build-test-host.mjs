import { build } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
await build({ configFile: false, root: 'tests/host', plugins: [viteSingleFile()], build: { outDir: '../../dist/test-host', emptyOutDir: true, target: 'es2022' } });
// Controlled outbound fixture stays in the test artifact, never dist/server.
const { build: bundle } = await import('esbuild');
await bundle({ entryPoints: ['tests/online/fixture.ts'], outfile: 'dist/test-host/online-fixture.mjs', bundle: true, platform: 'node', format: 'esm', packages: 'external' });
