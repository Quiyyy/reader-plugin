import { compileRule, documentContext, extract, select, RuleError } from './rules.js';
import { compileReplacement, replaceText } from './replacement.js';
import { chain, validateScript } from './script-syntax.js';
import { ScriptSession, type ScriptGlobals } from './script.js';
const data = (value: any): any => value?.nodeType ? value.toString() : Array.isArray(value) ? value.map(data) : value;
const text = (value: any): string => value === undefined || value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const contextOf = (value: any) => typeof value === 'string' ? documentContext(value) : value;

export function inspectRule(input: string, list = false, replacement = false) {
  let dynamic = false;
  for (const part of chain(input)) {
    if (part.kind === 'js') { if (replacement) throw new RuleError('blocked', 'replaceRegex 仅支持有界 RE2 和模板，不执行脚本'); validateScript(part.value); dynamic = true; continue; }
    let rule = part.value;
    if (rule.includes('{{')) {
      rule = rule.replace(/\{\{([\s\S]*?)\}\}/g, (_match, expression: string) => {
        if (/^(?:@@|\$[.\[])/.test(expression)) compileRule(expression.replace(/^@@/, ''));
        else validateScript(expression);
        return 'X';
      });
      dynamic = true;
      // Interpolated templates are literal output, with optional RE2 cleanup.
      const at = rule.indexOf('##');
      if (at >= 0) compileReplacement(rule.slice(at));
      if (!replacement) continue;
    }
    if (replacement) compileReplacement(rule); else compileRule(rule, list);
  }
  return dynamic;
}
export class RuleEvaluator {
  saveScope: (scope: string) => void = () => {};
  private steps = 0;
  constructor(readonly script: ScriptSession, public globals: ScriptGlobals) {}
  // Each bounded page owns its field work; a long directory must not exhaust
  // a budget intended to stop one hostile document. CPU/session guards remain.
  async beginPage() { this.steps = 0; await this.script.beginPage(); }
  private async interpolate(input: string, context: any, preserveKeyPage = false, regexLiteral = false): Promise<string> {
    let output = '', end = 0;
    for (const match of input.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
      output += input.slice(end, match.index);
      const expression = match[1].trim();
      if (preserveKeyPage && ['key', 'page'].includes(expression)) output += match[0];
      else if (/^(?:@@|\$[.\[])/.test(expression)) output += extract(compileRule(expression.replace(/^@@/, '')), contextOf(context)).join('\n');
      else { const value = text(await this.script.run(expression, data(context), data(context), this.globals)); output += regexLiteral ? value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : value; }
      end = match.index! + match[0].length;
    }
    return output + input.slice(end);
  }
  async url(input: string): Promise<string> {
    let result: any = input;
    for (const part of chain(input)) {
      if (part.kind === 'js') result = await this.script.run(part.value, result, result, this.globals);
      else result = part.value.replace(/@result/g, () => text(result));
    }
    return this.interpolate(text(result), undefined, true);
  }
  async rule(input: string, context: any, list = false): Promise<any[]> {
    if (++this.steps > 15000) throw Error('阶段规则次数超限');
    let result: any = context;
    const parts = chain(input);
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part.kind === 'js') {
        // Scalar extraction is a string; list extraction is an array. Keep
        // source page/row available separately for java.getString.
        const value = Array.isArray(result) && !list && result.length === 1 ? result[0] : result;
        const initial = i === 0 && value && typeof value === 'object' && !value.nodeType ? JSON.stringify(data(value)) : data(value);
        result = await this.script.run(part.value, initial, data(context), this.globals);
      } else {
        const expanded = await this.interpolate(part.value, result);
        if (part.value.includes('{{')) {
          const split = expanded.indexOf('##');
          result = split < 0 ? expanded : this.replace(expanded.slice(0, split), expanded.slice(split));
        } else {
          const ctx = contextOf(result);
          result = list ? select(compileRule(expanded, true), ctx, { strictJson: true }) : extract(compileRule(expanded), ctx);
        }
      }
    }
    if (list) {
      if (Array.isArray(result) && result.length === 1 && Array.isArray(result[0])) result = result[0];
      return (Array.isArray(result) ? result : result == null ? [] : [result]).map(value => typeof value === 'string' ? contextOf(value) : value);
    }
    return (Array.isArray(result) ? result : [result]).filter(v => v !== undefined && v !== null).map(text).filter(v => v.trim());
  }
  async init(input: string, context: any): Promise<any> {
    const rows = await this.rule(input, context, true);
    if (rows.length !== 1) throw new RuleError('blocked', '详情 init 必须返回一个上下文');
    return rows[0];
  }
  private replace(value: string, rule: string) {
    let work = 0, output = 0;
    return replaceText(value, compileReplacement(rule), { spend(n = 1) { if ((work += n) > 2_000_000) throw Error('替换工作预算超限'); }, output(n) { if ((output += n) > 4 * 1024 * 1024) throw Error('替换输出超限'); } });
  }
  async clean(value: string, rule: string, context: any) { return this.replace(value, await this.interpolate(rule, context, false, true)); }
}
