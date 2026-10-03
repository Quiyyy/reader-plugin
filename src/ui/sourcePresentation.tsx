import React from 'react';
import { stages, type SourceReport } from '../shared/online';

const labels = { search: '搜索', detail: '详情', toc: '目录', content: '正文' };
const syntaxLabels = { supported: '支持', partial: '部分支持', blocked: '已阻止', invalid: '无效' };
const networkLabels = { untested: '未验证', passed: '已通过', failed: '失败' };
export const canSearch = (source: SourceReport) => ['supported', 'partial'].includes(source.syntax) && ['supported', 'partial'].includes(source.stages.search.syntax);
export const canReadRules = (source: SourceReport) => canSearch(source) && stages.every(stage => ['supported', 'partial'].includes(source.stages[stage].syntax));
export function sourceDomain(source: SourceReport) {
  try { return new URL(source.url).hostname; } catch { return '地址待检查'; }
}
export function sourceState(source: SourceReport) {
  if (!canSearch(source)) return { label: '暂不支持', tone: 'unavailable', hint: '查看详情，检查格式与访问要求' };
  if (!canReadRules(source)) return { label: '仅能尝试搜索', tone: 'warning', hint: '详情、目录或正文规则仍不支持，暂不能完成阅读' };
  if (stages.some(stage => source.stages[stage].network === 'failed')) return { label: '最近未成功', tone: 'warning', hint: '可稍后重试，或换一个来源' };
  if (stages.every(stage => source.stages[stage].network === 'passed')) return { label: '最近可用', tone: 'ready', hint: '已成功读取正文' };
  if (source.stages.search.network === 'passed') return { label: '可搜到书', tone: 'ready', hint: '阅读结果以实际打开为准' };
  return { label: '待验证', tone: 'pending', hint: source.enabled ? '找一本书，试试是否可读' : '启用后可尝试找书' };
}

export function SourceStatus({ source, expanded = false }: { source: SourceReport; expanded?: boolean }) {
  return <details className="source-status" open={expanded || undefined}><summary>兼容说明与技术详情</summary>
    <p className="source-url">{source.url}</p>
    {source.diagnostics.map((d, i) => <p key={i} className="source-diagnostic"><code>{d.field}</code>：{d.reason} ({d.status})</p>)}
    <table><caption>规则可以识别，不代表网站一定可用。以下为最近一次检查结果。</caption><thead><tr><th>步骤</th><th>规则</th><th>联网</th></tr></thead><tbody>{stages.map(stage => <React.Fragment key={stage}><tr><th>{labels[stage]}</th><td>{syntaxLabels[source.stages[stage].syntax]}<small>{source.stages[stage].syntax}</small></td><td>{networkLabels[source.stages[stage].network]}<small>{source.stages[stage].network}</small></td></tr>{(source.stages[stage].diagnostics.length > 0 || source.stages[stage].lastError) && <tr><td colSpan={3}>{source.stages[stage].diagnostics.map((d, i) => <p key={i}><code>{d.field}</code>：{d.reason} ({d.status})</p>)}{source.stages[stage].lastError && <p>{source.stages[stage].lastError}</p>}</td></tr>}</React.Fragment>)}</tbody></table>
  </details>;
}
