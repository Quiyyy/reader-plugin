// Development only. Production executes compiled script-worker.js directly.
import { workerData } from 'node:worker_threads';
// The worker intentionally has an empty inherited environment. On Windows,
// os.tmpdir() then becomes relative (undefined\\temp). Disable the trusted TS
// loader's disk cache before importing it; production never loads tsx at all.
process.env.TSX_DISABLE_CACHE = '1';
const { tsImport } = await import('tsx/esm/api');
// Worker sources use no path aliases or filesystem-case probing.
await tsImport(workerData, { parentURL: import.meta.url, tsconfig: false });
