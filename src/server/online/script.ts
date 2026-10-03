import { Worker } from 'node:worker_threads';
import { SCRIPT_LIMITS, validateScript } from './script-syntax.js';
export interface ScriptGlobals { baseUrl: string; key?: string; page?: number; book?: Record<string, unknown>; chapter?: Record<string, unknown>; source?: Record<string, unknown>; }
let workers = 0;
/** One disposable worker per operation. Never share heaps or source state. */
export class ScriptSession {
  variables: Record<string, string> = Object.create(null);
  private worker?: Worker;
  private dead?: Error;
  private timer?: NodeJS.Timeout;
  private reject?: (error: Error) => void;
  private calls = 0;
  private started = Date.now();
  private budget = SCRIPT_LIMITS.cpuMs * 10;
  constructor(private readonly signal: AbortSignal, private readonly ajax: (input: string) => Promise<string>) {
    signal.addEventListener('abort', this.abort, { once: true });
  }
  private abort = () => this.fail(new Error('规则操作已取消'));
  private fail(error: Error) { this.dead ??= error; this.reject?.(this.dead); this.close(); }
  close() {
    if (this.timer) clearTimeout(this.timer);
    this.signal.removeEventListener('abort', this.abort);
    if (this.worker) { const worker = this.worker; this.worker = undefined; void worker.terminate().finally(() => { workers--; }); }
  }
  async run(code: string, result: unknown, context: unknown, globals: ScriptGlobals): Promise<any> {
    this.signal.throwIfAborted();
    if (this.dead) throw this.dead;
    if (++this.calls > SCRIPT_LIMITS.calls || Date.now() - this.started > SCRIPT_LIMITS.sessionMs || this.budget <= 0) throw new Error('脚本操作总预算超限');
    validateScript(code);
    if (!this.worker) {
      if (workers >= 4) throw new Error('隔离脚本并发已满（最多 4）');
      workers++;
      // Source builds use tsx in a trusted worker entry. Release builds contain
      // compiled JS and need no TS loader or system-wide executable.
      const source = import.meta.url.endsWith('.ts');
      const url = new URL(source ? './script-worker.ts' : './script-worker.js', import.meta.url);
      try { this.worker = new Worker(source ? new URL('./script-worker-entry.mjs', import.meta.url) : url, { workerData: source ? url.href : undefined, env: {}, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 } }); }
      catch (error) { workers--; throw error; }
      this.worker.on('error', error => this.fail(error instanceof Error ? error : new Error(String(error))));
      this.worker.on('exit', code => { if (this.worker) this.fail(new Error(`隔离 Worker 意外退出（${code}）`)); });
      const booting = this.worker;
      // Only trusted module/WASM initialization occurs before ready. Do not
      // send source code or spend its execution budget while a cold engine
      // (or development TS loader) starts on a slower platform.
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => { if (this.timer) clearTimeout(this.timer); booting.off('message', ready); this.reject = undefined; };
        const ready = (message: any) => { if (message.type === 'ready') { cleanup(); resolve(); } };
        this.reject = error => { cleanup(); reject(error); };
        booting.on('message', ready);
        this.timer = setTimeout(() => this.fail(new Error('隔离引擎初始化超时，Worker 已强制终止')), 10000);
      });
    }
    this.signal.throwIfAborted();
    if (this.dead) throw this.dead;
    const worker = this.worker;
    return new Promise((resolve, reject) => {
      let settled = false, elapsed = 0, tick = Date.now();
      const cleanup = () => { if (this.timer) clearTimeout(this.timer); worker.off('message', receive); this.reject = undefined; this.budget -= elapsed + Date.now() - tick; };
      const failure = (error: Error) => { if (settled) return; settled = true; cleanup(); reject(error); };
      this.reject = failure;
      const arm = () => { tick = Date.now(); this.timer = setTimeout(() => this.fail(new Error('隔离脚本超时，Worker 已强制终止')), SCRIPT_LIMITS.commandMs); };
      const receive = (message: any) => {
        if (settled) return;
        if (message.type === 'ajax') {
          if (this.timer) clearTimeout(this.timer); elapsed += Date.now() - tick;
          // Network has its own deadline. A hard overall watchdog remains live.
          this.timer = setTimeout(() => this.fail(new Error('规则网络阶段超时，Worker 已终止')), 12000);
          void this.ajax(message.input).then(text => { if (!settled) { clearTimeout(this.timer); arm(); worker.postMessage({ type: 'network', text }); } }, error => this.fail(error instanceof Error ? error : new Error('规则网络失败')));
        } else if (message.type === 'done') {
          settled = true; cleanup(); this.variables = message.variables; resolve(message.value);
        } else if (message.type === 'error') this.fail(new Error(message.error));
      };
      worker.on('message', receive); arm();
      worker.postMessage({ type: 'run', code, result, context, globals, variables: this.variables });
    });
  }
}
