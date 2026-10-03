// Test-only parent owns a disposable library and a restartable real child.
// Control endpoints are never part of the distributed Reader server.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fork } from 'node:child_process';
import { createServer } from 'node:http';
const dataDir = mkdtempSync(join(tmpdir(), 'Reader 浏览器测试 '));
let child, offline = false;
const pending = new Map(); let sequence = 0;
async function start() {
  child = fork(new URL('./test-reader-worker.mjs', import.meta.url), [], { env: { ...process.env, READER_DATA_DIR: dataDir, PORT: '4178' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
  child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Test worker startup timeout')), 20000);
    child.once('error', reject);
    child.on('message', message => {
      if (message.ready) { clearTimeout(timer); resolve(); }
      else if (pending.has(message.id)) { pending.get(message.id)(message.data); pending.delete(message.id); }
    });
  });
  if (offline) await control('offline', true);
}
function control(type, value) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Test control timeout')); }, 10000);
    pending.set(id, data => { clearTimeout(timer); resolve(data); }); child.send({ id, type, value });
  });
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  await new Promise(resolve => {
    const timer = setTimeout(() => child.kill(), 5000);
    child.once('exit', () => { clearTimeout(timer); resolve(); }); child.send({ type: 'stop' });
  });
}
await start();
const controls = createServer(async (req, res) => {
  try {
    if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
    let result;
    if (req.url === '/restart') { const previous = child.pid; await stop(); await start(); result = { previous, current: child.pid }; }
    else if (req.url === '/offline' || req.url === '/online') { offline = req.url === '/offline'; result = await control('offline', offline); }
    else if (req.url === '/requests') result = await control('requests');
    else { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result));
  } catch (error) { res.statusCode = 500; res.end(error.message); }
});
controls.listen(4179, '127.0.0.1');
const close = () => { controls.close(); void stop().finally(() => process.exit(0)); };
process.on('SIGINT', close); process.on('SIGTERM', close);
process.on('exit', () => { if (child?.exitCode === null) child.kill(); try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* only this disposable directory may remain */ } });
