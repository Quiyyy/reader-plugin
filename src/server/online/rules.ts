import { DOMParser } from 'linkedom';

export class RuleError extends Error {
  constructor(public readonly status: 'blocked' | 'invalid', message: string) { super(message); }
}
type Context = any;
type Step = { selector: string; index?: number };
export type Rule = { kind: 'css'; steps: Step[]; output?: string } | { kind: 'json'; path: (string | number | '*')[] };
const deny = (message: string): never => { throw new RuleError('blocked', message); };
const invalid = (message: string): never => { throw new RuleError('invalid', message); };
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);

/** A grammar, not a JavaScript evaluator. The whole input must be recognized. */
export function compileRule(input: string, list = false): Rule {
  if (!input.trim() || input.length > 2048) return invalid('规则为空或超过 2048 字符');
  let rule = input.trim();
  if (/@js:|<\/?js>|javascript:|\{\{|##|&&|\|\||@(?:get|put|json):/i.test(rule)) return deny('不支持脚本、模板表达式、替换、组合或变量规则');
  if (rule.startsWith('$')) {
    const path: (string | number | '*')[] = [];
    let rest = rule.slice(1);
    while (rest) {
      const match = rest.match(/^(?:\.([A-Za-z_][\w-]*)|\[(\d{1,5}|\*)\]|\[['"]([A-Za-z_][\w-]*)['"]\])/);
      if (!match) return deny('仅支持 JSONPath 属性、非负数组索引和 [*]；不支持表达式、过滤、递归或切片');
      const key = match[1] ?? match[3];
      if (key && forbiddenKeys.has(key)) return deny('禁止原型属性');
      path.push(key ?? (match[2] === '*' ? '*' : Number(match[2])));
      rest = rest.slice(match[0].length);
      if (path.length > 20) return invalid('JSONPath 层级超过 20');
    }
    return { kind: 'json', path };
  }
  rule = rule.replace(/^@?css:/i, '');
  const parts = rule.split('@');
  let output: string | undefined;
  if (!list) {
    output = parts.pop();
    if (!output || !['text', 'ownText', 'href', 'src', 'content', 'title', 'value'].includes(output)) return deny('文本规则需以 @text/@ownText 或受支持属性结尾；HTML 不作为正文执行');
  }
  if (parts.length > 20) return invalid('选择器链超过 20 层');
  const rootText = !list && parts.length === 1 && parts[0] === '';
  if (!rootText && parts.some(part => !part)) return invalid('选择器链含空步骤');
  const steps: Step[] = (rootText ? [] : parts).map(part => {
    const classic = part.match(/^(class|tag|id)\.([A-Za-z_][\w-]*)(?:\.(\d{1,5}))?$/);
    if (classic) return { selector: `${classic[1] === 'class' ? '.' : classic[1] === 'id' ? '#' : ''}${classic[2]}`, ...(classic[3] ? { index: Number(classic[3]) } : {}) };
    // Restrict CSS to simple compounds with descendant/child combinators. No
    // pseudo-classes, escapes, regex, selector lists or unknown dialect suffixes.
    const atom = /^(?:[A-Za-z][\w-]*|\*)?(?:[.#][A-Za-z_][\w-]*|\[[A-Za-z_][\w-]*(?:=["'][A-Za-z0-9_/:.-]+["'])?\])*$/;
    const compounds = part.trim().split(/\s*>\s*|\s+/);
    if (compounds.length > 20 || compounds.some(c => !c || !atom.test(c)) || /(?:^|@)(?:class|tag|id)\./.test(part)) return deny(`不支持的 CSS/经典选择器：${part.slice(0, 80)}`);
    try { new DOMParser().parseFromString('<html></html>', 'text/html').querySelectorAll(part); }
    catch { return invalid('CSS 选择器无效'); }
    return { selector: part };
  });
  if (list && !steps.length) return invalid('列表选择器不能为空');
  return { kind: 'css', steps, output };
}

export function documentContext(body: string): Context {
  if (/^\s*[\[{]/.test(body)) {
    try { return JSON.parse(body); } catch { throw new Error('响应不是有效 JSON'); }
  }
  return new DOMParser().parseFromString(body, 'text/html');
}
function plain(node: any, own = false): string {
  if (!node?.cloneNode) return typeof node === 'string' || typeof node === 'number' ? String(node) : '';
  const copy = node.cloneNode(true);
  copy.querySelectorAll?.('script,style,iframe,object,embed,svg,form,noscript').forEach((item: any) => item.remove());
  if (own) return Array.from(copy.childNodes ?? []).filter((n: any) => n.nodeType === 3).map((n: any) => n.textContent).join('').trim();
  copy.querySelectorAll?.('br').forEach((item: any) => item.replaceWith('\n'));
  copy.querySelectorAll?.('p,div,li,h1,h2,h3,section,article').forEach((item: any) => item.append('\n'));
  return (copy.textContent ?? '').replace(/\r/g, '').trim();
}
export function select(rule: Rule, context: Context): Context[] {
  let nodes: Context[] = [context];
  if (rule.kind === 'json') {
    for (const key of rule.path) {
      nodes = nodes.flatMap(node => key === '*' ? (Array.isArray(node) ? node : []) : node !== null && typeof node === 'object' && Object.hasOwn(node, key) ? [node[key]] : []);
      if (nodes.length > 10000) throw new Error('规则结果超过 10000 项');
    }
    return nodes;
  }
  for (const step of rule.steps) {
    nodes = nodes.flatMap(node => {
      if (!node?.querySelectorAll) throw new Error('CSS 规则需要 HTML 响应');
      const found = Array.from(node.querySelectorAll(step.selector));
      return step.index === undefined ? found : found[step.index] ? [found[step.index]] : [];
    });
    if (nodes.length > 10000) throw new Error('规则结果超过 10000 项');
  }
  return nodes;
}
export function extract(rule: Rule, context: Context): string[] {
  return select(rule, context).map(node => rule.kind === 'json' ? plain(node) : rule.output === 'text' || rule.output === 'ownText' ? plain(node, rule.output === 'ownText') : node.getAttribute?.(rule.output!) ?? '').map(text => text.trim()).filter(Boolean);
}

export function template(input: string, key: string, page: number): string {
  if (/[{}]/.test(input.replace(/\{\{(?:key|page)\}\}/g, ''))) throw new RuleError('blocked', '仅支持 {{key}} 和 {{page}} 模板');
  return input.replace(/\{\{key\}\}/g, encodeURIComponent(key)).replace(/\{\{page\}\}/g, String(page));
}
