// Run with the installed package's Node executable and empty PATH. The worker,
// its imports and WASM must all resolve from that package, not this repository.
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
const worker = new Worker(pathToFileURL(process.argv[2]), { env: {}, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 } });
let resolve, reject, variables = {}, requests = 0, budgetMs = 5000;
const timer = setTimeout(() => { reject?.(new Error('Packaged worker timed out')); void worker.terminate(); }, 10000);
worker.on('error', error => reject?.(error));
worker.on('message', message => {
  if (message.type === 'ajax') { requests++; worker.postMessage({ type: 'network', text: 'original' }); }
  if (message.type === 'error') reject?.(new Error(message.error));
  if (message.type === 'done') {
    if (!Number.isFinite(message.executionMs) || message.executionMs < 0 || message.executionMs > budgetMs) { reject?.(new Error('Packaged worker execution accounting invalid')); return; }
    budgetMs -= message.executionMs;
    variables = message.variables; resolve?.(message.value);
  }
});
const evaluate = code => new Promise((ok, fail) => {
  resolve = ok; reject = fail;
  worker.postMessage({ type: 'run', code, result: '', context: '<p>original</p>', globals: { baseUrl: 'https://reader.example.com', key: '中文' }, variables, budgetMs });
});
try {
  assert.equal(await evaluate('java.put("book","original"); java.encodeURI(key,"gbk")'), '%D6%D0%CE%C4');
  assert.deepEqual(await evaluate('[java.get("book"), java.getString("p@text"), java.ajax(baseUrl), typeof process, typeof require, typeof fetch, typeof (function(){}).constructor]'), ['original', 'original', 'original', 'undefined', 'undefined', 'undefined', 'undefined']);
  assert.equal(requests, 1);
  await assert.rejects(evaluate('try { java.startBrowserAwait(baseUrl) } catch(e) {} "bypassed"'), /真实浏览器/);
  console.log(JSON.stringify({ packagedWorker: 'passed', engine: 'QuickJS WASM', gbk: true, scopedVariables: true, ajax: true, ambientAuthority: false }));
} finally { clearTimeout(timer); await worker.terminate(); }
