import React, { useEffect, useRef, useState } from 'react';
import { Globe, MoreHorizontal, Search, X } from 'lucide-react';
import type { SourceReport } from '../shared/online';
import { canSearch, sourceDomain, sourceState, SourceStatus } from './sourcePresentation';

type Props = {
  sources: SourceReport[];
  busy: boolean;
  pendingRemove: string | null;
  onToggle: (source: SourceReport) => void;
  onRemovePrompt: (id: string | null) => void;
  onRemove: (source: SourceReport) => void;
};
export function SourceManager({ sources, busy, pendingRemove, onToggle, onRemovePrompt, onRemove }: Props) {
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('all'), [detailsId, setDetailsId] = useState<string | null>(null);
  const root = useRef<HTMLElement>(null);
  const enabled = sources.filter(source => source.enabled).length;
  const unavailable = sources.filter(source => !canSearch(source)).length;
  const visible = sources.filter(source => {
    const match = `${source.name} ${sourceDomain(source)}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
    return match && (filter === 'all' || filter === 'enabled' && source.enabled || filter === 'disabled' && !source.enabled || filter === 'unavailable' && !canSearch(source));
  });
  useEffect(() => {
    const close = (event: PointerEvent) => root.current?.querySelectorAll<HTMLDetailsElement>('.source-menu[open]').forEach(menu => { if (!menu.contains(event.target as Node)) menu.open = false; });
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  const closeMenu = (element: HTMLElement) => { const menu = element.closest('details'); if (menu) menu.open = false; };
  const focusMore = (id: string) => root.current?.querySelector<HTMLElement>(`[data-source="${id}"] .source-menu > summary`)?.focus();
  return <section ref={root} className="source-manager" aria-label="已保存书源">
    <div className="source-manager-toolbar"><label className="search-field source-manager-search"><Search size={17} aria-hidden="true" /><input type="search" aria-label="搜索书源名称或域名" placeholder="搜索名称或域名" value={query} onChange={event => { setQuery(event.target.value); onRemovePrompt(null); }} /></label><label className="source-manager-filter"><span className="visually-hidden">筛选书源</span><select aria-label="筛选书源" value={filter} onChange={event => { setFilter(event.target.value); onRemovePrompt(null); }}><option value="all">全部 · {sources.length}</option><option value="enabled">已启用 · {enabled}</option><option value="disabled">未启用 · {sources.length - enabled}</option><option value="unavailable">暂不支持 · {unavailable}</option></select></label></div>
    <p className="source-manager-count" role="status">{query || filter !== 'all' ? `找到 ${visible.length} 个书源` : `${sources.length} 个书源 · ${enabled} 个已启用`}</p>
    {visible.length ? <div className="managed-source-list">{visible.map(source => {
      const state = sourceState(source);
      return <article key={source.id} className="managed-source" data-source={source.id}>
        <div className="managed-source-row"><span className="source-site-icon" aria-hidden="true"><Globe size={19} strokeWidth={1.4} /></span><div className="managed-source-info"><h2>{source.name}</h2><div className="managed-source-meta"><span className="managed-source-domain" title={sourceDomain(source)}>{sourceDomain(source)}</span><span className={`source-health ${state.tone}`} title={state.hint}>{state.label}</span></div></div><button type="button" className="source-switch" role="switch" aria-checked={source.enabled} aria-label={`${source.enabled ? '停用' : '启用'} ${source.name}`} disabled={busy || !source.enabled && !canSearch(source)} onClick={() => onToggle(source)}><span /></button><details className="source-menu" onToggle={event => { const current = event.currentTarget; if (current.open) root.current?.querySelectorAll<HTMLDetailsElement>('.source-menu[open]').forEach(menu => { if (menu !== current) menu.open = false; }); }} onKeyDown={event => { if (event.key === 'Escape' && event.currentTarget.open) { event.stopPropagation(); event.preventDefault(); event.currentTarget.open = false; focusMore(source.id); } }}><summary aria-label={`更多操作 ${source.name}`}><MoreHorizontal size={20} /></summary><div className="source-menu-actions"><button type="button" onClick={event => { closeMenu(event.currentTarget); setDetailsId(source.id); requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`[data-source="${source.id}"] .manager-source-details summary`)?.focus()); }}>查看详情</button><button type="button" disabled={busy} onClick={event => { closeMenu(event.currentTarget); onRemovePrompt(source.id); requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`[data-source="${source.id}"] .source-remove button`)?.focus()); }}>移除书源</button></div></details></div>
        {detailsId === source.id && <div className="manager-source-details" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setDetailsId(null); focusMore(source.id); } }}><div className="manager-details-heading"><p>{state.hint}</p><button type="button" className="icon-button" aria-label={`收起详情 ${source.name}`} onClick={() => { setDetailsId(null); focusMore(source.id); }}><X size={16} /></button></div><SourceStatus source={source} expanded /></div>}
        {pendingRemove === source.id && <div className="source-remove" role="group" aria-label={`移除 ${source.name}`}><p>移除此书源？已缓存的章节和阅读进度会保留。</p><button type="button" className="secondary-button" disabled={busy} onClick={() => onRemove(source)}>确认移除</button><button type="button" className="text-button" disabled={busy} onClick={() => { onRemovePrompt(null); focusMore(source.id); }}>保留书源</button></div>}
      </article>;
    })}</div> : <div className="source-manager-empty"><Search size={25} strokeWidth={1.4} /><h2>没有找到书源</h2><p>试试其他名称，或查看全部来源。</p><button type="button" className="text-button" onClick={() => { setQuery(''); setFilter('all'); root.current?.querySelector<HTMLInputElement>('input')?.focus(); }}>清除筛选</button></div>}
  </section>;
}
