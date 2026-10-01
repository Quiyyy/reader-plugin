import { build } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
await build({ configFile: false, root: 'tests/host', plugins: [viteSingleFile()], build: { outDir: '../../dist/test-host', emptyOutDir: true, target: 'es2022' } });
