import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Check, FileUp, LoaderCircle, Search, Settings2, X } from 'lucide-react';
import type { BookDetail } from '../shared/types';
import { stages, type OnlineApi, type OnlineDetail, type OnlineResult, type SourcePreview, type SourceReport } from '../shared/online';

const labels = { search: '搜索', detail: '详情', toc: '目录', content: '正文' };
const syntaxLabels = { supported: '支持', partial: '部分支持', blocked: '已阻止', invalid: '无效' };
const networkLabels = { untested: '未联网验证', passed: '已通过', failed: '失败' };
const canSearch = (s: SourceReport) => ['supported', 'partial'].includes(s.syntax) && ['supported', 'partial'].includes(s.stages.search.syntax);
const messageOf = (error: unknown) => error instanceof Error ? error.message : '暂时无法完成，请重试。';
function sourceSummary(source: SourceReport) {
  if (!canSearch(source)) return '暂不能找书，请查看兼容说明';
  const failed = stages.filter(stage => source.stages[stage].network === 'failed');
  if (failed.length) return `最近${failed.map(stage => labels[stage]).join('、')}未成功，可稍后重试`;
  if (stages.every(stage => source.stages[stage].network === 'passed')) return '最近已成功读到正文';
  if (source.stages.search.network === 'passed') return '搜索已成功，阅读仍需验证';
  return '尚未联网验证';
}

export function SourceStatus({ source }: { source: SourceReport }) {
  return <details className="source-status"><summary>兼容说明与技术详情</summary>
    <p className="source-url">{source.url}</p>
    {source.diagnostics.map((d, i) => <p key={i} className="source-diagnostic"><code>{d.field}</code>：{d.reason} ({d.status})</p>)}
    <table><caption>规则可以识别，不代表网站一定可用。以下为最近一次检查结果。</caption><thead><tr><th>步骤</th><th>规则</th><th>联网</th></tr></thead><tbody>{stages.map(stage => <React.Fragment key={stage}><tr><th>{labels[stage]}</th><td>{syntaxLabels[source.stages[stage].syntax]}<small>{source.stages[stage].syntax}</small></td><td>{networkLabels[source.stages[stage].network]}<small>{source.stages[stage].network}</small></td></tr>{(source.stages[stage].diagnostics.length > 0 || source.stages[stage].lastError) && <tr><td colSpan={3}>{source.stages[stage].diagnostics.map((d, i) => <p key={i}><code>{d.field}</code>：{d.reason} ({d.status})</p>)}{source.stages[stage].lastError && <p>{source.stages[stage].lastError}</p>}</td></tr>}</React.Fragment>)}</tbody></table>
  </details>;
}

type Failure = { source: SourceReport; message: string };
type ImportStep = 'choose' | 'review' | 'saved' | null;
export function OnlinePanel({ api, active, onOpen, onClose }: { api: OnlineApi; active: boolean; onOpen: (book: BookDetail) => void; onClose: () => void }) {
  const [sources, setSources] = useState<SourceReport[]>([]), [sourceError, setSourceError] = useState(''), [sourcesLoading, setSourcesLoading] = useState(true);
  const [view, setView] = useState<'find' | 'sources'>('find');
  const [step, setStep] = useState<ImportStep>(null), [preview, setPreview] = useState<SourcePreview | null>(null), [savedIds, setSavedIds] = useState<string[]>([]);
  const [url, setUrl] = useState(''), [sourceId, setSourceId] = useState(''), [key, setKey] = useState(''), [page, setPage] = useState(1);
  const [results, setResults] = useState<OnlineResult[]>([]), [failures, setFailures] = useState<Failure[]>([]), [detail, setDetail] = useState<OnlineDetail | null>(null);
  const [searched, setSearched] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(''), [cancellable, setCancellable] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const requests = useRef(new Set<string>()), generation = useRef(0), busyRef = useRef(false), mounted = useRef(true);
  const main = useRef<HTMLElement>(null), dialog = useRef<HTMLElement>(null), wizardTrigger = useRef<HTMLElement | null>(null), resultTrigger = useRef('');
  const retry = useRef<(() => void) | null>(null), scrollTop = useRef(0), sourceGeneration = useRef(0);
  const focusPage = () => (main.current?.querySelector<HTMLElement>('[data-page-focus]:not(:disabled)') || main.current?.querySelector<HTMLElement>('h1'))?.focus();
  const enabled = sources.filter(s => s.enabled && canSearch(s));
  const refreshSources = async () => {
    const version = ++sourceGeneration.current;
    try { const data = await api.sources(); if (mounted.current && version === sourceGeneration.current) { setSources(data); setSourceError(''); } }
    catch (e) { if (mounted.current && version === sourceGeneration.current) setSourceError(messageOf(e)); }
    finally { if (mounted.current && version === sourceGeneration.current) setSourcesLoading(false); }
  };
  const abortRequests = () => {
    generation.current++;
    requests.current.forEach(id => { void api.cancel(id).catch(() => {}); }); requests.current.clear();
    busyRef.current = false; setBusy(''); setCancellable(false);
  };
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current++; requests.current.forEach(id => { void api.cancel(id).catch(() => {}); }); };
  }, [api]);
  useEffect(() => {
    if (active) void refreshSources();
    else { abortRequests(); setStep(null); setPreview(null); }
  }, [active, api]);
  // This component stays mounted while reading so query, results and detail survive.
  useLayoutEffect(() => {
    if (active) focusPage();
  }, [active, view, !!detail]);
  useLayoutEffect(() => {
    if (step) dialog.current?.querySelector<HTMLElement>('[data-wizard-focus]')?.focus();
  }, [step]);
  useEffect(() => {
    if (sourceId && !enabled.some(s => s.id === sourceId)) setSourceId('');
  }, [sources, sourceId]);

  const run = async <T,>(label: string, work: (request: () => string, current: () => boolean) => Promise<T>, done: (value: T) => void, network = true) => {
    if (busyRef.current) return;
    busyRef.current = true;
    sourceGeneration.current++;
    const version = ++generation.current;
    const current = () => mounted.current && version === generation.current;
    const request = () => { const id = crypto.randomUUID(); requests.current.add(id); return id; };
    setBusy(label); setCancellable(network); setError(''); setNotice(''); retry.current = () => { void run(label, work, done, network); };
    try { const value = await work(request, current); if (current()) done(value); }
    catch (e) { if (current()) setError(messageOf(e)); }
    finally { if (current()) { requests.current.clear(); busyRef.current = false; setBusy(''); setCancellable(false); void refreshSources(); } }
  };
  const cancel = () => { abortRequests(); setError(''); setNotice('已取消，可以重新尝试。'); };
  const leave = () => { if (busyRef.current && !cancellable) return; abortRequests(); setError(''); onClose(); };
  const closeWizard = () => {
    if (busyRef.current && !cancellable) return;
    abortRequests(); setStep(null); setPreview(null); setError(''); setNotice('');
    requestAnimationFrame(() => { if (wizardTrigger.current?.isConnected) wizardTrigger.current.focus(); else focusPage(); });
  };
  const openWizard = () => {
    wizardTrigger.current = document.activeElement as HTMLElement;
    setPreview(null); setSavedIds([]); setError(''); setNotice(''); setUrl(''); setStep('choose');
  };
  const resetSearch = () => { setSearched(false); setPage(1); setResults([]); setFailures([]); setDetail(null); setError(''); setNotice(''); };
  const search = (nextPage: number, only?: SourceReport[]) => {
    const targets = only || (sourceId ? enabled.filter(s => s.id === sourceId) : enabled);
    if (!targets.length || !key.trim() || busyRef.current) return;
    setDetail(null); setPage(nextPage); setSearched(false); setFailures([]);
    if (!only) setResults([]);
    const retained = only ? results.filter(r => !targets.some(s => s.id === r.sourceId)) : [];
    void run('正在找书', async (request, current) => {
      const found = [...retained], errors: Failure[] = []; let cursor = 0;
      // At most three sources in flight; cancellation also prevents queued work.
      await Promise.all(Array.from({ length: Math.min(3, targets.length) }, async () => {
        while (cursor < targets.length && current()) {
          const source = targets[cursor++];
          try {
            const data = await api.search(source.id, key.trim(), nextPage, request());
            if (!current()) return;
            for (const item of data) if (!found.some(r => r.sourceId === item.sourceId && r.url === item.url)) found.push(item);
            setResults([...found]);
          } catch (e) { if (current()) { errors.push({ source, message: messageOf(e) }); setFailures([...errors]); } }
        }
      }));
      return { found, errors };
    }, data => { setResults(data.found); setFailures(data.errors); setSearched(true); });
  };
  const backToResults = () => {
    if (busyRef.current && !cancellable) return;
    abortRequests(); setDetail(null); setError(''); setNotice('');
    requestAnimationFrame(() => { if (main.current) main.current.scrollTop = scrollTop.current; Array.from(main.current?.querySelectorAll<HTMLElement>('[data-result]') || []).find(el => el.dataset.result === resultTrigger.current)?.focus(); });
  };
  const status = <>{busy && <div className="online-progress" role="status"><LoaderCircle size={16} className="spin" /><span>{busy}…</span>{cancellable && <button className="text-button" onClick={cancel}>取消</button>}</div>}{notice && <p className="online-notice" role="status">{notice}</p>}{error && <div className="error-notice" role="alert"><span>{error}</span><button className="text-button" disabled={!!busy} onClick={() => retry.current?.()}>重试</button></div>}</>;
  if (!active) return null;
  return <main className="discovery-shell" ref={main} aria-label="找书与书源" onKeyDown={event => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); if (step) closeWizard(); else if (detail) backToResults(); else if (view === 'sources') setView('find'); else leave(); }
  }}>
    <div className="discovery-content" inert={!!step}>
      <nav className="library-navigation" aria-label="Reader 导航"><button onClick={leave} disabled={!!busy && !cancellable}>书架</button><button aria-current={view === 'find' ? 'page' : undefined} onClick={() => { if (!busyRef.current) setView('find'); }} disabled={!!busy}>找书</button><button className="source-entry" aria-current={view === 'sources' ? 'page' : undefined} disabled={!!busy} onClick={() => { setView('sources'); setError(''); setNotice(''); }}><Settings2 size={14} />管理书源</button></nav>
      {view === 'sources' ? <>
        <div className="discovery-heading"><div><h1 tabIndex={-1} data-page-focus>书源管理</h1><p>选择找书的来源，阅读进度仍保存在书架。</p></div><button className="primary-button" onClick={openWizard} disabled={!!busy}><FileUp size={16} />导入书源</button></div>
        {!step && status}
        {sourceError && <div role="alert" className="error-notice"><span>书源列表未能加载：{sourceError}</span><button className="text-button" onClick={() => void refreshSources()}>重新加载</button></div>}
        {sourcesLoading ? <p role="status">正在读取书源…</p> : sources.length === 0 ? <div className="discovery-empty"><BookOpen size={30} /><h2>还没有书源</h2><p>书源告诉 Reader 去哪里找书。导入你信任的书源文件或链接，即可开始。</p><button className="secondary-button" onClick={openWizard}>导入第一个书源</button><button className="text-button" onClick={leave}>返回书架，导入 TXT / EPUB</button></div> : <section aria-label="已保存书源" className="source-list"><p className="section-caption">{sources.length} 个已保存 · {enabled.length} 个已启用用于找书</p>{sources.map(source => <article className="source-row" key={source.id}><div className="source-row-heading"><strong>{source.name}</strong><span className={`source-badge ${source.enabled ? 'enabled' : ''}`}>{source.enabled ? '已启用' : '未启用'}</span></div><p>{sourceSummary(source)}</p><SourceStatus source={source} /><div className="source-actions"><button className="text-button" disabled={!!busy || !source.enabled && !canSearch(source)} onClick={() => void run('正在更新书源', () => api.setEnabled(source.id, !source.enabled), setSources, false)}>{source.enabled ? '停用' : '启用'} {source.name}</button><button className="text-button" disabled={!!busy} onClick={() => setPendingRemove(source.id)}>移除 {source.name}</button></div>{pendingRemove === source.id && <div className="source-remove"><p>移除后仍可阅读已缓存章节；新章节需要重新导入并启用相同书源。</p><button className="secondary-button" disabled={!!busy} onClick={() => void run('正在移除书源', () => api.removeSource(source.id), data => { setSources(data); setPendingRemove(null); }, false)}>确认移除</button><button className="text-button" disabled={!!busy} onClick={() => setPendingRemove(null)}>保留书源</button></div>}</article>)}</section>}
        <details className="source-boundaries"><summary>支持哪些书源？</summary><p>支持部分 Legado JSON 书源，供你阅读有权访问的公开文本。需要运行脚本、登录、验证码或付费解锁的来源暂不能使用；Reader 不会绕过访问限制，也不会自动搜集书源。</p><p>网站变化可能让书源失效。启用只代表参与搜索，实际可用性以搜索和阅读结果为准。</p></details>
      </> : detail ? <>
        <button className="text-button detail-back" data-page-focus onClick={backToResults} disabled={!!busy && !cancellable}><ArrowLeft size={16} />返回搜索结果</button>
        <section aria-label="在线书籍详情" className="online-detail"><div className="detail-book-icon" aria-hidden="true"><BookOpen size={35} strokeWidth={1.2} /></div><p className="section-caption">来自 {sources.find(s => s.id === detail.sourceId)?.name || '已移除的书源'}</p><h1>{detail.title}</h1><p>{detail.author || '佚名'}</p><button className="primary-button" disabled={!!busy} onClick={() => void run('正在打开目录和首章', request => api.add(detail, request()), onOpen)}>开始阅读 <ArrowRight size={16} /></button><p className="section-caption">自动加入书架并记住位置，章节在阅读时加载。</p><p className="book-intro">{detail.intro || '这本书暂时没有简介。'}</p></section>{status}
      </> : <>
        <div className="discovery-heading"><div><h1 tabIndex={-1}>找一本想读的书</h1><p>输入书名或关键词，从已启用的书源查找。</p></div></div>
        <form className="online-search" onSubmit={event => { event.preventDefault(); search(1); }}><label className="discovery-query"><Search size={18} /><input data-page-focus type="search" aria-label="在线搜索关键词" placeholder="书名或关键词" maxLength={200} required disabled={!!busy || !enabled.length} value={key} onChange={e => { setKey(e.target.value); resetSearch(); }} /></label><button type="submit" className="primary-button" disabled={!!busy || !enabled.length || !key.trim()}>搜索</button><label className="source-filter">搜索范围<select aria-label="搜索书源" disabled={!!busy || !enabled.length} value={sourceId} onChange={e => { setSourceId(e.target.value); resetSearch(); }}><option value="">全部已启用书源（{enabled.length}）</option>{enabled.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label></form>
        {sourceError && <div className="error-notice" role="alert"><span>书源列表未能加载。</span><button className="text-button" onClick={() => void refreshSources()}>重新加载</button></div>}
        {sourcesLoading ? <p role="status">正在读取书源…</p> : !enabled.length && !sourceError ? <div className="discovery-empty"><BookOpen size={30} /><h2>{sources.length ? '还没有启用的书源' : '先添加一个找书的来源'}</h2><p>{sources.length ? '已保存不等于已启用。到书源管理中启用兼容的来源，就可以搜索。' : '导入你信任的书源文件或链接。也可以回到书架，直接阅读 TXT 或 EPUB。'}</p><button className="secondary-button" onClick={() => sources.length ? setView('sources') : openWizard()}>{sources.length ? '去启用书源' : '导入书源'}</button><button className="text-button" onClick={leave}>返回书架</button></div> : !searched && !busy && !results.length && !notice && <p className="search-hint">从书名开始，找到后点开即可阅读。</p>}
        {!step && status}
        {(searched || results.length > 0) && <section aria-label="在线搜索结果" className="online-results"><div className="results-heading"><h2>搜索结果</h2><span>第 {page} 页 · {results.length} 本</span></div>{searched && !results.length && <div className="discovery-empty"><Search size={25} /><h3>{failures.length ? '本次未能找到书籍' : page === 1 ? '未找到匹配书籍' : '已到搜索末页'}</h3><p>{failures.length ? '部分来源未能响应。可以重试，或更换搜索范围。' : page === 1 ? '试试更短的书名，或更换搜索范围。' : '本页没有更多结果，可以返回上一页。'}</p></div>}{results.map(result => <button type="button" className="online-result" key={`${result.sourceId}:${result.url}`} data-result={`${result.sourceId}:${result.url}`} disabled={!!busy} onClick={() => { resultTrigger.current = `${result.sourceId}:${result.url}`; scrollTop.current = main.current?.scrollTop || 0; void run('正在读取详情', request => api.detail(result, request()), setDetail); }}><span className="result-book-icon" aria-hidden="true"><BookOpen size={22} strokeWidth={1.3} /></span><span className="result-info"><strong>{result.title}</strong><span>{result.author || '佚名'}</span><small>来自 {sources.find(s => s.id === result.sourceId)?.name || '已移除的书源'}</small></span><ArrowRight size={16} /></button>)}<div className="search-pagination">{page > 1 && <button className="text-button" disabled={!!busy} onClick={() => search(page - 1)}>上一页搜索</button>}{results.length > 0 && <button className="text-button" disabled={!!busy || page >= 5} onClick={() => search(page + 1)}>下一页搜索</button>}{page >= 5 && <span>已显示前 5 页，可缩小关键词范围。</span>}</div></section>}
        {failures.length > 0 && <details className="search-failures"><summary>{failures.length} 个来源暂未返回结果{results.length ? '，其他结果仍可阅读' : ''}</summary>{failures.map(f => <p key={f.source.id}><strong>{f.source.name}</strong>：{f.message}</p>)}<button className="text-button" disabled={!!busy} onClick={() => search(page, failures.map(f => f.source))}>重试这些来源</button></details>}
      </>}
    </div>
    {step && <div className="modal-backdrop import-backdrop"><section ref={dialog} className="online-dialog" role="dialog" aria-modal="true" aria-labelledby="source-import-title" onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const nodes = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary,[tabindex="0"]')).filter(el => el.getClientRects().length);
      const first = nodes[0], last = nodes.at(-1);
      if (event.shiftKey && (document.activeElement === first || !nodes.includes(document.activeElement as HTMLElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !nodes.includes(document.activeElement as HTMLElement))) { event.preventDefault(); first?.focus(); }
    }}><div className="panel-heading"><h2 id="source-import-title">导入书源</h2><button className="icon-button" aria-label="关闭导入" disabled={!!busy && !cancellable} onClick={closeWizard}><X size={18} /></button></div>
      <p className="import-steps">{step === 'choose' ? '1 / 3　选择文件或链接' : step === 'review' ? '2 / 3　确认导入内容' : '3 / 3　已保存书源'}</p>
      {step === 'choose' ? <div className="online-import"><h3 tabIndex={-1} data-wizard-focus>添加你信任的来源</h3><p>书源是一份找书地址文件，不是电子书。TXT / EPUB 请在书架导入。</p><label className="online-file"><FileUp size={22} /><strong>选择书源 JSON 文件</strong><input type="file" accept=".json,application/json" aria-label="选择书源 JSON" disabled={!!busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void run('正在检查书源', async () => { if (file.size > 512 * 1024) throw new Error('文件太大，请选择不超过 512 KiB 的书源 JSON。'); return api.preview({ json: await file.text() }); }, value => { setPreview(value); setStep('review'); }); }} /></label><div className="import-divider">或使用链接</div><form onSubmit={event => { event.preventDefault(); void run('正在读取书源链接', request => api.preview({ url: url.trim(), requestId: request() }), value => { setPreview(value); setStep('review'); }); }}><label>书源 JSON 链接<input type="url" value={url} disabled={!!busy} onChange={e => { setUrl(e.target.value); setError(''); }} placeholder="https://…" required /></label><button type="submit" className="secondary-button" disabled={!!busy || !url.trim()}>检查链接</button></form><p className="section-caption">只读取你选择的文件或链接，不自动订阅更新。每次最多 50 个书源、512 KiB。</p><details className="source-boundaries"><summary>兼容与访问限制</summary><p>支持部分 Legado JSON 规则，仅限你有权访问的公开文本。不支持脚本、登录、WebView、验证码绕过或付费 DRM；非 UTF-8 搜索参数也暂不支持。</p><p>仅访问公开网站的标准端口，同一书源只访问其声明的网站。不支持内网地址和跨网站跳转；部分网站的压缩响应或复杂规则也可能无法读取。</p></details></div> : step === 'review' && preview ? <section aria-label="导入预览" className="source-preview"><h3 tabIndex={-1} data-wizard-focus>找到 {preview.sources.length} 个书源</h3><p>{preview.sources.filter(canSearch).length} 个可尝试找书 · {preview.sources.filter(s => !canSearch(s)).length} 个暂不兼容</p><p className="import-callout">这一步只检查文件。保存成功不代表能搜到书或读到正文，新建或更新的书源需另行启用。</p>{preview.sources.map(source => { const change = preview.changes.find(c => c.id === source.id)!; return <article className="source-row" key={source.id}><div className="source-row-heading"><strong>{source.name}</strong><span className="source-badge">{({ new: '新增', unchanged: '已存在', replace: '更新' })[change.kind]}</span></div><p>{canSearch(source) ? '规则可用于尝试搜索，网站尚待验证' : '含 Reader 暂不支持的访问方式或规则，保存后不能启用找书'}</p>{change.kind === 'replace' && <p>将替换书源规则并停用；旧书的缓存和阅读进度会保留。</p>}<SourceStatus source={source} />{change.fields.length > 0 && <details><summary>查看变更字段</summary><p>{change.fields.join('、')}</p></details>}</article>; })}<div className="wizard-actions"><button className="primary-button" disabled={!!busy} onClick={() => void run('正在保存书源', () => api.commit(preview.token), data => { setSources(data); setSavedIds(preview.sources.map(s => s.id)); setPreview(null); setStep('saved'); }, false)}>确认导入</button><button className="text-button" disabled={!!busy} onClick={() => { setStep('choose'); setPreview(null); setError(''); }}>重新选择</button></div></section> : <section className="import-complete" aria-label="导入完成"><Check size={28} /><h3 tabIndex={-1} data-wizard-focus>已保存 {savedIds.length} 个书源</h3><p>保存完成。能否找到书、读到正文，将在搜索与阅读时验证。</p>{sources.some(s => savedIds.includes(s.id) && canSearch(s)) ? <button className="primary-button" disabled={!!busy} onClick={() => void run('正在启用书源', async () => { let data = sources; for (const source of sources.filter(s => savedIds.includes(s.id) && canSearch(s) && !s.enabled)) data = await api.setEnabled(source.id, true); return data; }, data => { setSources(data); setSourceId(savedIds.length === 1 ? savedIds[0] : ''); resetSearch(); setView('find'); setStep(null); setError(''); setNotice(''); requestAnimationFrame(() => main.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus()); }, false)}>启用并找书</button> : <p>这些来源暂不兼容，可以查看原因或导入其他书源。</p>}<button className="text-button" disabled={!!busy} onClick={() => { setView('sources'); closeWizard(); }}>查看书源</button></section>}
      {status}
    </section></div>}
  </main>;
}
