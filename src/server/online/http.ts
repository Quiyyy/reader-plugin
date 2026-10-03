import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpRequest, type RequestOptions, type IncomingMessage, type ClientRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { staticHeaders } from './request.js';
import { SourceRateLimiter, type Rate } from './rate.js';
import { normalizeEncoding } from '../importers.js';

export const HTTP_LIMITS = Object.freeze({ timeout: 10000, bytes: 2 * 1024 * 1024, redirects: 3, addresses: 3, concurrent: 4, queue: 16 });
class ConnectionFailure extends Error {}
const retryableConnectionErrors = new Set(['ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT', 'EPIPE']);
type ResponseData = { redirectStatus?: number; location?: string; bytes?: Buffer; type?: string };
export function publicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 || b === 2 || b === 88 && c === 99) || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
  }
  if (family !== 6 || address.includes('%')) return false;
  // Conservative global unicast only; reject mapped/compatible IPv4, NAT64,
  // ULA, link-local, multicast, transition and special-use allocation blocks.
  const words = address.toLowerCase().split(':');
  const first = parseInt(words[0] || '0', 16), second = parseInt(words[1] || '0', 16);
  return first >= 0x2000 && first <= 0x3fff && first !== 0x2002 && !(first === 0x2001 && (second < 0x200 || second === 0xdb8)) && !(first === 0x3fff && second < 0x1000);
}
export function safeUrl(value: string, base?: string): URL {
  if (value.length > 4096 || /[\x00-\x20\\]/.test(value)) throw new Error('URL 含空白、控制字符或过长');
  let url: URL;
  try { url = new URL(value, base); } catch { throw new Error('URL 无效'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('仅允许无凭据的 HTTP/HTTPS URL');
  if (url.port) throw new Error('仅允许 HTTP 80 / HTTPS 443 标准端口');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host || host.endsWith('.') || /(?:^|\.)(?:localhost|local|internal|home|lan|onion|invalid|test)$/.test(host) || !host.includes('.') && !isIP(host)) throw new Error('禁止本地或保留主机名');
  if (isIP(host) && !publicAddress(host)) throw new Error('禁止回环、私网、元数据或其他非公网地址');
  url.hash = '';
  return url;
}
export function sameOriginUrl(value: string, base: string, origin: string): string {
  const url = safeUrl(value, base);
  if (url.origin !== origin) throw new Error('链接跨域；本兼容子集只允许书源声明的同一 origin');
  return url.href;
}
export interface HttpPolicy {
  headers?: Record<string, string>;
  charset?: string;
  origins?: string[];
  rate?: Rate;
  sourceKey?: string;
  beforeRequest?: () => void;
}
export function allowedUrl(value: string, base: string, origins: string[]): string {
  const url = safeUrl(value, base);
  if (!origins.includes(url.origin)) throw new Error(`链接跨域：${url.origin} 未在书源的明确域集合中；请检查导入策略`);
  return url.href;
}
type Dependencies = {
  resolve?: (host: string) => Promise<{ address: string; family: number }[]>;
  transport?: (url: URL, options: RequestOptions, response: (res: IncomingMessage) => void) => ClientRequest;
};
export interface TextResponse { url: string; text: string; }

/** No fetch, browser, cookie jar, proxy environment, netrc, auth, or user headers.
 * Dependencies are constructor-only for controlled tests; never exposed by RPC.
 */
export class SafeHttpClient {
  private active = 0;
  private readonly rates = new SourceRateLimiter();
  private waiters: (() => void)[] = [];
  constructor(private readonly dependencies: Dependencies = {}) {}
  async get(value: string, signal?: AbortSignal, origin?: string, policy: HttpPolicy = {}): Promise<TextResponse> { return this.request(value, signal, origin, undefined, policy); }
  async post(value: string, body: string, signal?: AbortSignal, origin?: string, policy: HttpPolicy = {}): Promise<TextResponse> {
    if (Buffer.byteLength(body) > 8192 || /[^\x21-\x7e]/.test(body)) throw new Error('POST 搜索表单无效或超过 8192 字节');
    return this.request(value, signal, origin, body, policy);
  }
  private async request(value: string, signal?: AbortSignal, origin?: string, body?: string, policy: HttpPolicy = {}): Promise<TextResponse> {
    const controller = new AbortController();
    const stop = () => controller.abort(new Error('请求已取消'));
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) stop();
    const timer = setTimeout(() => controller.abort(new Error('联网超时（10 秒）')), HTTP_LIMITS.timeout);
    let release = false;
    try {
      await this.slot(controller.signal); release = true;
      let url = safeUrl(value);
      const origins = policy.origins ?? [origin ?? url.origin];
      const headers = staticHeaders(policy.headers);
      if (headers.referer) allowedUrl(headers.referer, url.href, origins);
      policy = { ...policy, headers };
      const initialProtocol = url.protocol;
      const visited = new Set<string>();
      for (let redirects = 0; ; redirects++) {
        controller.signal.throwIfAborted();
        if (!origins.includes(url.origin)) throw new Error(`禁止跨域重定向：${url.origin} 未在允许集合中`);
        if (initialProtocol === 'https:' && url.protocol !== 'https:') throw new Error('禁止 HTTPS 降级重定向');
        if (visited.has(url.href)) throw new Error('检测到重定向循环');
        visited.add(url.href);
        const result = await this.once(url, controller.signal, body, policy);
        if (result.location !== undefined) {
          if (redirects >= HTTP_LIMITS.redirects) throw new Error('重定向次数超过 3');
          if ([301, 302, 303].includes(result.redirectStatus!)) body = undefined;
          url = safeUrl(result.location, url.href);
          continue;
        }
        const declared = result.type?.match(/charset\s*=\s*["']?([^\s;"']+)/i)?.[1];
        const meta = result.bytes!.subarray(0, 4096).toString('ascii').match(/<meta[^>]+charset\s*=\s*["']?([\w-]+)/i)?.[1];
        const bytes = result.bytes!;
        const bom = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : undefined;
        const encoding = normalizeEncoding(bom ?? declared ?? meta ?? 'utf-8');
        try { return { url: url.href, text: new TextDecoder(encoding, { fatal: true }).decode(bytes) }; }
        catch { throw new Error(`响应无法按 ${encoding} 解码`); }
      }
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', stop);
      if (release) { this.active--; this.waiters.shift()?.(); }
    }
  }
  private async slot(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (this.active >= HTTP_LIMITS.concurrent) {
      if (this.waiters.length >= HTTP_LIMITS.queue) throw new Error('联网队列已满');
      await new Promise<void>((resolve, reject) => {
        const ready = () => { signal.removeEventListener('abort', abort); this.active++; resolve(); };
        const abort = () => { const index = this.waiters.indexOf(ready); if (index >= 0) this.waiters.splice(index, 1); reject(signal.reason); };
        this.waiters.push(ready); signal.addEventListener('abort', abort, { once: true });
      });
    } else this.active++;
  }
  private async once(url: URL, signal: AbortSignal, body: string | undefined, policy: HttpPolicy): Promise<ResponseData> {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const resolved = isIP(host) ? [{ address: host, family: isIP(host) }] : await this.abortable((this.dependencies.resolve ?? (name => dnsLookup(name, { all: true, verbatim: true })))(host), signal);
    signal.throwIfAborted();
    if (!resolved.length || resolved.length > 32 || resolved.some(item => !publicAddress(item.address))) throw new Error('DNS 包含非公网地址，已阻止连接');
    // Retry only a small set of addresses from this already validated DNS
    // answer. Never resolve again after a connection failure. All attempts
    // share the original deadline, concurrency slot, hostname and TLS checks.
    const candidates = [...new Map(resolved.map(item => [`${item.family}:${item.address}`, item])).values()].slice(0, HTTP_LIMITS.addresses);
    let failure: Error = new Error('连接失败；请检查书源地址或稍后重试');
    for (const pinned of candidates) {
      signal.throwIfAborted();
      try {
        await this.rates.wait(policy.sourceKey ?? url.origin, policy.rate, signal);
        signal.throwIfAborted(); policy.beforeRequest?.();
        return await this.connect(url, signal, pinned, body, policy);
      }
      catch (error) {
        if (!(error instanceof ConnectionFailure) || signal.aborted || body !== undefined) throw error;
        failure = error;
      }
    }
    throw failure;
  }
  private connect(url: URL, signal: AbortSignal, pinned: { address: string; family: number }, body: string | undefined, policy: HttpPolicy): Promise<ResponseData> {
    return new Promise((resolve, reject) => {
      const options: RequestOptions = {
        agent: false, method: body === undefined ? 'GET' : 'POST', signal, maxHeaderSize: 16384,
        headers: { ...(!policy.headers?.accept ? { Accept: 'text/html,application/json,text/plain' } : {}), 'Accept-Encoding': 'identity', ...(!policy.headers?.['user-agent'] ? { 'User-Agent': 'Reader-Safe-Online/1' } : {}), ...policy.headers, ...(body === undefined ? {} : { 'Content-Type': `application/x-www-form-urlencoded; charset=${policy.charset ?? 'UTF-8'}`, 'Content-Length': String(Buffer.byteLength(body)) }) },
        // Host/SNI/TLS retain the original hostname. Every connection uses only
        // the validated address, so a second DNS answer cannot rebind it.
        lookup: (_name: string, opts: any, callback: any) => opts?.all ? callback(null, [pinned]) : callback(null, pinned.address, pinned.family),
      };
      const transport = this.dependencies.transport ?? ((target, settings, callback) => (target.protocol === 'https:' ? httpsRequest : httpRequest)(target, settings, callback));
      const request = transport(url, options, response => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
          const location = response.headers.location; response.destroy();
          if (!location) reject(new Error('重定向缺少 Location')); else resolve({ location, redirectStatus: response.statusCode });
          return;
        }
        if (response.statusCode !== 200) { response.destroy(); reject(new Error(`HTTP ${response.statusCode ?? '未知'}；未绕过访问限制`)); return; }
        if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') { response.destroy(); reject(new Error('首版拒绝压缩响应（防止解压炸弹）')); return; }
        if (Number(response.headers['content-length'] ?? 0) > HTTP_LIMITS.bytes) { response.destroy(); reject(new Error('响应超过 2 MiB')); return; }
        const type = response.headers['content-type'] ?? '';
        if (type && !/^(text\/(html|plain)|application\/(json|xhtml\+xml))(?:;|$)/i.test(type)) { response.destroy(); reject(new Error('不支持的响应类型')); return; }
        let size = 0; const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > HTTP_LIMITS.bytes) { response.destroy(new Error('响应超过 2 MiB')); } else chunks.push(chunk); });
        response.on('error', reject); response.on('aborted', () => reject(new Error('响应传输中断')));
        response.on('end', () => resolve({ bytes: Buffer.concat(chunks), type }));
      });
      request.on('error', (error: NodeJS.ErrnoException) => reject(signal.aborted ? signal.reason :
        retryableConnectionErrors.has(error.code ?? '') ? new ConnectionFailure('连接失败；请检查书源地址或稍后重试') : new Error('连接失败；请检查书源地址或稍后重试')));
      request.end(body);
    });
  }
  private abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      promise.then(resolve, () => reject(new Error('DNS 解析失败'))).finally(() => signal.removeEventListener('abort', abort));
    });
  }
}
