import { RE2JS } from 're2js';

export interface Replacement { expression: RE2JS; replacement: string; }
export interface OutputBudget { spend(amount?: number): void; output(length: number): void; }
// Pure JS RE2 objects can be garbage-collected; keep only a small LRU cache.
// No source pattern ever reaches the native backtracking RegExp engine.
const expressions = new Map<string, RE2JS | Error>();
export const REPLACEMENT_LIMITS = Object.freeze({ pattern: 512, replacement: 512, input: 131072, output: 262144, matches: 512, expressions: 64, program: 1024 });
function boundedPattern(pattern: string) {
  let escaped = false, depth = 0, bracket = false;
  for (const char of pattern) {
    if (escaped) { escaped = false; continue; }
    if (char === '\\') { escaped = true; continue; }
    if (char === '[') bracket = true;
    else if (char === ']') bracket = false;
    else if (!bracket) {
      // Avoid counted repetition expansion before the compiled-size check.
      if (char === '{' || char === '}') throw new Error('替换暂不支持计数重复或 Unicode 属性组');
      if (char === '(' && ++depth > 16) throw new Error('正则分组超过 16 层');
      if (char === ')') depth--;
    }
  }
}
export function compileReplacement(value: string): Replacement {
  const parts = value.split('##');
  if (parts[0] !== '' || parts.length < 2 || parts.length > 3 || !parts[1] || parts[1].length > REPLACEMENT_LIMITS.pattern || (parts[2]?.length ?? 0) > REPLACEMENT_LIMITS.replacement) throw new Error('替换仅支持 ##正则##字面文本，模式和替换各最多 512 字符');
  const pattern = parts[1], replacement = parts[2] ?? '';
  if (/\$|[{}]/.test(replacement) || /@js:|<\/?js>|javascript:|\{\{/i.test(value)) throw new Error('不支持替换表达式、脚本、捕获组替换或请求选项');
  let expression = expressions.get(pattern);
  if (!expression) {
    try {
      boundedPattern(pattern);
      expression = RE2JS.compile(pattern);
      if (expression.programSize() > REPLACEMENT_LIMITS.program) throw new Error('正则编译大小超过 1024');
    } catch { expression = new Error('正则超限或不属于支持的 RE2 子集；不支持反向引用、环视和计数重复'); }
  }
  expressions.delete(pattern); expressions.set(pattern, expression);
  if (expressions.size > REPLACEMENT_LIMITS.expressions) expressions.delete(expressions.keys().next().value!);
  if (expression instanceof Error) throw expression;
  return { expression, replacement };
}
export function replaceText(value: string, rule: Replacement, budget: OutputBudget): string {
  if (value.length > REPLACEMENT_LIMITS.input) throw new Error('替换输入超过 128 Ki 字符');
  const { expression, replacement } = rule, matcher = expression.matcher(value);
  const chunks: string[] = []; let length = 0, offset = 0, count = 0;
  const append = (part: string) => {
    length += part.length;
    if (length > REPLACEMENT_LIMITS.output) throw new Error('替换输出超过 256 Ki 字符');
    budget.output(part.length); chunks.push(part);
  };
  try {
    for (;;) {
      // A conservative input × compiled-program charge also bounds repeated
      // scans. The page budget is shared with DOM matching and other fields.
      budget.spend((value.length + 1) * expression.programSize());
      if (!matcher.find()) break;
      if (++count > REPLACEMENT_LIMITS.matches) throw new Error('替换匹配次数超过 512');
      append(value.slice(offset, matcher.start())); append(replacement);
      offset = matcher.end();
    }
    append(value.slice(offset));
    return chunks.join('');
  } finally {
    // Retain the small compiled program, not per-pattern DFA/matcher caches.
    // Extraction is synchronous, so no other call can be using these caches.
    expression.reset();
  }
}
