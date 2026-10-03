// Development only. Production executes compiled script-worker.js directly.
import { workerData } from 'node:worker_threads';
import { tsImport } from 'tsx/esm/api';
await tsImport(workerData, import.meta.url);
