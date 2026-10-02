import { DOMParser, Node as DomNode } from 'linkedom';
import { Parser } from 'htmlparser2';

export class RuleError extends Error {
  constructor(public readonly status: 'blocked' | 'invalid', message: string) { super(message); }
}
type Context = any;
type Compound = { tag?: string; attributes: { name: string; value?: string; word?: boolean }[] };
type Step = { selector: string; index?: number; compounds: Compound[]; relations: (' ' | '>')[] };
export type Rule = { kind: 'css'; steps: Step[]; output?: string } | { kind: 'json'; path: (string | number | '*')[] };
const deny = (message: string): never => { throw new RuleError('blocked', message); };
const invalid = (message: string): never => { throw new RuleError('invalid', message); };
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);
export const RULE_LIMITS = Object.freeze({ bytes: 2 * 1024 * 1024, nodes: 20000, depth: 128, attributes: 128, name: 128, attributeValue: 8192, results: 10000, work: 2_000_000, text: 4 * 1024 * 1024 });
class Budget {
  private work = 0;
  private text = 0;
  spend(amount = 1) { this.work += amount; if (this.work > RULE_LIMITS.work) throw new Error('规则同步工作预算超限'); }
  output(length: number) { this.text += length; if (this.text > RULE_LIMITS.text) throw new Error('规则文本输出预算超限'); }
}
// A page shares one synchronous budget across all field and per-row evaluations.
const budgets = new WeakMap<object, Budget>();
const isDomNode = (value: unknown): boolean => value instanceof DomNode;
function budgetFor(context: Context): Budget {
  if (context && typeof context === 'object' && budgets.has(context)) return budgets.get(context)!;
  const owner = isDomNode(context) ? context.ownerDocument ?? context : context;
  if (!owner || typeof owner !== 'object') return new Budget();
  let budget = budgets.get(owner);
  if (!budget) { budget = new Budget(); budgets.set(owner, budget); }
  return budget;
}
function cssStep(selector: string, index?: number): Step {
  const pieces = selector.trim().split(/(\s*>\s*|\s+)/);
  const compounds: Compound[] = [], relations: (' ' | '>')[] = [];
  if (pieces.length > 39) return invalid('CSS 选择器超过 20 层');
  for (let i = 0; i < pieces.length; i++) {
    if (i % 2) { relations.push(pieces[i].includes('>') ? '>' : ' '); continue; }
    let rest = pieces[i];
    const tag = rest.match(/^(\*|[A-Za-z][\w-]*)/);
    if (tag) rest = rest.slice(tag[0].length);
    const attributes: Compound['attributes'] = [];
    while (rest) {
      const simple = rest.match(/^([.#])([A-Za-z_][\w-]*)/);
      const attribute = rest.match(/^\[([A-Za-z_][\w-]*)(?:=(["'])([A-Za-z0-9_/:.-]+)\2)?\]/);
      if (simple) { attributes.push({ name: simple[1] === '.' ? 'class' : 'id', value: simple[2], word: simple[1] === '.' }); rest = rest.slice(simple[0].length); }
      else if (attribute) { attributes.push({ name: attribute[1], value: attribute[3] }); rest = rest.slice(attribute[0].length); }
      else return deny(`不支持的 CSS/经典选择器：${selector.slice(0, 80)}`);
    }
    if (!tag && !attributes.length) return invalid('CSS 选择器含空步骤');
    compounds.push({ tag: tag?.[1].toLowerCase(), attributes });
  }
  return { selector, index, compounds, relations };
}

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
    if (classic) return cssStep(`${classic[1] === 'class' ? '.' : classic[1] === 'id' ? '#' : ''}${classic[2]}`, classic[3] === undefined ? undefined : Number(classic[3]));
    // Restrict CSS to simple compounds with descendant/child combinators. No
    // pseudo-classes, escapes, regex, selector lists or unknown dialect suffixes.
    const atom = /^(?:[A-Za-z][\w-]*|\*)?(?:[.#][A-Za-z_][\w-]*|\[[A-Za-z_][\w-]*(?:=["'][A-Za-z0-9_/:.-]+["'])?\])*$/;
    const compounds = part.trim().split(/\s*>\s*|\s+/);
    if (compounds.length > 20 || compounds.some(c => !c || !atom.test(c)) || /(?:^|@)(?:class|tag|id)\./.test(part)) return deny(`不支持的 CSS/经典选择器：${part.slice(0, 80)}`);
    return cssStep(part);
  });
  if (list && !steps.length) return invalid('列表选择器不能为空');
  return { kind: 'css', steps, output };
}

export function documentContext(body: string): Context {
  if (Buffer.byteLength(body) > RULE_LIMITS.bytes) throw new Error('规则输入超过 2 MiB');
  const budget = new Budget();
  if (/^\s*[\[{]/.test(body)) {
    // Bound JSON structure before allocating objects. Strings and escapes do
    // not count as structural tokens; JSON.parse still checks the full grammar.
    let depth = 0, tokens = 0, quoted = false, escaped = false;
    for (const char of body) {
      if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue; }
      if (char === '"') quoted = true;
      else if (char === '{' || char === '[') { if (++depth > RULE_LIMITS.depth || ++tokens > RULE_LIMITS.nodes) throw new Error('JSON 结构预算超限'); }
      else if (char === '}' || char === ']') depth--;
      else if (char === ',' || char === ':') { if (++tokens > RULE_LIMITS.nodes) throw new Error('JSON 结构预算超限'); }
    }
    let root: any;
    try { root = JSON.parse(body); } catch { throw new Error('响应不是有效 JSON'); }
    const stack = [root];
    while (stack.length) {
      const value = stack.pop();
      if (!value || typeof value !== 'object') continue;
      budgets.set(value, budget);
      for (const key of Object.keys(value)) if (value[key] && typeof value[key] === 'object') stack.push(value[key]);
    }
    return root;
  }
  // The same tokenizer/options as linkedom, without constructing a DOM or an
  // attribute map. Throw before a deep stack, entity fanout, or attribute flood
  // can be allocated by the real DOM parse. Even unmatched closing tags count.
  let tokens = 0;
  for (const char of body) if ((char === '<' || char === '&') && ++tokens > RULE_LIMITS.nodes * 2) throw new Error('HTML 标记/实体预算超限');
  let depth = 0, nodes = 0, attributes = 0;
  const node = () => { if (++nodes > RULE_LIMITS.nodes) throw new Error('DOM 节点预算超限'); };
  new Parser({
    onopentagname(name) { node(); attributes = 0; if (name.length > RULE_LIMITS.name) throw new Error('DOM 名称预算超限'); if (++depth > RULE_LIMITS.depth) throw new Error('DOM 深度超过 128 层'); },
    onattribute(name, value) { node(); if (++attributes > RULE_LIMITS.attributes) throw new Error('单个元素属性超过 128 项'); if (name.length > RULE_LIMITS.name || value.length > RULE_LIMITS.attributeValue) throw new Error('DOM 属性长度预算超限'); },
    onclosetag() { depth--; }, ontext: node, oncomment: node, onprocessinginstruction: node,
  }, { lowerCaseAttributeNames: false, decodeEntities: true, xmlMode: false }).end(body);
  const document = new DOMParser().parseFromString(body, 'text/html');
  budgets.set(document, budget);
  return document;
}
const ignored = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'form', 'noscript']);
const blocks = new Set(['p', 'div', 'li', 'h1', 'h2', 'h3', 'section', 'article']);

/** Pointer walk with O(depth) state, never childNodes/querySelectorAll arrays. */
function* walk(root: Context, budget: Budget, skip: (node: Context) => boolean = () => false): Generator<{ node: Context; exit: boolean }> {
  let node = root.firstChild, depth = 1;
  while (node) {
    budget.spend();
    if (depth > RULE_LIMITS.depth) throw new Error('DOM 深度超过 128 层');
    let prune = skip(node);
    if (!prune) yield { node, exit: false };
    if (!prune && node.firstChild) { node = node.firstChild; depth++; continue; }
    while (node && node !== root) {
      budget.spend();
      if (!prune) yield { node, exit: true };
      if (node.nextSibling) { node = node.nextSibling; break; }
      node = node.parentNode; depth--; prune = false;
    }
    if (node === root) break;
  }
}
function matchesCompound(node: Context, compound: Compound, budget: Budget): boolean {
  budget.spend();
  if (node.nodeType !== 1 || compound.tag && compound.tag !== '*' && node.localName.toLowerCase() !== compound.tag) return false;
  for (const attribute of compound.attributes) {
    budget.spend(RULE_LIMITS.attributes);
    const value = node.getAttribute(attribute.name);
    if (value === null) return false;
    if (attribute.value !== undefined) {
      budget.spend(value.length);
      if (attribute.word ? !new RegExp(`(?:^|\\s)${attribute.value}(?:\\s|$)`).test(value) : value !== attribute.value) return false;
    }
  }
  return true;
}
function matches(node: Context, step: Step, budget: Budget): boolean {
  if (step.compounds.length === 1) return matchesCompound(node, step.compounds[0], budget);
  if (!matchesCompound(node, step.compounds[step.compounds.length - 1], budget)) return false;
  // Dynamic programming over a bounded ancestry path, not recursive selector
  // backtracking. This also handles mixed descendant and child combinators.
  const ancestry = [];
  for (let current = node; current?.nodeType === 1; current = current.parentNode) {
    budget.spend(); if (ancestry.length >= RULE_LIMITS.depth) throw new Error('DOM 深度超过 128 层'); ancestry.push(current);
  }
  let previous = new Array<boolean>(step.compounds.length).fill(false);
  let current = new Array<boolean>(step.compounds.length).fill(false);
  const ancestor = new Array<boolean>(step.compounds.length).fill(false);
  for (let j = ancestry.length - 1; j >= 0; j--) {
    for (let i = 0; i < current.length; i++) {
      budget.spend();
      current[i] = (i === 0 || (step.relations[i - 1] === '>' ? previous[i - 1] : ancestor[i - 1])) && matchesCompound(ancestry[j], step.compounds[i], budget);
    }
    for (let i = 0; i < current.length; i++) ancestor[i] ||= current[i];
    [previous, current] = [current, previous];
  }
  return previous[previous.length - 1];
}
function plain(node: Context, budget: Budget, own = false): string {
  const chunks: string[] = [];
  const append = (text: string) => { budget.output(text.length); chunks.push(text); };
  if (!node?.nodeType) {
    if (typeof node === 'string' || typeof node === 'number') append(String(node));
  } else if (!ignored.has(node.localName?.toLowerCase())) {
    if (own) {
      for (let child = node.firstChild; child; child = child.nextSibling) { budget.spend(); if (child.nodeType === 3) append(child.nodeValue ?? ''); }
    } else {
      for (const item of walk(node, budget, child => ignored.has(child.localName?.toLowerCase()))) {
        if (!item.exit && (item.node.nodeType === 3 || item.node.nodeType === 4)) append(item.node.nodeValue ?? '');
        else if ((!item.exit && item.node.localName === 'br') || item.exit && blocks.has(item.node.localName)) append('\n');
      }
    }
  }
  return chunks.join('').replace(/\r/g, '').trim();
}
export function select(rule: Rule, context: Context, options: { strictJson?: boolean } = {}): Context[] {
  const budget = budgetFor(context);
  let nodes: Context[] = [context];
  if (rule.kind === 'json') {
    if (options.strictJson && isDomNode(context)) throw new Error('JSONPath 列表规则需要 JSON 响应');
    for (const key of rule.path) {
      const next: Context[] = [];
      const add = (value: Context) => { budget.spend(); if (next.length >= RULE_LIMITS.results) throw new Error('规则结果超过 10000 项'); next.push(value); };
      for (const node of nodes) {
        budget.spend();
        if (key === '*') {
          if (Array.isArray(node)) for (const value of node) add(value);
          else if (options.strictJson) throw new Error('JSONPath 列表通配符需要数组');
        } else if (node !== null && typeof node === 'object' && Object.hasOwn(node, key)) add(node[key]);
        else if (options.strictJson && !(typeof key === 'number' && Array.isArray(node))) throw new Error(`JSONPath 列表路径缺少字段或索引：${key}`);
      }
      nodes = next;
    }
    return nodes;
  }
  for (const step of rule.steps) {
    const next: Context[] = [], seen = new Set<Context>(), visited = new Set<Context>();
    for (const root of nodes) {
      if (!isDomNode(root) || ![1, 9, 11].includes(root.nodeType)) throw new Error('CSS 规则需要 HTML 响应');
      let index = 0;
      for (const item of walk(root, budget, node => step.index === undefined && visited.has(node))) {
        if (item.exit) continue;
        const node = item.node;
        if (visited.size >= RULE_LIMITS.nodes && !visited.has(node)) throw new Error('DOM 节点预算超限');
        visited.add(node);
        if (node.nodeType !== 1 || !matches(node, step, budget)) continue;
        if (step.index !== undefined && index++ !== step.index) continue;
        if (!seen.has(node)) { if (next.length >= RULE_LIMITS.results) throw new Error('规则结果超过 10000 项'); seen.add(node); next.push(node); }
        if (step.index !== undefined) break;
      }
    }
    nodes = next;
  }
  return nodes;
}
export function extract(rule: Rule, context: Context): string[] {
  const budget = budgetFor(context), values: string[] = [];
  for (const node of select(rule, context)) {
    let text: string;
    if (rule.kind === 'json') { text = typeof node === 'string' || typeof node === 'number' ? String(node) : ''; budget.output(text.length); }
    else if (rule.output === 'text' || rule.output === 'ownText') text = plain(node, budget, rule.output === 'ownText');
    else { budget.spend(RULE_LIMITS.attributes); text = node.getAttribute?.(rule.output!) ?? ''; budget.output(text.length); }
    if (text.trim()) values.push(text.trim());
  }
  return values;
}

export function template(input: string, key: string, page: number): string {
  if (/[{}]/.test(input.replace(/\{\{(?:key|page)\}\}/g, ''))) throw new RuleError('blocked', '仅支持 {{key}} 和 {{page}} 模板');
  return input.replace(/\{\{key\}\}/g, encodeURIComponent(key)).replace(/\{\{page\}\}/g, String(page));
}
