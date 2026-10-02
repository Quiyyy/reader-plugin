import React, { useEffect, useRef, useState } from 'react';
import type { BookDetail } from '../shared/types';
import { stages, type OnlineApi, type OnlineDetail, type OnlineResult, type SourcePreview, type SourceReport } from '../shared/online';

const labels = { search: '搜索', detail: '详情', toc: '目录', content: '正文' };
const syntaxLabels = { supported: '支持', partial: '部分支持', blocked: '已阻止', invalid: '无效' };
const networkLabels = { untested: '未联网验证', passed: '已通过', failed: '失败' };
export function SourceStatus({ source }: { source: SourceReport }) {
  return <details className="source-status"><summary>{source.name} · {syntaxLabels[source.syntax]} ({source.syntax}) · {source.enabled ? '已启用' : '已停用'}</summary>
    <p className="source-url">{source.url}</p>
    {source.diagnostics.map((d, i) => <p key={i} className="source-diagnostic"><code>{d.field}</code>：{d.reason} ({d.status})</p>)}
    <table><caption>语法与联网结果分别判断；语法支持不代表已验证可用</caption><thead><tr><th>阶段</th><th>语法</th><th>联网</th></tr></thead><tbody>{stages.map(stage => <React.Fragment key={stage}><tr><th>{labels[stage]}</th><td>{syntaxLabels[source.stages[stage].syntax]}<small>{source.stages[stage].syntax}</small></td><td>{networkLabels[source.stages[stage].network]}<small>{source.stages[stage].network}</small></td></tr>{(source.stages[stage].diagnostics.length > 0 || source.stages[stage].lastError) && <tr><td colSpan={3}>{source.stages[stage].diagnostics.map((d, i) => <p key={i}><code>{d.field}</code>：{d.reason} ({d.status})</p>)}{source.stages[stage].lastError && <p role="status">{source.stages[stage].lastError}</p>}</td></tr>}</React.Fragment>)}</tbody></table>
  </details>;
}
export function OnlinePanel({ api, onOpen, onClose }: { api: OnlineApi; onOpen: (book: BookDetail) => void; onClose: () => void }) {
  const [sources, setSources] = useState<SourceReport[]>([]), [preview, setPreview] = useState<SourcePreview | null>(null);
  const [url, setUrl] = useState(''), [sourceId, setSourceId] = useState(''), [key, setKey] = useState(''), [page, setPage] = useState(1);
  const [results, setResults] = useState<OnlineResult[]>([]), [detail, setDetail] = useState<OnlineDetail | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState('');
  const requestRef = useRef<string | null>(null), generation = useRef(0), dialog = useRef<HTMLElement>(null), mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const focused = document.activeElement as HTMLElement;
    dialog.current?.querySelector<HTMLElement>('button')?.focus();
    void api.sources().then(setSources).catch(e => setError(e.message));
    return () => { mounted.current = false; generation.current++; if (requestRef.current) void api.cancel(requestRef.current); focused?.focus(); };
  }, [api]);
  const run = async <T,>(label: string, work: (requestId: string) => Promise<T>, done: (result: T) => void) => {
    const version = ++generation.current, requestId = crypto.randomUUID();
    if (requestRef.current) void api.cancel(requestRef.current);
    requestRef.current = requestId; setBusy(label); setError('');
    try { const result = await work(requestId); if (mounted.current && version === generation.current) done(result); }
    catch (e) { if (mounted.current && version === generation.current) setError(e instanceof Error ? e.message : '操作失败'); }
    finally { if (mounted.current && version === generation.current) { requestRef.current = null; setBusy(''); void api.sources().then(setSources).catch(e => setError(e.message)); } }
  };
  const cancel = () => { generation.current++; if (requestRef.current) void api.cancel(requestRef.current); requestRef.current = null; setBusy(''); setError('已取消'); };
  const search = (nextPage: number) => { setDetail(null); setResults([]); void run('正在搜索', requestId => api.search(sourceId, key, nextPage, requestId), data => { setPage(nextPage); setResults(data); }); };
  const chosen = sources.find(s => s.id === sourceId);
  return <div className="modal-backdrop"><section ref={dialog} className="online-dialog" role="dialog" aria-modal="true" aria-labelledby="online-title" onKeyDown={event => {
    if (event.key === 'Escape') onClose();
    if (event.key !== 'Tab') return;
    const elements = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary')).filter(el => el.getClientRects().length);
    const first = elements[0], last = elements.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }}>
    <div className="panel-heading"><h2 id="online-title">在线书源</h2><button type="button" className="text-button" onClick={onClose}>关闭在线书源</button></div>
    <p>导入 Legado JSON 的无脚本兼容子集。仅用于你有权访问的公开文本；不支持 JS、登录、WebView、验证码绕过或付费 DRM。不会自动获取书源集合。</p>
    <details className="online-import"><summary>导入书源 JSON</summary><label className="online-file">本地书源文件<input type="file" accept=".json,application/json" aria-label="选择书源 JSON" disabled={!!busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void run('正在检查书源', async () => { if (file.size > 512 * 1024) throw new Error('书源文件超过 512 KiB'); return api.preview({ json: await file.text() }); }, setPreview); }} /></label><form onSubmit={event => { event.preventDefault(); void run('正在读取指定 URL', requestId => api.preview({ url, requestId }), setPreview); }}><label>或输入书源 JSON URL<input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" required /></label><button type="submit" className="secondary-button" disabled={!!busy}>预览 URL 导入</button></form><p>仅在点击后读取一次，不订阅更新。最多 512 KiB / 50 个源；同源标准端口访问。非 UTF-8 搜索参数编码不支持。</p></details>
    {preview && <section aria-label="导入预览" className="source-preview"><h3>导入预览 · {preview.sources.length} 个书源</h3><p>新建或替换的源默认停用。替换会重置联网结果，旧版本的书籍缓存与进度保留。</p>{preview.sources.map(s => <div key={s.id}><p>{({ new: '新增', unchanged: '未变化', replace: '替换版本（需要重新启用）' })[preview.changes.find(c => c.id === s.id)!.kind]}</p><p>字段变化：{preview.changes.find(c => c.id === s.id)!.fields.join('、') || '无'}</p><SourceStatus source={s} /></div>)}<button className="secondary-button" disabled={!!busy} onClick={() => void run('正在保存书源', () => api.commit(preview.token), data => { setSources(data); setPreview(null); })}>确认导入这些书源</button><button className="text-button" onClick={() => setPreview(null)}>放弃预览</button></section>}
    {sources.length > 0 && <section aria-label="已保存书源"><h3>管理书源</h3>{sources.map(source => <div className="source-row" key={source.id}><SourceStatus source={source} /><div className="source-actions"><button type="button" className="text-button" disabled={!!busy || !source.enabled && !['supported', 'partial'].includes(source.syntax)} onClick={() => void run('正在更新书源', () => api.setEnabled(source.id, !source.enabled), setSources)}>{source.enabled ? '停用' : '启用'} {source.name}</button><button type="button" className="text-button" disabled={!!busy} onClick={() => void run('正在移除书源', () => api.removeSource(source.id), setSources)}>移除 {source.name}</button></div></div>)}</section>}
    <form className="online-search" onSubmit={event => { event.preventDefault(); search(1); }}><h3>搜索在线书籍</h3><label>书源<select aria-label="搜索书源" value={sourceId} onChange={event => { setSourceId(event.target.value); setResults([]); setDetail(null); }}><option value="">请选择已启用的源</option>{sources.filter(s => s.enabled && ['supported', 'partial'].includes(s.stages.search.syntax)).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label>书名或关键词<input type="search" aria-label="在线搜索关键词" maxLength={200} required value={key} onChange={e => setKey(e.target.value)} /></label><button type="submit" className="secondary-button" disabled={!!busy || !chosen?.enabled || !key.trim()}>搜索</button></form>
    {busy && <div role="status">{busy}… <button type="button" className="text-button" onClick={cancel}>取消联网</button></div>}
    {error && <p className="source-diagnostic" role="alert">{error}</p>}
    {results.length > 0 && <section aria-label="在线搜索结果"><p>第 {page} 页 · {results.length} 本</p>{results.map(result => <button type="button" className="online-result" key={result.url} disabled={!!busy} onClick={() => void run('正在读取详情', requestId => api.detail(result, requestId), setDetail)}><strong>{result.title}</strong><span>{result.author || '佚名'}</span></button>)}<button type="button" className="text-button" disabled={!!busy || page >= 5} onClick={() => search(page + 1)}>下一页搜索（最多 5 页）</button></section>}
    {detail && <section aria-label="在线书籍详情" className="online-detail"><h3>{detail.title}</h3><p>{detail.author || '佚名'}</p><p>{detail.intro || '无简介'}</p><p>读取目录后加入书架，只下载当前章节正文；其余章节按需加载。</p><button className="secondary-button" disabled={!!busy} onClick={() => void run('正在读取目录和首章', requestId => api.add(detail, requestId), onOpen)}>加入书架并阅读</button></section>}
  </section></div>;
}
