import { DOMParser, Node as DomNode } from 'linkedom';
import { Parser } from 'htmlparser2';
import { compileReplacement, replaceText, type Replacement } from './replacement.js';

export class RuleError extends Error {
  constructor(public readonly status: 'blocked' | 'invalid', message: string) { super(message); }
}
type Context = any;
type Compound = { tag?: string; text?: { value: string; exact: boolean }; attributes: { name: string; value?: string; word?: boolean; suffix?: boolean; negate?: boolean }[] };
type Step = { selector: string; index?: number; exclude?: boolean; children?: boolean; range?: [number, number]; compounds: Compound[]; relations: (' ' | '>')[] };
type XPathStep = { axis: 'descendant' | 'child' | 'following-sibling'; match: Compound; last: boolean };
export type Rule = ({ kind: 'combined'; mode: 'or' | 'and'; rules: Rule[] } | { kind: 'css'; steps: Step[]; output?: string } | { kind: 'xpath'; steps: XPathStep[]; output?: string } | { kind: 'json'; path: (string | number | '*')[] }) & { replacement?: Replacement };
const deny = (message: string): never => { throw new RuleError('blocked', message); };
const invalid = (message: string): never => { throw new RuleError('invalid', message); };
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);
export const RULE_LIMITS = Object.freeze({ bytes: 2 * 1024 * 1024, nodes: 20000, depth: 128, attributes: 128, name: 128, attributeValue: 8192, imageDataAttribute: 65536, results: 10000, work: 2_000_000, text: 4 * 1024 * 1024 });
class Budget {
  private work = 0;
  private text = 0;
  spend(amount = 1) { this.work += amount; if (this.work > RULE_LIMITS.work) throw new Error('规则同步工作预算超限'); }
  output(length: number) { this.text += length; if (this.text > RULE_LIMITS.text) throw new Error('规则文本输出预算超限'); }
}
// A page shares one synchronous budget across all field and per-row evaluations.
const budgets = new WeakMap<object, Budget>();
const attributeWork = new WeakMap<object, number>();
const isDomNode = (value: unknown): boolean => value instanceof DomNode;
function budgetFor(context: Context): Budget {
  if (context && typeof context === 'object' && budgets.has(context)) return budgets.get(context)!;
  const owner = isDomNode(context) ? context.ownerDocument ?? context : context;
  if (!owner || typeof owner !== 'object') return new Budget();
  let budget = budgets.get(owner);
  if (!budget) { budget = new Budget(); budgets.set(owner, budget); }
  return budget;
}
const outputs = new Set(['text', 'ownText', 'textNodes', 'html', 'href', 'src', 'content', 'title', 'value', 'alt', 'onclick', 'data-bid', 'data-src']);
function cssStep(selector: string, index?: number, exclude = false): Step {
  const compounds: Compound[] = [], relations: (' ' | '>')[] = [];
  let rest = selector.trim();
  if (!rest) return invalid('CSS 选择器不能为空');
  while (rest) {
    const tag = rest.match(/^(\*|[A-Za-z][\w-]*)/);
    if (tag) rest = rest.slice(tag[0].length);
    const attributes: Compound['attributes'] = [];
    while (rest && !/^[\s>]/.test(rest)) {
      const simple = rest.match(/^([.#])([A-Za-z_][\w-]*)/);
      const attribute = rest.match(/^(:(?:not)\()?\[([A-Za-z_][\w-]*)(?:(\$?=)(?:(["'])([^"'\[\]\r\n]*)\4|([A-Za-z0-9_:#/.-]+)))?\](\))?/);
      if (simple) { attributes.push({ name: simple[1] === '.' ? 'class' : 'id', value: simple[2], word: simple[1] === '.' }); rest = rest.slice(simple[0].length); }
      else if (attribute && Boolean(attribute[1]) === Boolean(attribute[7])) {
        attributes.push({ name: attribute[2], value: attribute[5] ?? attribute[6], suffix: attribute[3] === '$=', negate: !!attribute[1] }); rest = rest.slice(attribute[0].length);
      } else return deny('不支持的 CSS/经典选择器；仅支持简单属性和 :not([属性])');
    }
    if (!tag && !attributes.length) return invalid('CSS 选择器含空步骤');
    compounds.push({ tag: tag?.[1].toLowerCase(), attributes });
    if (compounds.length > 20) return invalid('CSS 选择器超过 20 层');
    if (!rest) break;
    const separator = rest.match(/^\s*>\s*|^\s+/)!;
    relations.push(separator[0].includes('>') ? '>' : ' '); rest = rest.slice(separator[0].length);
    if (!rest) return invalid('CSS 选择器含空步骤');
  }
  return { selector, index, exclude, compounds, relations };
}
function xpath(rule: string, list: boolean): Rule {
  // Whole-input grammar for the paths consumed by reading stages. last() and
  // following-sibling support chapter lists after the final volume heading;
  // no expression evaluator, arbitrary axes, extension functions or scripts.
  const attribute = rule.match(/\/@([A-Za-z_][\w-]*)$/);
  const output = attribute?.[1] ?? 'text';
  if (list && attribute || !outputs.has(output)) return deny('XPath 只支持元素路径及受支持的末尾属性');
  let rest = attribute ? rule.slice(0, attribute.index) : rule;
  if (!rest.startsWith('//')) return deny('XPath 路径须以 // 开始');
  const steps: XPathStep[] = [];
  while (rest) {
    const step = rest.match(/^(\/\/|\/following-sibling::|\/)([A-Za-z][\w-]*)(?:\[(?:@([A-Za-z_][\w-]*)|text\(\))=(["'])([^"'\[\]\r\n]*)\4\]|\[(last\(\))\])?/);
    if (!step) return deny('不支持此 XPath；仅支持路径、相等条件、last() 与 following-sibling 元素轴');
    steps.push({ axis: step[1] === '//' ? 'descendant' : step[1].includes('following-sibling') ? 'following-sibling' : 'child', last: !!step[6], match: { tag: step[2].toLowerCase(), attributes: step[3] ? [{ name: step[3], value: step[5] }] : [], text: step[5] !== undefined && !step[3] ? { value: step[5], exact: true } : undefined } });
    if (steps.length > 20) return invalid('XPath 超过 20 层');
    rest = rest.slice(step[0].length);
  }
  return { kind: 'xpath', steps, output: list ? undefined : output };
}

/** A grammar, not a JavaScript evaluator. The whole input must be recognized. */
export function compileRule(input: string, list = false): Rule {
  if (!input.trim() || input.length > 2048) return invalid('规则为空或超过 2048 字符');
  let rule = input.trim();
  if (/@js:|<\/?js>|javascript:|\{\{|@(?:get|put|json):/i.test(rule)) return deny('此字段需要脚本、模板表达式、组合或变量规则，暂不支持');
  for (const [token, mode] of [['||', 'or'], ['&&', 'and']] as const) {
    if (rule.includes(token)) {
      const parts = rule.split(token);
      if (parts.length > 10) return deny('组合规则超过 10 项');
      return { kind: 'combined', mode, rules: parts.map(part => compileRule(part, list)) };
    }
  }
  if (/^@?css:/.test(rule) && rule.includes(',')) {
    const at = rule.lastIndexOf('@'), selector = rule.slice(0, list ? undefined : at).replace(/^@?css:/, '');
    if (selector.split(',').length > 10) return deny('CSS 组合超过 10 项');
    return { kind: 'combined', mode: 'and', rules: selector.split(',').map(part => compileRule(part + (list ? '' : rule.slice(at)), list)) };
  }
  let replacement: Replacement | undefined;
  const split = rule.indexOf('##');
  if (split >= 0) {
    if (list) return deny('列表规则不支持文本替换');
    try { replacement = compileReplacement(rule.slice(split)); } catch (error) { return deny((error as Error).message); }
    rule = rule.slice(0, split);
  }
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
    return { kind: 'json', path, replacement };
  }
  if (rule.startsWith('//')) return { ...xpath(rule, list), replacement };
  rule = rule.replace(/^@?css:/i, '');
  const parts = rule.split('@');
  let output: string | undefined;
  if (!list) {
    output = parts.pop();
    if (!output || !outputs.has(output)) return deny('文本规则需以 text/html/textNodes 或受支持属性结尾；HTML 仅提取纯文本');
  }
  if (parts.length > 20) return invalid('选择器链超过 20 层');
  const rootText = !list && parts.length === 1 && parts[0] === '';
  if (!rootText && parts.some(part => !part)) return invalid('选择器链含空步骤');
  const steps: Step[] = (rootText ? [] : parts).map(part => {
    const range = part.match(/^(.*)\[(-?\d{1,5}):(-?\d{1,5})\]$/);
    if (range) {
      const inner = compileRule(range[1], true);
      if (inner.kind !== 'css' || inner.steps.length !== 1) return deny('切片只支持单选择器');
      return { ...inner.steps[0], range: [Number(range[2]), Number(range[3])] as [number, number] };
    }
    const classic = part.match(/^(class|tag|id)\.([A-Za-z_][\w-]*)(?:\.(!?)(-?\d{1,5}))?$/);
    if (classic) return cssStep(`${classic[1] === 'class' ? '.' : classic[1] === 'id' ? '#' : ''}${classic[2]}`, classic[4] === undefined ? undefined : Number(classic[4]), !!classic[3]);
    const children = part.match(/^children(?:\[(-?\d{1,5})\])?$/);
    if (children) return { ...cssStep('*', children[1] === undefined ? undefined : Number(children[1])), children: true };
    const text = part.match(/^text\.([^@\[\]{}]+?)(?:\.(-?\d{1,5}))?$/);
    if (text) return { ...cssStep('*', text[2] === undefined ? undefined : Number(text[2])), compounds: [{ attributes: [], text: { value: text[1], exact: false } }] };
    if (/^(class|tag|id|text)\./.test(part)) return deny('不支持此经典选择器索引或切片');
    const indexed = part.match(/^(.*?)(?:\.(-?\d{1,5})|!(-?\d{1,5}))$/);
    return indexed ? cssStep(indexed[1], Number(indexed[2] ?? indexed[3]), indexed[3] !== undefined) : cssStep(part);
  });
  if (list && !steps.length) return invalid('列表选择器不能为空');
  return { kind: 'css', steps, output, replacement };
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
  let depth = 0, nodes = 0, attributes = 0, tag = '';
  const node = () => { if (++nodes > RULE_LIMITS.nodes) throw new Error('DOM 节点预算超限'); };
  new Parser({
    onopentagname(name) { node(); attributes = 0; tag = name.toLowerCase(); if (name.length > RULE_LIMITS.name) throw new Error('DOM 名称预算超限'); if (++depth > RULE_LIMITS.depth) throw new Error('DOM 深度超过 128 层'); },
    onattribute(name, value) {
      node(); if (++attributes > RULE_LIMITS.attributes) throw new Error('单个元素属性超过 128 项');
      // Some metadata pages embed a small cover/icon in an img src. It remains
      // inert data: no decoding, display or fetch, and the 2 MiB page cap still
      // applies. Keep all other attributes (including SVG/active URIs) at 8 KiB.
      const bitmap = value.length <= RULE_LIMITS.imageDataAttribute && tag === 'img' && name.toLowerCase() === 'src' && /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+=*$/.test(value);
      if (name.length > RULE_LIMITS.name || value.length > (bitmap ? RULE_LIMITS.imageDataAttribute : RULE_LIMITS.attributeValue)) throw new Error('DOM 属性长度预算超限');
    },
    onclosetag() { depth--; }, ontext: node, oncomment: node, onprocessinginstruction: node,
  }, { lowerCaseAttributeNames: false, decodeEntities: true, xmlMode: false }).end(body);
  const document = new DOMParser().parseFromString(body, 'text/html');
  // linkedom retains table > tr whereas HTML parsing implies a tbody. Source
  // selectors written against browser/Jsoup trees consume that missing node.
  // Normalize this bounded, common omitted-tag case only; this is not a full
  // HTML5 tree builder and never executes page scripts or follows resources.
  for (const table of document.querySelectorAll('table')) {
    let group: ReturnType<typeof document.createElement> | undefined;
    for (const child of [...table.childNodes]) {
      budget.spend();
      if (child.nodeType === 1 && (child as any).localName === 'tr') {
        if (!group) { node(); group = document.createElement('tbody', {}); table.insertBefore(group, child); }
        group.appendChild(child);
      } else if (child.nodeType === 1) group = undefined;
      else if (group) group.appendChild(child);
    }
  }
  // Implied elements also count toward depth; nested tables may otherwise
  // grow beyond the tokenizer's pre-allocation depth ceiling.
  const pending: { node: any; depth: number }[] = [{ node: document, depth: 0 }];
  while (pending.length) {
    const item = pending.pop()!; budget.spend();
    if (item.depth > RULE_LIMITS.depth) throw new Error('DOM 深度超过 128 层');
    if (item.node.nodeType === 1) {
      const count = item.node.attributes.length; budget.spend(count);
      attributeWork.set(item.node, count + 1);
    }
    for (const child of item.node.childNodes) pending.push({ node: child, depth: item.depth + (child.nodeType === 1 ? 1 : 0) });
  }
  budgets.set(document, budget);
  return document;
}
const ignored = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'form', 'noscript']);
const blocks = new Set(['p', 'div', 'li', 'h1', 'h2', 'h3', 'section', 'article']);

/** Pointer walk with O(depth) state, never childNodes/querySelectorAll arrays. */
function* walk(root: Context, budget: Budget, skip: (node: Context) => boolean = () => false): Generator<{ node: Context; exit: boolean }> {
  // linkedom's DocumentType has no sibling/parent links. Start document walks
  // at the element root so an HTML doctype cannot hide the entire page.
  let node = root.nodeType === 9 ? root.documentElement ?? root.firstChild : root.firstChild, depth = 1;
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
    budget.spend(attributeWork.get(node) ?? RULE_LIMITS.attributes);
    const value = node.getAttribute(attribute.name);
    let matched = value !== null;
    if (matched && attribute.value !== undefined) {
      budget.spend(value.length);
      matched = attribute.word ? value.split(/\s+/).includes(attribute.value) : attribute.suffix ? value.endsWith(attribute.value) : value === attribute.value;
    }
    if (attribute.negate ? matched : !matched) return false;
  }
  if (compound.text) {
    const value = plain(node, budget, true).replace(/\s+/g, ' ');
    budget.spend(value.length + compound.text.value.length);
    if (compound.text.exact ? value !== compound.text.value : !value.includes(compound.text.value)) return false;
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
function plain(node: Context, budget: Budget, own = false, textNodes = false): string {
  const chunks: string[] = [];
  const append = (text: string) => { budget.output(text.length); chunks.push(text); };
  if (!node?.nodeType) {
    if (typeof node === 'string' || typeof node === 'number') append(String(node));
  } else if (!ignored.has(node.localName?.toLowerCase())) {
    if (own) {
      for (let child = node.firstChild; child; child = child.nextSibling) { budget.spend(); if (child.nodeType === 3) { append(child.nodeValue ?? ''); if (textNodes) append('\n'); } }
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
  if (rule.kind === 'combined') {
    const values = [];
    for (const item of rule.rules) {
      const selected = select(item, context, options);
      values.push(...selected);
      if (values.length > RULE_LIMITS.results) throw Error('组合结果超限');
      if (rule.mode === 'or' && selected.length) break;
    }
    return [...new Set(values)];
  }
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
  if (rule.kind === 'xpath') {
    const order = new Map<Context, number>();
    if (isDomNode(context)) for (const item of walk(context.ownerDocument ?? context, budget)) if (!item.exit) order.set(item.node, order.size);
    for (const step of rule.steps) {
      const next = new Set<Context>();
      for (const root of nodes) {
        if (!isDomNode(root) || ![1, 9, 11].includes(root.nodeType)) throw new Error('XPath 规则需要 HTML 响应');
        const candidates: Context[] = [];
        const add = (node: Context) => {
          if (ignored.has(node.localName?.toLowerCase()) || !matchesCompound(node, step.match, budget)) return;
          if (candidates.length >= RULE_LIMITS.results) throw new Error('规则结果超过 10000 项');
          candidates.push(node);
        };
        if (step.axis === 'descendant') {
          for (const item of walk(root, budget, node => ignored.has(node.localName?.toLowerCase()))) if (!item.exit) add(item.node);
        } else {
          for (let node = step.axis === 'child' ? root.firstChild : root.nextSibling; node; node = node.nextSibling) { budget.spend(); add(node); }
        }
        // //x[last()] is the last x child of each parent, not a global last x.
        const last = new Map<Context, Context>();
        if (step.last) for (const node of candidates) { budget.spend(); last.set(node.parentNode, node); }
        for (const node of candidates) {
          budget.spend();
          if (step.last && last.get(node.parentNode) !== node) continue;
          next.add(node); if (next.size > RULE_LIMITS.results) throw new Error('规则结果超过 10000 项');
        }
      }
      nodes = [...next].sort((a, b) => { budget.spend(); return order.get(a)! - order.get(b)!; });
    }
    return nodes;
  }
  for (const step of rule.steps) {
    const next: Context[] = [], seen = new Set<Context>(), visited = new Set<Context>();
    for (const root of nodes) {
      if (!isDomNode(root) || ![1, 9, 11].includes(root.nodeType)) throw new Error('CSS 规则需要 HTML 响应');
      const candidates: Context[] = [];
      const indexed = step.index !== undefined;
      for (const item of walk(root, budget, node => ignored.has(node.localName?.toLowerCase()) || (!indexed && visited.has(node)) || !!step.children && node.parentNode !== root)) {
        if (item.exit) continue;
        const node = item.node;
        if (visited.size >= RULE_LIMITS.nodes && !visited.has(node)) throw new Error('DOM 节点预算超限');
        visited.add(node);
        if (node.nodeType !== 1 || !matches(node, step, budget)) continue;
        if (candidates.length >= RULE_LIMITS.results) throw new Error('规则结果超过 10000 项');
        candidates.push(node);
        if (indexed && !step.exclude && step.index! >= 0 && candidates.length > step.index!) break;
      }
      const index = indexed ? (step.index! < 0 ? candidates.length + step.index! : step.index!) : undefined;
      const rangeStart = step.range ? (step.range[0] < 0 ? candidates.length + step.range[0] : step.range[0]) : 0;
      const rangeEnd = step.range ? (step.range[1] < 0 ? candidates.length + step.range[1] : step.range[1]) : candidates.length - 1;
      const order = step.range && rangeStart > rangeEnd ? [...candidates.keys()].reverse() : [...candidates.keys()];
      for (const i of order) {
        if (step.range && (i < Math.min(rangeStart, rangeEnd) || i > Math.max(rangeStart, rangeEnd))) continue;
        budget.spend();
        if (index !== undefined && (step.exclude ? i === index : i !== index)) continue;
        const node = candidates[i];
        if (!seen.has(node)) { if (next.length >= RULE_LIMITS.results) throw new Error('规则结果超过 10000 项'); seen.add(node); next.push(node); }
      }
    }
    nodes = next;
  }
  return nodes;
}
export function extract(rule: Rule, context: Context): string[] {
  if (rule.kind === 'combined') {
    const values: string[] = [];
    for (const item of rule.rules) { const selected = extract(item, context); values.push(...selected); if (rule.mode === 'or' && selected.length) break; }
    return values;
  }
  const budget = budgetFor(context), values: string[] = [];
  for (const node of select(rule, context)) {
    let text: string;
    if (rule.kind === 'json') { text = typeof node === 'string' || typeof node === 'number' ? String(node) : ''; budget.output(text.length); }
    else if (['text', 'html', 'ownText', 'textNodes'].includes(rule.output!)) text = plain(node, budget, rule.output === 'ownText' || rule.output === 'textNodes', rule.output === 'textNodes');
    else { budget.spend(attributeWork.get(node) ?? RULE_LIMITS.attributes); text = node.getAttribute?.(rule.output!) ?? ''; budget.output(text.length); }
    if (rule.replacement) text = replaceText(text, rule.replacement, budget);
    if (text.trim()) values.push(text.trim());
  }
  return values;
}

export function template(input: string, key: string, page: number): string {
  if (/[{}]/.test(input.replace(/\{\{(?:key|page)\}\}/g, ''))) throw new RuleError('blocked', '仅支持 {{key}} 和 {{page}} 模板');
  return input.replace(/\{\{key\}\}/g, encodeURIComponent(key)).replace(/\{\{page\}\}/g, String(page));
}

export function cleanContent(value: string, replacement: string, context: Context): string {
  return replaceText(value, compileReplacement(replacement), budgetFor(context));
}
