import { createHash } from 'node:crypto';
import { stages, type Diagnostic, type SourceReport, type Stage, type StageReport, type SyntaxStatus } from '../../shared/online.js';
import { RuleError } from './rules.js';
import { safeUrl } from './http.js';
import { inspectRule } from './evaluate.js';
import { parseRate } from './rate.js';
import { chain, validateScript } from './script-syntax.js';
import { searchRequest, staticHeaders } from './request.js';

export const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export const SOURCE_LIMITS = Object.freeze({ bytes: 512 * 1024, sources: 50, stored: 100, chapters: 20000 });
export interface Source { report: SourceReport; raw: Record<string, any>; generation?: string; }
export const stageKeys: Record<Stage, string> = { search: 'ruleSearch', detail: 'ruleBookInfo', toc: 'ruleToc', content: 'ruleContent' };
const fields: Record<Stage, string[]> = {
  search: ['bookList', 'name', 'author', 'bookUrl'], detail: ['init', 'name', 'author', 'intro', 'tocUrl'],
  toc: ['chapterList', 'chapterName', 'chapterUrl', 'nextTocUrl'], content: ['content', 'nextContentUrl', 'replaceRegex'],
};
const required: Record<Stage, string[]> = { search: ['bookList', 'name', 'bookUrl'], detail: [], toc: ['chapterList', 'chapterName', 'chapterUrl'], content: ['content'] };
const metadata = new Set(['bookSourceName', 'bookSourceUrl', 'bookSourceGroup', 'bookSourceComment', 'bookSourceType', 'enabled', 'enabledExplore', 'customOrder', 'lastUpdateTime', 'weight', 'respondTime', 'searchUrl', ...Object.values(stageKeys)]);
const passive = new Set(['coverUrl', 'lastChapter', 'wordCount', 'kind', 'updateTime']);
const unusedRoot = new Set(['ruleExplore', 'exploreUrl', 'bookUrlPattern']);
const unusedStage: Record<Stage, string[]> = { search: ['intro', 'checkKeyWord'], detail: ['downloadUrls'], toc: [], content: ['imageStyle'] };
const present = (value: unknown) => value !== undefined && value !== null && value !== '' && value !== false;
function status(issues: Diagnostic[]): SyntaxStatus {
  return issues.some(d => d.status === 'invalid') ? 'invalid' : issues.some(d => d.status === 'blocked') ? 'blocked' : issues.length ? 'partial' : 'supported';
}
function stable(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function inspectSource(raw: any): Source {
  const diagnostics: Diagnostic[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) raw = { invalid: raw };
  const issue = (field: string, reason: string, state: SyntaxStatus = 'blocked') => diagnostics.push({ field, status: state, reason });
  let url = '';
  try { if (typeof raw.bookSourceUrl !== 'string') throw new Error('缺少字符串地址'); url = safeUrl(raw.bookSourceUrl).href; }
  catch (error) { issue('bookSourceUrl', (error as Error).message, 'invalid'); }
  if (typeof raw.bookSourceName !== 'string' || !raw.bookSourceName.trim() || raw.bookSourceName.length > 200) issue('bookSourceName', '名称必填，最多 200 字符', 'invalid');
  if (raw.bookSourceType !== undefined && raw.bookSourceType !== 0) issue('bookSourceType', '仅支持文字书籍类型 0');
  for (const [key, value] of Object.entries(raw)) if (!metadata.has(key) && present(value)) {
    if (unusedRoot.has(key)) issue(key, 'Reader 不使用发现页或链接自动识别；此字段整体忽略，其中的脚本也不会执行', 'partial');
    else if (key === 'concurrentRate') { try { parseRate(value); } catch (error) { issue(key, (error as Error).message); } }
    else if (key === 'header') { try { staticHeaders(value); } catch (error) { issue(key, (error as Error).message); } }
    else if (['loginUrl', 'loginUi'].includes(key)) issue(key, '登录入口未使用；只尝试公开请求，实际遇到登录或挑战时停止', 'partial');
    else if (key === 'readerAllowedOrigins') { try { const origins = sourceOrigins(raw, url); issue(key, `启用后允许请求的明确域集合：${origins.join('、')}；不发送 Cookie/认证头`, 'partial'); } catch (error) { issue(key, (error as Error).message); } }
    else if (key === 'enabledCookieJar' && value === true) issue(key, '仅尝试无 Cookie 的公开请求；不存储或发送 Cookie，需要登录的网站仍不可读', 'partial');
    else issue(key, key === 'concurrentRate' ? '暂不支持此源的请求频率策略；未忽略限速要求发起请求' : '此源声明了未支持的访问能力或未知字段；不执行登录、请求头、依赖或脚本');
  }
  const reports = {} as Record<Stage, StageReport>;
  for (const stage of stages) {
    const problems: Diagnostic[] = [];
    const add = (field: string, reason: string, state: SyntaxStatus = 'blocked') => problems.push({ field: `${stageKeys[stage]}.${field}`, status: state, reason });
    const rules = raw[stageKeys[stage]] ?? {};
    if (!rules || typeof rules !== 'object' || Array.isArray(rules)) add('', '阶段规则必须是对象', 'invalid');
    else {
      for (const field of required[stage]) if (!present(rules[field])) add(field, '缺少必需规则', 'invalid');
      for (const [field, value] of Object.entries(rules)) {
        if (!present(value)) continue;
        if (!fields[stage].includes(field)) { const unused = passive.has(field) || unusedStage[stage].includes(field); add(field, unused ? '未使用的展示、检查或下载字段已忽略；不提取、不请求、不执行其中脚本' : '此阶段依赖未支持的字段；不会跳过后执行', unused ? 'partial' : 'blocked'); continue; }
        if (typeof value !== 'string') { add(field, '规则必须为字符串', 'invalid'); continue; }
        try { if (inspectRule(value, ['bookList', 'chapterList', 'init'].includes(field), field === 'replaceRegex')) add(field, '含隔离脚本或表达式；宿主 API、网络域和运行预算在实际阶段检查，未证明站点可用', 'partial'); }
        catch (error) { add(field, (error as Error).message, error instanceof RuleError ? error.status : 'blocked'); }
      }
    }
    if (stage === 'search') {
      try {
        if (typeof raw.searchUrl !== 'string' || !raw.searchUrl) throw new RuleError('invalid', '缺少搜索 URL');
        const parts = chain(raw.searchUrl);
        if (parts.some(part => part.kind === 'js') || /\{\{(?!(?:key|page)\}\})/.test(raw.searchUrl)) {
          for (const part of parts) if (part.kind === 'js') validateScript(part.value);
          problems.push({ field: 'searchUrl', status: 'partial', reason: '搜索 URL 使用隔离表达式；运行时检查请求选项与明确域集合' });
        } else {
          const request = searchRequest(raw.searchUrl, '测试', 1);
          const target = safeUrl(request.url, url);
          if (!sourceOrigins(raw, url).includes(target.origin)) throw new RuleError('blocked', `搜索跨域 ${target.origin} 不在明确域集合中`);
        }
      } catch (error) { problems.push({ field: 'searchUrl', status: error instanceof RuleError ? error.status : 'invalid', reason: (error as Error).message }); }
    }
    reports[stage] = { syntax: status([...diagnostics, ...problems]), network: 'untested', diagnostics: problems };
  }
  const all = stages.map(stage => reports[stage].syntax);
  const syntax = diagnostics.some(d => d.status === 'invalid') ? 'invalid' : diagnostics.some(d => d.status === 'blocked') ? 'blocked' : all.every(s => s === 'supported') ? 'supported' : all.some(s => s === 'supported' || s === 'partial') ? 'partial' : all.includes('invalid') ? 'invalid' : 'blocked';
  return { raw, report: { id: hash(url || stable(raw)), revision: hash(stable(raw)), name: typeof raw.bookSourceName === 'string' ? raw.bookSourceName.slice(0, 200) : '无效书源', url, enabled: false, syntax, stages: reports, diagnostics } };
}
export function importSources(json: string): Source[] {
  if (Buffer.byteLength(json) > SOURCE_LIMITS.bytes) throw new Error('书源 JSON 超过 512 KiB');
  let raw: any;
  try { raw = JSON.parse(json.replace(/^\uFEFF/, '')); } catch { throw new Error('书源文件不是有效 JSON'); }
  const list = Array.isArray(raw) ? raw : [raw];
  if (!list.length || list.length > SOURCE_LIMITS.sources) throw new Error('每次可导入 1–50 个书源');
  // Bound nesting before canonicalization or interpretation. Prototype keys are
  // data in JSON.parse, but are rejected before any merges or persistence.
  const walk = (value: any, depth: number) => {
    if (depth > 20) throw new Error('书源 JSON 嵌套超过 20 层');
    if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('书源含禁止的原型属性');
      walk(item, depth + 1);
    }
  };
  walk(raw, 0);
  const sources = list.map(inspectSource);
  if (new Set(sources.map(s => s.report.id)).size !== sources.length) throw new Error('同一批次出现重复书源地址；请保留一个版本后重试');
  return sources;
}

/** Additional origins are explicit import data, visible in preview; never inferred from scripts. */
export function sourceOrigins(raw: Record<string, any>, url: string): string[] {
  const origin = safeUrl(url).origin, extra = raw.readerAllowedOrigins ?? [];
  if (!Array.isArray(extra) || extra.length > 8) throw Error('额外域集合必须是最多 8 个 origin');
  return [...new Set([origin, ...extra.map(value => {
    if (typeof value !== 'string') throw Error('额外域必须是字符串');
    const parsed = safeUrl(value);
    if (parsed.href !== parsed.origin + '/' || parsed.search) throw Error('域集合必须只包含 origin');
    if (origin.startsWith('https:') && parsed.protocol !== 'https:') throw Error('额外域不能将 HTTPS 降级');
    return parsed.origin;
  })])];
}
