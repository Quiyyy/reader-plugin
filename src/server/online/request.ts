import { RuleError, template } from './rules.js';

export interface SearchRequest { url: string; method: 'GET' | 'POST'; body?: string; }
/** String-only object grammar. Single quotes are data syntax, never evaluated. */
function options(input: string): Record<string, string> {
  let offset = 0;
  const space = () => { while (/\s/.test(input[offset] ?? '') && offset < input.length) offset++; };
  const fail = (): never => { throw new RuleError('blocked', '请求选项仅支持字符串字面量 method、body、UTF-8 charset；不执行表达式'); };
  const take = (value: string) => { space(); if (input[offset++] !== value) fail(); };
  const string = () => {
    space(); const quote = input[offset++]; if (quote !== '"' && quote !== "'") return fail();
    let value = '';
    while (offset < input.length) {
      const char = input[offset++];
      if (char === quote) return value;
      if (char === '\\') {
        const escaped = input[offset++];
        if (!['\\', '"', "'", '/'].includes(escaped)) return fail();
        value += escaped;
      } else { if (char.charCodeAt(0) < 32) return fail(); value += char; }
    }
    return fail();
  };
  const result = Object.create(null) as Record<string, string>;
  take('{'); space();
  if (input[offset] !== '}') for (;;) {
    const key = string();
    if (!['method', 'body', 'charset'].includes(key) || Object.hasOwn(result, key)) fail();
    take(':'); result[key] = string(); space();
    if (input[offset] !== ',') break;
    offset++;
  }
  take('}'); space(); if (offset !== input.length) fail();
  return result;
}
export function searchRequest(input: string, key: string, page: number): SearchRequest {
  if (input.length > 8192 || /@js:|<\/?js>|javascript:/i.test(input)) throw new RuleError('blocked', '搜索地址含脚本或超过 8192 字符');
  const split = input.search(/,\s*\{/);
  const config = split < 0 ? {} : options(input.slice(split + 1));
  const method = (config.method ?? 'GET').toUpperCase();
  if (!['GET', 'POST'].includes(method)) throw new RuleError('blocked', '搜索仅支持 GET 或表单 POST');
  if (config.charset && !/^utf-?8$/i.test(config.charset)) throw new RuleError('blocked', '搜索参数编码仅支持 UTF-8；响应解码支持其他编码不代表请求支持');
  if (method === 'GET' && config.body !== undefined || method === 'POST' && (!config.body || !config.body.includes('{{key}}'))) throw new RuleError('blocked', 'POST 必须是包含 {{key}} 的搜索表单；GET 不支持请求体');
  const body = config.body === undefined ? undefined : template(config.body, key, page);
  if (body !== undefined && (Buffer.byteLength(body) > 8192 || !/^[\x21-\x7e]*$/.test(body) || body.split('&').some(field => !/^[A-Za-z][A-Za-z0-9_]*=/.test(field)))) throw new RuleError('blocked', '搜索请求体必须是最多 8192 字节的 UTF-8 百分号编码表单');
  return { url: template(split < 0 ? input : input.slice(0, split), key, page), method: method as 'GET' | 'POST', body };
}
