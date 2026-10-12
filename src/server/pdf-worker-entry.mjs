import { workerData } from 'node:worker_threads';
process.env.TSX_DISABLE_CACHE='1';
const {tsImport}=await import('tsx/esm/api');
await tsImport(workerData.entry,{parentURL:import.meta.url,tsconfig:false});
