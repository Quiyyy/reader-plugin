// This trusted worker hosts WASM only. Source code is never evaluated by Node.
import { parentPort } from 'node:worker_threads';
import { newQuickJSAsyncWASMModule, newVariant, RELEASE_ASYNC, DefaultIntrinsics, type QuickJSHandle } from 'quickjs-emscripten';
import iconv from 'iconv-lite';
import { compileRule, documentContext, extract, select } from './rules.js';
import { encodeParameter, requestCharset } from './request.js';
import { SCRIPT_LIMITS } from './script-syntax.js';
const port = parentPort!;
// Independent hard WASM ceiling also bounds bulk strings/ArrayBuffers; do not
// rely solely on QuickJS allocator accounting (upstream issue #271).
const memory = new WebAssembly.Memory({ initial: 256, maximum: 512 });
const module = await newQuickJSAsyncWASMModule(newVariant(RELEASE_ASYNC, { wasmMemory: memory }));
let pending: ((value: any) => void) | undefined;
const serialize = (value: any): any => value?.nodeType ? value.toString() : value;
port.on('message', async message => {
  if (message.type === 'network') { pending?.(message); pending = undefined; return; }
  if (message.type !== 'run') return;
  const vm = module.newContext({ intrinsics: { ...DefaultIntrinsics, Proxy: false } });
  const runtime = vm.runtime;
  runtime.setMemoryLimit(SCRIPT_LIMITS.memory); runtime.setMaxStackSize(SCRIPT_LIMITS.stack);
  let deadline = Date.now() + SCRIPT_LIMITS.cpuMs, failure: string | undefined;
  runtime.setInterruptHandler(() => Date.now() > deadline);
  runtime.setModuleLoader(() => { throw Error('不允许加载模块'); });
  let context = message.context === undefined ? undefined : typeof message.context === 'string' ? documentContext(message.context) : message.context;
  const variables: Record<string, string> = Object.assign(Object.create(null), message.variables);
  const stop = (reason: string): never => { failure = reason; throw Error(reason); };
  const json = (handle: QuickJSHandle): any => {
    // QuickJS dump invokes guest conversions. Deadline + parent Worker watchdog
    // bound malicious getters/toJSON; no guest object escapes into Node.
    const value = vm.dump(handle);
    if (Buffer.byteLength(JSON.stringify(value) ?? '') > SCRIPT_LIMITS.output) return stop('脚本输出超过 2 MiB');
    return value;
  };
  const string = (handle: QuickJSHandle, max = SCRIPT_LIMITS.output) => {
    const value = vm.getString(handle);
    if (value.length > max) return stop('宿主参数长度超限');
    return value;
  };
  const toHandle = (value: any): QuickJSHandle => {
    if (value === undefined) return vm.undefined;
    if (value === null) return vm.null;
    if (typeof value === 'string') return vm.newString(value);
    if (typeof value === 'number') return vm.newNumber(value);
    if (typeof value === 'boolean') return value ? vm.true : vm.false;
    const handle = Array.isArray(value) ? vm.newArray() : vm.newObject();
    for (const [key, item] of Object.entries(value)) { const child = toHandle(item); vm.setProp(handle, key, child); child.dispose(); }
    return handle;
  };
  const bind = (name: string, fn: (...args: QuickJSHandle[]) => QuickJSHandle) => {
    const handle = vm.newFunction(name, fn); vm.setProp(java, name, handle); handle.dispose();
  };
  const java = vm.newObject();
  let serializer: QuickJSHandle | undefined;
  try {
    // Disable every constructor path to guest dynamic compilation, including
    // generators/async functions; descriptors cannot be restored by the source.
    const seal = vm.evalCode(`
      for (const fn of [function(){}, function*(){}, async function(){}, async function*(){}]) {
        Object.defineProperty(Object.getPrototypeOf(fn), 'constructor', {value: undefined, writable: false, configurable: false});
      }
      for (const key of ['eval', 'Function', 'WebAssembly']) Object.defineProperty(globalThis, key, {value: undefined, writable: false, configurable: false});
    `);
    if (seal.error) { const detail = vm.dump(seal.error); seal.dispose(); throw Error('隔离引擎初始化失败：' + detail.message); } seal.dispose();
    serializer = vm.unwrapResult(vm.evalCode('(function(stringify){ return function(value) { return stringify(value); }; })(JSON.stringify)'));
    for (const [key, value] of Object.entries({ ...message.globals, result: message.result })) { const handle = toHandle(value); vm.setProp(vm.global, key, handle); handle.dispose(); }
    bind('get', key => vm.newString(variables[string(key, 128)] ?? ''));
    bind('put', (key, value) => {
      const name = string(key, 128), text = string(value, SCRIPT_LIMITS.variables);
      if (['__proto__', 'constructor', 'prototype'].includes(name)) return stop('禁止原型变量');
      variables[name] = text;
      if (Object.keys(variables).length > 128 || Buffer.byteLength(JSON.stringify(variables)) > SCRIPT_LIMITS.variables) return stop('脚本变量超过 32 KiB / 128 项');
      return vm.newString(text);
    });
    bind('getString', rule => vm.newString(extract(compileRule(string(rule, 2048).replace(/^@@/, '')), context).join('\n')));
    bind('getStringList', rule => toHandle(extract(compileRule(string(rule, 2048).replace(/^@@/, '')), context)));
    bind('getElement', rule => toHandle(select(compileRule(string(rule, 2048).replace(/^@@/, ''), true), context).map(serialize)));
    bind('setContent', value => { context = documentContext(string(value)); return vm.undefined; });
    bind('encodeURI', (value, charset) => vm.newString(encodeParameter(string(value), charset ? string(charset, 20) : 'utf-8')));
    bind('decodeURI', (value, charset) => {
      const input = string(value), chunks: number[] = [];
      for (let i = 0; i < input.length; i++) {
        if (input[i] === '%' && /^[a-f0-9]{2}$/i.test(input.slice(i + 1, i + 3))) { chunks.push(parseInt(input.slice(i + 1, i + 3), 16)); i += 2; }
        else { for (const byte of Buffer.from(input[i] === '+' ? ' ' : input[i])) chunks.push(byte); }
      }
      return vm.newString(iconv.decode(Buffer.from(chunks), requestCharset(charset ? string(charset, 20) : 'utf-8')));
    });
    bind('base64Encode', value => vm.newString(Buffer.from(string(value), 'utf8').toString('base64')));
    bind('base64Decode', value => vm.newString(Buffer.from(string(value), 'base64').toString('utf8')));
    bind('hexDecodeToString', value => vm.newString(Buffer.from(string(value), 'hex').toString('utf8')));
    bind('hexEncodeToString', value => vm.newString(Buffer.from(string(value), 'utf8').toString('hex')));
    for (const name of ['log', 'toast', 'longToast']) bind(name, () => vm.undefined);
    for (const name of ['startBrowserAwait', 'startBrowser', 'webView', 'getVerificationCode']) bind(name, () => stop('此步骤需要真实浏览器、登录或验证码交互；尚无经授权的浏览器会话，已停止'));
    const ajax = vm.newAsyncifiedFunction('ajax', async url => {
      const input = string(url, 8192);
      port.postMessage({ type: 'ajax', input });
      const response = await new Promise<any>(resolve => { pending = resolve; });
      deadline = Date.now() + SCRIPT_LIMITS.cpuMs;
      if (response.error) return stop(response.error);
      return vm.newString(response.text);
    });
    vm.setProp(java, 'ajax', ajax); ajax.dispose();
    vm.setProp(vm.global, 'java', java);
    const result = await vm.evalCodeAsync(message.code, 'source-rule.js', { type: 'global' });
    try {
      if (failure) throw Error(failure);
      if (result.error) { const error = json(result.error); throw Error(`隔离脚本：${String(error?.message ?? error).slice(0, 400)}`); }
      // dump() falls back to String when JSON serialization throws. Use a
      // captured guest serializer so a hostile getter/toJSON fails the request.
      const encoded = vm.callFunction(serializer!, vm.undefined, result.value);
      let value: any;
      try {
        if (encoded.error) throw Error('脚本输出序列化失败或 interrupted');
        if (vm.typeof(encoded.value) !== 'undefined') {
          const length = vm.getProp(encoded.value, 'length');
          try { if (vm.getNumber(length) > SCRIPT_LIMITS.output) throw Error('脚本输出超过 2 MiB'); } finally { length.dispose(); }
          const output = vm.getString(encoded.value);
          if (Buffer.byteLength(output) > SCRIPT_LIMITS.output) throw Error('脚本输出超过 2 MiB');
          value = JSON.parse(output);
        }
      } finally { encoded.dispose(); }
      if (failure) throw Error(failure);
      port.postMessage({ type: 'done', value, variables });
    } finally { result.dispose(); }
  } catch (error) { port.postMessage({ type: 'error', error: failure ?? (error instanceof Error ? error.message : '隔离脚本失败') }); }
  finally { serializer?.dispose(); java.dispose(); vm.dispose(); }
});
port.postMessage({ type: 'ready' });
