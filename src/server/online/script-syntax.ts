import { parse } from 'acorn';
import { RuleError } from './rules.js';
export const SCRIPT_LIMITS = Object.freeze({ code: 32768, memory: 16 * 1024 * 1024, stack: 512 * 1024, output: 2 * 1024 * 1024, variables: 32768, cpuMs: 500, commandMs: 2000, sessionMs: 60000, calls: 500, requests: 20, networkBytes: 8 * 1024 * 1024 });
export type Part = { kind: 'js' | 'rule'; value: string };
export function chain(input: string): Part[] {
  if (input.length > SCRIPT_LIMITS.code) throw new RuleError('blocked', '规则超过 32 Ki 字符');
  const parts: Part[] = []; let rest = input.trim();
  while (rest) {
    const match = /@js:|<js>/i.exec(rest);
    if (!match) { parts.push({ kind: 'rule', value: rest }); break; }
    if (match.index) parts.push({ kind: 'rule', value: rest.slice(0, match.index).trim() });
    const start = match.index + match[0].length;
    if (match[0].toLowerCase() === '@js:') { parts.push({ kind: 'js', value: rest.slice(start) }); break; }
    const end = rest.toLowerCase().indexOf('</js>', start);
    if (end < 0) throw new RuleError('invalid', '缺少 </js>');
    parts.push({ kind: 'js', value: rest.slice(start, end) }); rest = rest.slice(end + 5).trim();
    if (parts.length > 20) throw new RuleError('blocked', '规则链超过 20 段');
  }
  return parts;
}
export function validateScript(code: string) {
  if (code.length > SCRIPT_LIMITS.code) throw new RuleError('blocked', '脚本超过 32 Ki 字符');
  let root: any;
  try { root = parse(code, { ecmaVersion: 2022, sourceType: 'script' }); } catch { throw new RuleError('invalid', 'JavaScript 语法无效或不属于 ES2022'); }
  const queue = [root]; let count = 0;
  while (queue.length) {
    const node = queue.pop();
    if (++count > 10000) throw new RuleError('blocked', '脚本语法节点超限');
    if (node.type === 'ImportExpression' || node.type === 'Identifier' && ['eval', 'Function', 'AsyncFunction', 'WebAssembly'].includes(node.name)) throw new RuleError('blocked', '不执行动态下载的代码、eval、Function 或模块导入');
    for (const value of Object.values(node)) if (Array.isArray(value)) { for (const item of value) if (item && typeof item === 'object') queue.push(item); } else if (value && typeof value === 'object') queue.push(value);
  }
}
