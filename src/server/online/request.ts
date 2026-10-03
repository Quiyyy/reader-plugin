import { parseExpressionAt } from 'acorn';
import iconv from 'iconv-lite';
import { RuleError } from './rules.js';

export interface SearchRequest { url: string; method: 'GET' | 'POST'; body?: string; charset: string; headers: Record<string, string>; }
/** Parse data literals only. Acorn parses syntax; no Node evaluator is involved. */
export function literalObject(input: string): Record<string, any> {
  if (input.length > 8192) throw new RuleError('blocked', '请求选项超过 8192 字符');
  try {
    const tree = parseExpressionAt(input, 0, { ecmaVersion: 2022 });
    if (input.slice(tree.end).trim()) throw Error();
    const read = (node: any, depth = 0): any => {
      if (depth > 3) throw Error();
      if (node.type === 'Literal' && ['string', 'boolean', 'number'].includes(typeof node.value)) return node.value;
      if (node.type !== 'ObjectExpression' || node.properties.length > 20) throw Error();
      const value = Object.create(null);
      for (const p of node.properties) {
        if (p.type !== 'Property' || p.kind !== 'init' || p.computed || p.method || p.shorthand || p.key.type !== 'Literal' || typeof p.key.value !== 'string') throw Error();
        const key = p.key.value;
        if (['__proto__', 'constructor', 'prototype'].includes(key) || Object.hasOwn(value, key)) throw Error();
        value[key] = read(p.value, depth + 1);
      }
      return value;
    };
    const value = read(tree);
    if (!value || typeof value !== 'object') throw Error();
    return value;
  } catch { throw new RuleError('blocked', '请求选项必须是有界数据对象；不执行对象表达式或函数'); }
}
export function requestCharset(value = 'utf-8'): string {
  const name = value.toLowerCase().replace(/[-_]/g, '');
  if (!['utf8', 'gbk', 'gb2312', 'gb18030'].includes(name)) throw new RuleError('blocked', '请求编码仅支持 UTF-8、GBK、GB2312、GB18030');
  return name === 'utf8' ? 'utf-8' : name;
}
export function encodeParameter(value: string, charset = 'utf-8'): string {
  const encoding = requestCharset(charset);
  const bytes = iconv.encode(value, encoding);
  if (iconv.decode(bytes, encoding) !== value) throw new RuleError('blocked', `参数含 ${encoding} 无法表示的字符`);
  return [...bytes].map(n => n >= 65 && n <= 90 || n >= 97 && n <= 122 || n >= 48 && n <= 57 || [45, 46, 95, 126].includes(n) ? String.fromCharCode(n) : `%${n.toString(16).toUpperCase().padStart(2, '0')}`).join('');
}
export function staticHeaders(input: unknown): Record<string, string> {
  if (input === undefined || input === '') return {};
  const values = typeof input === 'string' ? literalObject(input) : input;
  if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).length > 8) throw new RuleError('blocked', '请求头必须是最多 8 项的静态对象');
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(values)) {
    const lower = name.toLowerCase();
    if (!['accept', 'accept-language', 'user-agent', 'referer', 'content-type', 'x-requested-with', 'connection'].includes(lower)) throw new RuleError('blocked', `不允许请求头 ${name}；Cookie、认证和任意自定义头需要单独授权能力`);
    if (typeof value !== 'string' || value.length > 1024 || /[^\x20-\x7e]/.test(value) || /\{\{|@js:|<js>/i.test(value) || Object.hasOwn(result, lower)) throw new RuleError('blocked', '请求头值必须是有限的静态 ASCII 字符串');
    if (lower === 'connection' && value.toLowerCase() !== 'close') throw new RuleError('blocked', 'Connection 只支持 close');
    if (lower === 'content-type' && !/^application\/(?:x-www-form-urlencoded|json)(?:; charset=(?:utf-?8|gbk|gb2312|gb18030))?$/i.test(value)) throw new RuleError('blocked', '不支持的 Content-Type');
    result[lower] = value;
  }
  return result;
}
export function searchRequest(input: string, key: string, page: number): SearchRequest {
  if (input.length > 8192 || /@js:|<\/?js>|javascript:/i.test(input)) throw new RuleError('blocked', '请求地址需要先经过隔离规则引擎或超过 8192 字符');
  const split = input.search(/,\s*\{/);
  const config = split < 0 ? {} : literalObject(input.slice(split + 1));
  for (const name of Object.keys(config)) if (!['method', 'body', 'charset', 'headers'].includes(name)) throw new RuleError('blocked', name === 'webView' ? '此请求需要真实 WebView；Reader 尚无经授权的浏览器会话' : `不支持请求选项 ${name}`);
  for (const name of ['method', 'body', 'charset']) if (config[name] !== undefined && typeof config[name] !== 'string') throw new RuleError('blocked', `请求 ${name} 必须为字符串`);
  const method = (config.method ?? 'GET').toUpperCase();
  if (!['GET', 'POST'].includes(method)) throw new RuleError('blocked', '请求仅支持 GET 或表单 POST');
  const charset = requestCharset(config.charset);
  const substitute = (text: string) => {
    if (/\{\{|\}\}/.test(text.replace(/\{\{(?:key|page)\}\}/g, ''))) throw new RuleError('blocked', '模板表达式须先经过隔离规则引擎');
    return text.replace(/\{\{key\}\}/g, encodeParameter(key, charset)).replace(/\{\{page\}\}/g, String(page));
  };
  if (method === 'GET' && config.body !== undefined || method === 'POST' && !config.body) throw new RuleError('blocked', 'POST 必须包含非空表单；GET 不支持请求体');
  // Preserve pre-encoded bytes. Encode literal non-ASCII text without double-encoding %XX.
  const encodeLiteral = (text: string) => text.replace(/[^\x21-\x7e]+/gu, value => encodeParameter(value, charset));
  const body = config.body === undefined ? undefined : encodeLiteral(substitute(config.body));
  if (body !== undefined && (Buffer.byteLength(body) > 8192 || body.split('&').some((field: string) => !/^[A-Za-z][A-Za-z0-9_]*=/.test(field)))) throw new RuleError('blocked', '请求体必须是最多 8192 字节的百分号编码表单');
  return { url: encodeLiteral(substitute(split < 0 ? input : input.slice(0, split))), method, body, charset, headers: staticHeaders(config.headers) };
}
