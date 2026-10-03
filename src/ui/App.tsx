import { Button } from '@openai/apps-sdk-ui/components/Button';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Bookmark as BookmarkIcon, BookmarkPlus, Check, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, FileUp, HelpCircle, Keyboard, Library, List, LoaderCircle, Minus, Monitor, Moon, Plus, RotateCcw, Search, Settings2, Sun, Trash2, X } from 'lucide-react';
import { defaultSettings, type BookDetail, type BookSummary, type Locator, type ReaderApi, type ReaderSettings, type Theme } from '../shared/types';
import { readingBlocks } from '../shared/reading';
import { KeyboardEditor } from './KeyboardEditor';
import { defaultKeyboard, editableTarget, eventShortcut, shortcutActions, type KeyboardSettings } from '../shared/keyboard';
import type { TrashEntry } from '../shared/types';
import { OnlinePanel } from './OnlinePanel';
import { IncompleteLoadError, type IncompleteLoad } from '../shared/online';
import './styles.css';

type Panel = 'contents' | 'bookmarks' | 'appearance' | 'search' | null;
type SaveState = 'saved' | 'pending' | 'saving' | 'error';
const sameLocator = (a: Locator | undefined, b: Locator | undefined) => !!a && !!b && (a.chapterId && b.chapterId ? a.chapterId === b.chapterId : a.chapter === b.chapter) && a.paragraph === b.paragraph;
const messageOf = (error: unknown) => error instanceof Error ? error.message : '暂时无法连接 Reader 服务，请稍后重试';
const formatWords = (count: number) => count >= 10000 ? `${(count / 10000).toFixed(1).replace(/\.0$/, '')} 万字` : `${count.toLocaleString('zh-CN')} 字`;
const clampLocator = (book: BookDetail, loc: Locator): Locator => {
  const byId = loc.chapterId ? book.document.chapters.findIndex(c => c.id === loc.chapterId) : -1;
  const chapter = byId >= 0 ? byId : Math.max(0, Math.min(loc.chapter || 0, book.document.chapters.length - 1));
  return { chapter, paragraph: Math.max(0, Math.min(loc.paragraph || 0, (book.document.chapters[chapter]?.paragraphs.length || 1) - 1)), ...(book.document.format === 'online' ? { chapterId: book.document.chapters[chapter].id } : {}) };
};
const percentAt = (book: BookDetail, loc: Locator) => {
  if (book.document.format === 'online') return book.document.chapters.length <= 1 ? 0 : Math.round(loc.chapter / (book.document.chapters.length - 1) * 100);
  const total = book.document.chapters.reduce((n, c) => n + c.paragraphs.length, 0);
  const before = book.document.chapters.slice(0, loc.chapter).reduce((n, c) => n + c.paragraphs.length, 0);
  return total > 1 ? Math.round(((before + loc.paragraph) / (total - 1)) * 100) : 0;
};
const themes: { value: Theme; label: string; Icon: typeof Sun }[] = [
  { value: 'system', label: '跟随系统', Icon: Monitor }, { value: 'light', label: '明亮', Icon: Sun },
  { value: 'sepia', label: '纸色', Icon: BookOpen }, { value: 'dark', label: '深色', Icon: Moon },
];

function IconButton({ label, active, children, className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return <button type="button" className={`icon-button ${active ? 'is-active' : ''} ${className}`} title={label} aria-label={label} aria-pressed={active === undefined ? undefined : active} {...props}>{children}</button>;
}
function ErrorNotice({ text, onRetry, onClose }: { text: string; onRetry?: () => void; onClose?: () => void }) {
  return <div className="error-notice" role="alert"><CircleAlert size={17} aria-hidden="true" /><span>{text}</span>{onRetry && <button type="button" className="text-button" onClick={onRetry}>重试</button>}{onClose && <IconButton label="关闭提示" onClick={onClose}><X size={15} /></IconButton>}</div>;
}
function EmptyHint({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="panel-empty"><p>{title}</p><span>{children}</span></div>;
}

function trapDialogFocus(event: React.KeyboardEvent<HTMLElement>) {
  if (event.key !== 'Tab') return;
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),summary,[tabindex="0"]')].filter(el => el.getClientRects().length);
  const first = items[0], last = items.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
}

export function App({ api }: { api: ReaderApi }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [keyboard, setKeyboard] = useState<KeyboardSettings>(defaultKeyboard);
  const [keyboardError, setKeyboardError] = useState('');
  const [trashEntries, setTrashEntries] = useState<TrashEntry[]>([]);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashBusy, setTrashBusy] = useState(false);
  const trashBusyRef = useRef(false);
  const [undoId, setUndoId] = useState<string | null>(null);
  const [shelfLayout, setShelfLayout] = useState<'cards' | 'list'>('cards');
  const [hostCloseMessage, setHostCloseMessage] = useState('');
  const closeBusyRef = useRef(false);
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [settings, setSettings] = useState<ReaderSettings>(defaultSettings);
  const [book, setBook] = useState<BookDetail | null>(null);
  const [chapterIndex, setChapterIndex] = useState(0);
  const [locator, setLocator] = useState<Locator>({ chapter: 0, paragraph: 0 });
  const [navigation, setNavigation] = useState<{ locator: Locator; token: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [returning, setReturning] = useState(false);
  const returningRef = useRef(false);
  const [importing, setImporting] = useState(false);
  const [importLabel, setImportLabel] = useState('');
  const [encoding, setEncoding] = useState('auto');
  const [error, setError] = useState('');
  const [importError, setImportError] = useState('');
  const [settingsError, setSettingsError] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [saveError, setSaveError] = useState('');
  const [bookmarkBusy, setBookmarkBusy] = useState(false);
  const [bookmarkError, setBookmarkError] = useState('');
  const [panel, setPanel] = useState<Panel>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [onlineOpen, setOnlineOpen] = useState(false);
  const [onlineBusy, setOnlineBusy] = useState(false);
  const [onlineError, setOnlineError] = useState('');
  const [onlineIncomplete, setOnlineIncomplete] = useState<IncompleteLoad | null>(null);
  const onlineRetryRef = useRef<(() => void) | null>(null);
  const onlineRequestRef = useRef<string | null>(null);
  const [libraryQuery, setLibraryQuery] = useState('');
  const [bookQuery, setBookQuery] = useState('');
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState('');
  const readingRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bookRef = useRef<BookDetail | null>(null);
  const settingsRef = useRef(settings);
  const currentLocatorRef = useRef<Locator>(locator);
  const restoreRef = useRef(false);
  const progressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const pendingProgressRef = useRef<{ id: string; locator: Locator } | null>(null);
  const progressChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const settingsChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const lastSavedRef = useRef<Record<string, Locator>>({});
  const failedProgressRef = useRef<Map<string, { id: string; locator: Locator }>>(new Map());
  const desiredProgressRef = useRef<Map<string, Locator>>(new Map());
  const failedOpenRef = useRef<string | null>(null);
  const importLockRef = useRef(false);
  const mountedRef = useRef(true);
  const openRequestRef = useRef(0);
  const navTokenRef = useRef(0);
  const dragDepthRef = useRef(0);
  const lastImportRef = useRef<File[]>([]);
  const settingsDirtyRef = useRef(false);
  const overlayRef = useRef<HTMLElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  const updateSummary = useCallback((summary: BookSummary) => {
    setBooks(previous => [summary, ...previous.filter(item => item.id !== summary.id)]);
  }, []);

  const flushProgress = useCallback(() => {
    if (progressTimerRef.current) clearTimeout(progressTimerRef.current);
    progressTimerRef.current = null;
    const pending = pendingProgressRef.current;
    const batch = new Map(failedProgressRef.current);
    if (pending) batch.set(pending.id, pending);
    pendingProgressRef.current = null;
    if (!batch.size) return progressChainRef.current;
    const operation = async () => {
      for (const item of batch.values()) {
        const desired = desiredProgressRef.current.get(item.id);
        if (desired && !sameLocator(desired, item.locator)) continue;
        if (sameLocator(lastSavedRef.current[item.id], item.locator)) {
          failedProgressRef.current.delete(item.id);
          if (mountedRef.current) {
            if (!failedProgressRef.current.size) setSaveError('');
            if (bookRef.current?.document.id === item.id) setSaveState(pendingProgressRef.current ? 'pending' : 'saved');
          }
          continue;
        }
        if (mountedRef.current && bookRef.current?.document.id === item.id) setSaveState('saving');
        try {
          const summary = await api.saveProgress(item.id, item.locator);
          lastSavedRef.current[item.id] = item.locator;
          failedProgressRef.current.delete(item.id);
          if (!mountedRef.current) continue;
          updateSummary(summary);
          if (!failedProgressRef.current.size) setSaveError('');
          if (bookRef.current?.document.id === item.id) setSaveState(pendingProgressRef.current ? 'pending' : 'saved');
        } catch (reason) {
          failedProgressRef.current.set(item.id, item);
          if (mountedRef.current) {
            setSaveState('error');
            setSaveError(`阅读位置未保存：${messageOf(reason)}`);
          }
        }
      }
    };
    progressChainRef.current = progressChainRef.current.then(operation, operation);
    return progressChainRef.current;
  }, [api, updateSummary]);

  const queueProgress = useCallback((id: string, next: Locator) => {
    desiredProgressRef.current.set(id, next);
    pendingProgressRef.current = { id, locator: next };
    setSaveState('pending');
    if (progressTimerRef.current) clearTimeout(progressTimerRef.current);
    progressTimerRef.current = setTimeout(() => { void flushProgress(); }, 750);
  }, [flushProgress]);

  const flushSettings = useCallback(() => {
    if (settingsTimerRef.current) clearTimeout(settingsTimerRef.current);
    settingsTimerRef.current = null;
    if (!settingsDirtyRef.current) return settingsChainRef.current;
    settingsDirtyRef.current = false;
    const snapshot = { ...settingsRef.current };
    const operation = async () => {
      try { await api.saveSettings(snapshot); if (mountedRef.current) setSettingsError(''); }
      catch (reason) { settingsDirtyRef.current = true; if (mountedRef.current) setSettingsError(`阅读样式未保存：${messageOf(reason)}`); }
    };
    settingsChainRef.current = settingsChainRef.current.then(operation, operation);
    return settingsChainRef.current;
  }, [api]);

  const loadLibrary = useCallback(async () => {
    setLoading(true); setError(''); failedOpenRef.current = null;
    try {
      const data = await api.list();
      if (!mountedRef.current) return;
      setBooks(data.books);
      setSettings(data.settings); settingsRef.current = data.settings;
    } catch (reason) { if (mountedRef.current) setError(messageOf(reason)); }
    finally { if (mountedRef.current) setLoading(false); }
  }, [api]);

  useEffect(() => {
    mountedRef.current = true;
    void loadLibrary();
    void api.keyboard().then(setKeyboard).catch(reason => setKeyboardError(messageOf(reason)));
    const onVisibility = () => { if (document.visibilityState === 'hidden') { void flushProgress(); flushSettings(); } };
    const onPageHide = () => { void flushProgress(); flushSettings(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      void flushProgress(); flushSettings(); mountedRef.current = false;
      if (onlineRequestRef.current) void api.online?.cancel(onlineRequestRef.current);
      if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [loadLibrary, flushProgress, flushSettings]);

  useEffect(() => api.onBeforeClose?.(async () => {
    if (scrollFrameRef.current !== null) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    await Promise.all([flushProgress(), flushSettings()]);
    if (failedProgressRef.current.size || settingsDirtyRef.current) throw new Error('保存失败，尚未请求关闭；请重试保存。');
  }), [api, flushProgress, flushSettings]);

  useEffect(() => { bookRef.current = book; }, [book]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 3000);
    return () => clearTimeout(timer);
  }, [notice]);

  const showBook = useCallback((next: BookDetail) => {
    if (next.document.format !== 'online') setOnlineOpen(false);
    const unsaved = failedProgressRef.current.get(next.document.id);
    const nextLocator = clampLocator(next, unsaved ? (desiredProgressRef.current.get(next.document.id) || unsaved.locator) : next.summary.locator);
    restoreRef.current = true;
    bookRef.current = next;
    currentLocatorRef.current = nextLocator;
    lastSavedRef.current[next.document.id] = clampLocator(next, next.summary.locator);
    setBook(next); setChapterIndex(nextLocator.chapter); setLocator(nextLocator);
    setNavigation({ locator: nextLocator, token: ++navTokenRef.current });
    setPanel(null); setSaveState(failedProgressRef.current.has(next.document.id) ? 'error' : 'saved'); if (!failedProgressRef.current.size) setSaveError(''); setBookmarkError(''); setBookQuery('');
    updateSummary(next.summary);
    requestAnimationFrame(() => readingRef.current?.focus());
  }, [updateSummary]);

  useEffect(() => api.onExternalBook?.(next => {
    const request = ++openRequestRef.current;
    void flushProgress().then(() => {
      if (mountedRef.current && request === openRequestRef.current) showBook(next);
    });
  }, text => { if (mountedRef.current) setImportError(text); }), [api, flushProgress, showBook]);

  const openBook = useCallback(async (id: string) => {
    const request = ++openRequestRef.current;
    setOpeningId(id); setError(''); failedOpenRef.current = id;
    await flushProgress();
    if (!mountedRef.current || request !== openRequestRef.current) return;
    try {
      const requestId = crypto.randomUUID();
      onlineRequestRef.current = requestId;
      const detail = await api.open(id, requestId);
      if (mountedRef.current && request === openRequestRef.current) { failedOpenRef.current = null; showBook(detail); }
    } catch (reason) { if (mountedRef.current && request === openRequestRef.current) setError(messageOf(reason)); }
    finally { if (mountedRef.current && request === openRequestRef.current) { setOpeningId(null); onlineRequestRef.current = null; } }
  }, [api, flushProgress, showBook]);

  const importFiles = useCallback(async (input: File[]) => {
    if (importLockRef.current || !input.length) return;
    const files = Array.from(new Map(input.map(file => [`${file.name}:${file.size}:${file.lastModified}`, file])).values());
    const invalid = files.filter(file => !/\.(txt|epub)$/i.test(file.name));
    if (invalid.length) { setImportError('请选择 .txt 或 .epub 文件'); return; }
    importLockRef.current = true; setImporting(true); setImportError(''); lastImportRef.current = files;
    let last: BookDetail | null = null;
    let count = 0;
    try {
      for (const file of files) {
        setImportLabel(files.length > 1 ? `正在导入 ${count + 1}/${files.length}：${file.name}` : `正在导入 ${file.name}`);
        last = await api.importBook(file, encoding === 'auto' ? undefined : encoding);
        count++; updateSummary(last.summary);
      }
      setNotice(files.length > 1 ? `已导入 ${count} 本书` : '书籍已导入');
      if (last && files.length === 1) { await flushProgress(); showBook(last); }
    } catch (reason) { setImportError(`${count ? `已导入 ${count} 本。` : ''}${messageOf(reason)}`); }
    finally { importLockRef.current = false; setImporting(false); setImportLabel(''); if (fileInputRef.current) fileInputRef.current.value = ''; }
  }, [api, encoding, flushProgress, showBook, updateSummary]);

  const navigate = useCallback(async (requested: Locator) => {
    let activeBook = bookRef.current;
    if (!activeBook) return;
    const request = ++openRequestRef.current;
    if (onlineRequestRef.current) void api.online?.cancel(onlineRequestRef.current);
    setOnlineBusy(false);
    await flushProgress();
    if (!mountedRef.current || request !== openRequestRef.current) return;
    if (activeBook.document.format === 'online' && api.online) {
      const target = requested.chapterId ? activeBook.document.chapters.find(c => c.id === requested.chapterId) : activeBook.document.chapters[requested.chapter];
      if (!target) { setOnlineError('章节已不在目录中'); return; }
      if (!target.loaded) {
        const requestId = crypto.randomUUID(); onlineRequestRef.current = requestId;
        setOnlineBusy(true); setOnlineError(''); setOnlineIncomplete(null);
        try {
          const loaded = await api.online.chapter(activeBook.document.id, target.id, requestId);
          if (!mountedRef.current || request !== openRequestRef.current) return;
          activeBook = loaded; bookRef.current = loaded; setBook(loaded);
        } catch (reason) { if (mountedRef.current && request === openRequestRef.current) { setOnlineError(messageOf(reason)); setOnlineIncomplete(reason instanceof IncompleteLoadError ? reason.incomplete : null); onlineRetryRef.current = () => { void navigate(requested); }; } return; }
        finally { if (mountedRef.current && request === openRequestRef.current) { setOnlineBusy(false); onlineRequestRef.current = null; } }
      }
    }
    if (request !== openRequestRef.current) return;
    const next = clampLocator(activeBook, requested);
    restoreRef.current = true;
    currentLocatorRef.current = next;
    setLocator(next); setChapterIndex(next.chapter);
    setNavigation({ locator: next, token: ++navTokenRef.current });
    queueProgress(activeBook.document.id, next);
    setPanel(null);
  }, [api, flushProgress, queueProgress]);

  useLayoutEffect(() => {
    if (!book || !navigation || !readingRef.current) return;
    let frame1 = 0; let frame2 = 0; let canceled = false;
    restoreRef.current = true;
    const restore = () => {
      const container = readingRef.current;
      const target = document.getElementById(`reader-paragraph-${navigation.locator.chapter}-${navigation.locator.paragraph}`);
      if (container && target) {
        container.scrollTo({ top: navigation.locator.paragraph === 0 ? 0 : container.scrollTop + target.getBoundingClientRect().top - container.getBoundingClientRect().top - 42, behavior: 'instant' });
      } else if (container) container.scrollTo({ top: 0, behavior: 'instant' });
      frame2 = requestAnimationFrame(() => { if (!canceled) restoreRef.current = false; });
    };
    frame1 = requestAnimationFrame(restore);
    return () => { canceled = true; cancelAnimationFrame(frame1); cancelAnimationFrame(frame2); };
  }, [book?.document.id, chapterIndex, navigation]);

  const onReadingScroll = useCallback(() => {
    if (restoreRef.current || scrollFrameRef.current !== null) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      if (restoreRef.current) return;
      const container = readingRef.current; const activeBook = bookRef.current;
      if (!container || !activeBook) return;
      const threshold = container.getBoundingClientRect().top + 55;
      const paragraphs = container.querySelectorAll('[data-reader-paragraph]');
      if (!paragraphs?.length) return;
      let low = 0; let high = paragraphs.length - 1; let visibleIndex = 0;
      while (low <= high) {
        const mid = (low + high) >>> 1;
        if (paragraphs[mid].getBoundingClientRect().top <= threshold) { visibleIndex = mid; low = mid + 1; }
        else high = mid - 1;
      }
      const visible = paragraphs[visibleIndex] as HTMLElement;
      const next = clampLocator(activeBook, { chapter: Number(visible.dataset.chapter), paragraph: Number(visible.dataset.readerParagraph) });
      if (sameLocator(next, currentLocatorRef.current)) return;
      currentLocatorRef.current = next; setLocator(next);
      queueProgress(activeBook.document.id, next);
    });
  }, [queueProgress]);

  const returnToShelf = useCallback(async () => {
    if (returningRef.current) return;
    returningRef.current = true; setReturning(true);
    const request = ++openRequestRef.current;
    if (onlineRequestRef.current) void api.online?.cancel(onlineRequestRef.current);
    setOnlineBusy(false); setOnlineError('');
    try {
      // Let an already queued scroll observer capture the final visible paragraph.
      if (scrollFrameRef.current !== null) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      await Promise.all([flushProgress(), flushSettings()]);
      if (mountedRef.current && request === openRequestRef.current) {
        bookRef.current = null; setBook(null); setPanel(null); setBookmarkError('');
        requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>('.book-card')?.focus());
      }
    } finally { returningRef.current = false; if (mountedRef.current) setReturning(false); }
  }, [flushProgress, flushSettings]);

  const changeSettings = useCallback((patch: Partial<ReaderSettings>) => {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next; setSettings(next); settingsDirtyRef.current = true;
    if (bookRef.current) {
      restoreRef.current = true;
      setNavigation({ locator: { ...currentLocatorRef.current }, token: ++navTokenRef.current });
    }
    if (settingsTimerRef.current) clearTimeout(settingsTimerRef.current);
    settingsTimerRef.current = setTimeout(flushSettings, 500);
  }, [flushSettings]);

  const toggleBookmark = useCallback(async () => {
    const active = bookRef.current;
    if (!active || bookmarkBusy) return;
    const location = { ...currentLocatorRef.current };
    const existing = active.bookmarks.find(item => sameLocator(item.locator, location));
    setBookmarkBusy(true); setBookmarkError('');
    try {
      const chapter = active.document.chapters[location.chapter];
      const list = existing ? await api.removeBookmark(active.document.id, existing.id) : await api.addBookmark(active.document.id, location, chapter.paragraphs[location.paragraph]?.slice(0, 70) || chapter.title);
      if (bookRef.current?.document.id === active.document.id) {
        const updated = { ...bookRef.current, bookmarks: list };
        bookRef.current = updated; setBook(updated);
        setNotice(existing ? '书签已移除' : '已收藏当前段落');
      }
    } catch (reason) { setBookmarkError(messageOf(reason)); }
    finally { setBookmarkBusy(false); }
  }, [api, bookmarkBusy]);

  const removeBookmark = useCallback(async (id: string) => {
    const active = bookRef.current;
    if (!active || bookmarkBusy) return;
    setBookmarkBusy(true); setBookmarkError('');
    try {
      const list = await api.removeBookmark(active.document.id, id);
      if (bookRef.current?.document.id === active.document.id) {
        const updated = { ...bookRef.current, bookmarks: list }; bookRef.current = updated; setBook(updated);
      }
    } catch (reason) { setBookmarkError(messageOf(reason)); }
    finally { setBookmarkBusy(false); }
  }, [api, bookmarkBusy]);

  const togglePanel = useCallback((next: Exclude<Panel, null>) => setPanel(previous => previous === next ? null : next), []);
  const requestHostClose = useCallback(async () => {
    if (closeBusyRef.current) return;
    closeBusyRef.current = true;
    try { const result = await api.requestHostClose?.(); setHostCloseMessage(result?.message ?? '当前宿主没有关闭接口，请使用宿主关闭按钮。'); }
    catch (reason) { setHostCloseMessage(`未完成关闭请求：${messageOf(reason)}`); }
    finally { closeBusyRef.current = false; }
  }, [api]);

  const restoreBook = async (id: string) => {
    if (trashBusyRef.current) return;
    trashBusyRef.current = true; setTrashBusy(true);
    try { await api.restore(id); setTrashEntries(await api.trashList()); if (undoId === id) setUndoId(null); await loadLibrary(); setNotice('书籍已恢复，进度、书签及缓存保留'); }
    catch (reason) { setError(messageOf(reason)); }
    finally { trashBusyRef.current = false; setTrashBusy(false); }
  };
  const trashBook = async (id: string) => {
    if (trashBusyRef.current || bookmarkBusy) return;
    trashBusyRef.current = true; setTrashBusy(true);
    try {
      ++openRequestRef.current;
      if (onlineRequestRef.current) await api.online?.cancel(onlineRequestRef.current);
      if (scrollFrameRef.current !== null) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      await flushProgress();
      if (failedProgressRef.current.has(id)) throw new Error('阅读进度尚未保存，请重试保存后移到回收站');
      await api.trash(id);
      if (bookRef.current?.document.id === id) { bookRef.current = null; setBook(null); setPanel(null); setOnlineOpen(false); }
      failedProgressRef.current.delete(id); desiredProgressRef.current.delete(id); delete lastSavedRef.current[id];
      if (pendingProgressRef.current?.id === id) pendingProgressRef.current = null;
      setOpeningId(null); setBooks(items => items.filter(item => item.id !== id)); setUndoId(id); setNotice('已移到回收站');
      requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>('.undo-trash')?.focus());
    } catch (reason) { setError(messageOf(reason)); }
    finally { trashBusyRef.current = false; setTrashBusy(false); }
  };
  const onReaderKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229 || event.getModifierState('AltGraph') || returningRef.current || trashBusyRef.current) return;
    const target = event.target as HTMLElement;
    if (editableTarget(target)) return;
    if (event.key === 'Escape') {
      const menu = target.closest('details[open]');
      if (menu) { menu.removeAttribute('open'); menu.querySelector<HTMLElement>('summary')?.focus(); }
      else if (helpOpen) setHelpOpen(false);
      else if (panel) setPanel(null);
      else if (trashOpen) setTrashOpen(false);
      else if (bookRef.current) void returnToShelf();
      else return;
      event.preventDefault(); return;
    }
    const action = shortcutActions.find(action => keyboard.bindings[action] && keyboard.bindings[action] === eventShortcut(event.nativeEvent));
    if (action === 'closeHost') { event.preventDefault(); if (!event.repeat) void requestHostClose(); return; }
    if (helpOpen || trashOpen || onlineOpen && !bookRef.current || panel || target.closest('details[open]')) return;
    if (!bookRef.current && /^Arrow/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      const buttons = [...(rootRef.current?.querySelectorAll<HTMLButtonElement>('.book-card') || [])];
      const index = buttons.indexOf(target.closest('.book-card') as HTMLButtonElement);
      if (index >= 0) {
        const columns = shelfLayout === 'list' ? 1 : Math.max(1, getComputedStyle(rootRef.current!.querySelector('.book-grid')!).gridTemplateColumns.split(' ').length);
        const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -columns : columns;
        buttons[Math.max(0, Math.min(buttons.length - 1, index + delta))]?.focus(); event.preventDefault();
      }
      return;
    }
    if (bookRef.current && action) {
      event.preventDefault();
      if (action === 'scrollUp' || action === 'scrollDown') {
        // Opening/restoring a book takes two animation frames. Preserve the
        // first key press instead of letting the pending restoration erase it.
        const id = bookRef.current.document.id, token = navTokenRef.current;
        const scroll = () => {
          if (!mountedRef.current || bookRef.current?.document.id !== id || navTokenRef.current !== token) return;
          if (restoreRef.current) { requestAnimationFrame(scroll); return; }
          readingRef.current?.scrollBy({ top: action === 'scrollUp' ? -80 : 80, behavior: 'instant' });
        };
        scroll();
      }
      else if (!event.repeat) void navigate({ chapter: Math.max(0, Math.min(bookRef.current.document.chapters.length - 1, currentLocatorRef.current.chapter + (action === 'previousChapter' ? -1 : 1))), paragraph: 0 });
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    if (event.key === '?') { event.preventDefault(); setHelpOpen(true); return; }
    if (!bookRef.current) return;
    if (event.key === '[' || event.key === ']') { event.preventDefault(); void navigate({ chapter: Math.max(0, Math.min(bookRef.current.document.chapters.length - 1, currentLocatorRef.current.chapter + (event.key === '[' ? -1 : 1))), paragraph: 0 }); }
    if (event.key.toLowerCase() === 'b') { event.preventDefault(); void toggleBookmark(); }
    if (event.key.toLowerCase() === 't') { event.preventDefault(); togglePanel('contents'); }
    if (event.key.toLowerCase() === 'f') { event.preventDefault(); togglePanel('search'); }
  };

  useEffect(() => {
    if (!panel && !helpOpen && !trashOpen) { previouslyFocusedRef.current?.focus(); previouslyFocusedRef.current = null; return; }
    if (!previouslyFocusedRef.current) previouslyFocusedRef.current = document.activeElement as HTMLElement;
    (overlayRef.current?.querySelector<HTMLElement>('input') ?? overlayRef.current?.querySelector<HTMLElement>('button, [tabindex="0"]'))?.focus();
  }, [panel, helpOpen, trashOpen]);

  const refreshOnline = async () => {
    const active = bookRef.current;
    if (!active || !api.online) return;
    const request = ++openRequestRef.current, requestId = crypto.randomUUID();
    if (onlineRequestRef.current) void api.online.cancel(onlineRequestRef.current);
    onlineRequestRef.current = requestId; setOnlineBusy(true); setOnlineError(''); setOnlineIncomplete(null);
    await flushProgress();
    try {
      const refreshed = await api.online.refresh(active.document.id, requestId);
      if (mountedRef.current && request === openRequestRef.current) showBook(refreshed);
    } catch (reason) { if (mountedRef.current && request === openRequestRef.current) { setOnlineError(messageOf(reason)); setOnlineIncomplete(reason instanceof IncompleteLoadError ? reason.incomplete : null); onlineRetryRef.current = () => { void refreshOnline(); }; } }
    finally { if (mountedRef.current && request === openRequestRef.current) { setOnlineBusy(false); onlineRequestRef.current = null; } }
  };

  const visibleBooks = useMemo(() => {
    const query = libraryQuery.trim().toLocaleLowerCase();
    return books.filter(item => `${item.title} ${item.author}`.toLocaleLowerCase().includes(query))
      .sort((a, b) => new Date(b.lastReadAt || b.addedAt).getTime() - new Date(a.lastReadAt || a.addedAt).getTime());
  }, [books, libraryQuery]);
  const searchResults = useMemo(() => {
    const query = bookQuery.trim().toLocaleLowerCase();
    if (!book || query.length < 1) return [];
    const results: { chapter: number; paragraph: number; text: string; title: string }[] = [];
    book.document.chapters.forEach((chapter, chapterNumber) => {
      if (book.document.format === 'online' && chapterNumber !== chapterIndex) return;
      readingBlocks(chapter).forEach(block => {
        const text = block.text;
        const index = text.toLocaleLowerCase().indexOf(query);
        let paragraph = block.start;
        for (const piece of block.pieces) { if (piece.offset > index) break; paragraph = piece.index; }
        if (index >= 0 && results.length < 100) results.push({ chapter: chapterNumber, paragraph, text: `${index > 26 ? '…' : ''}${text.slice(Math.max(0, index - 26), Math.max(0, index - 26) + 130)}${text.length > index + 104 ? '…' : ''}`, title: chapter.title });
      });
    });
    return results;
  }, [book, bookQuery, chapterIndex]);
  const activeChapter = book?.document.chapters[chapterIndex];
  const bookmarked = book?.bookmarks.some(item => sameLocator(item.locator, locator));
  const progress = book ? percentAt(book, locator) : 0;
  const searchLabel = book?.document.format === 'online' ? '搜索当前章节' : '搜索本书';
  const panelTitle = panel === 'contents' ? '目录' : panel === 'bookmarks' ? '我的书签' : panel === 'appearance' ? '阅读样式' : searchLabel;

  const importInput = <input ref={fileInputRef} className="visually-hidden" type="file" accept=".txt,.epub,text/plain,application/epub+zip" multiple aria-label="选择 TXT 或 EPUB 书籍" disabled={importing} onChange={event => void importFiles(Array.from(event.target.files || []))} />;

  return <div ref={rootRef} onKeyDown={onReaderKeyDown} className={`reader-app theme-${settings.theme}`} style={{ '--reading-size': `${settings.fontSize}px`, '--reading-line-height': settings.lineHeight, '--reading-width': `${settings.lineWidth}px`, '--reading-font': settings.fontFamily === 'serif' ? '"Noto Serif SC", "Songti SC", "STSong", "SimSun", Georgia, serif' : 'var(--font-sans)' } as React.CSSProperties}>
    {importInput}
    {hostCloseMessage && !helpOpen && <div className="host-close-message" role="status">{hostCloseMessage}<button className="text-button" onClick={() => setHostCloseMessage('')}>知道了</button></div>}
    {undoId && !book && <div className="undo-banner" role="status">书籍已移到回收站 <button className="text-button undo-trash" disabled={trashBusy} onClick={() => void restoreBook(undoId)}>撤销</button></div>}
    {trashOpen && <div className="modal-backdrop"><section className="help-dialog trash-dialog" ref={node => { if (node) overlayRef.current = node; }} onKeyDown={trapDialogFocus} role="dialog" aria-modal="true" aria-label="回收站"><div className="panel-heading"><h2>回收站</h2><IconButton label="关闭回收站" onClick={() => setTrashOpen(false)} autoFocus><X size={18}/></IconButton></div><p>保留原文件、进度、书签和缓存，不影响书源；不会自动清空。</p>{trashEntries.length ? trashEntries.map(entry => <div className="trash-row" key={entry.summary.id}><div><strong>{entry.summary.title}</strong><small>{entry.summary.format.toUpperCase()} · {entry.summary.id.slice(0, 8)} · {new Date(entry.trashedAt).toLocaleDateString()}</small></div><button disabled={trashBusy} className="secondary-button" onClick={() => void restoreBook(entry.summary.id)}>恢复</button></div>) : <p>回收站为空</p>}{error && <ErrorNotice text={error} onClose={() => setError('')}/>}</section></div>}

    <div className="sr-announcement" role="status" aria-live="polite">{notice}</div>
    {notice && <div className="toast" aria-hidden="true"><Check size={15} />{notice}</div>}
    {!book ? <div hidden={onlineOpen} inert={onlineOpen || helpOpen || trashOpen} className={`shelf-shell ${dragging ? 'is-dragging' : ''}`}
      onDragEnter={event => { event.preventDefault(); if (event.dataTransfer.types.includes('Files')) { dragDepthRef.current++; setDragging(true); } }}
      onDragOver={event => event.preventDefault()}
      onDragLeave={event => { event.preventDefault(); dragDepthRef.current = Math.max(0, dragDepthRef.current - 1); if (!dragDepthRef.current) setDragging(false); }}
      onDrop={event => { event.preventDefault(); dragDepthRef.current = 0; setDragging(false); void importFiles(Array.from(event.dataTransfer.files)); }}>
      <main className="shelf-main">
        {api.online && <nav className="library-navigation" aria-label="Reader 导航"><button aria-current="page">书架</button><button onClick={() => setOnlineOpen(true)}>找书</button></nav>}
        <div className="shelf-heading"><div><p className="eyebrow">留一点时间给阅读</p><h1>书架</h1><p className="shelf-description">从上次读到的地方，继续。</p></div><Button color="primary" variant="solid" pill={false} size="lg" type="button" className="primary-button import-button" disabled={importing || loading} onClick={() => fileInputRef.current?.click()}>{importing ? <LoaderCircle size={16} className="spin" /> : <Plus size={17} />}<span>{importing ? '导入中' : '导入书籍'}</span></Button></div>
        {error && <ErrorNotice text={error} onRetry={() => { if (failedOpenRef.current) void openBook(failedOpenRef.current); else void loadLibrary(); }} />}
        {importError && <ErrorNotice text={importError} onRetry={() => void importFiles(lastImportRef.current)} onClose={() => setImportError('')} />}
        {saveError && <ErrorNotice text={saveError} onRetry={() => void flushProgress()} />}
        {settingsError && <ErrorNotice text={settingsError} onRetry={flushSettings} />}
        {importing && <div className="import-status" role="status"><LoaderCircle size={16} className="spin" /><span>{importLabel}</span><span className="import-hint">请保持此窗口打开</span></div>}
        <div className="shelf-controls"><label className="search-field"><Search size={17} aria-hidden="true" /><input type="search" value={libraryQuery} onChange={event => setLibraryQuery(event.target.value)} placeholder="搜索书架" aria-label="搜索书名或作者" /></label><div className="shelf-utilities"><IconButton label={shelfLayout === 'cards' ? '切换列表' : '切换卡片'} onClick={() => setShelfLayout(value => value === 'cards' ? 'list' : 'cards')}><List size={18}/></IconButton><IconButton label="回收站" disabled={trashBusy} onClick={() => { if (trashBusyRef.current) return; setTrashOpen(true); void api.trashList().then(setTrashEntries).catch(reason => setError(messageOf(reason))); }}><Trash2 size={18}/></IconButton><span className="book-count">{books.length ? `${books.length} 本书` : 'TXT · EPUB'}</span><IconButton label="键盘快捷键" onClick={() => setHelpOpen(true)}><HelpCircle size={18} /></IconButton></div></div>
        {openingId && <button className="text-button" onClick={() => { openRequestRef.current++; if (onlineRequestRef.current) void api.online?.cancel(onlineRequestRef.current); setOpeningId(null); }}>取消打开</button>}{loading ? <div className="loading-library" aria-label="正在读取书架" role="status"><LoaderCircle size={23} className="spin" /><p>正在打开你的书架…</p></div> : books.length === 0 ? <section className="empty-library"><div className="empty-book" aria-hidden="true"><div className="empty-book-spine"/><BookOpen size={32} strokeWidth={1.2} /><span>下一页，从这里开始</span><div className="empty-book-line" /></div><h2>把想读的书，放在这里</h2><p>拖入 TXT 或 EPUB 文件，<br className="mobile-break" />或者选择一本书开始阅读。</p><button type="button" className="secondary-button" disabled={importing} onClick={() => fileInputRef.current?.click()}><FileUp size={16} />选择文件</button><div className="empty-format-note">自动记住阅读位置 · 随手收藏喜欢的段落</div></section> : visibleBooks.length === 0 ? <div className="no-search-results"><Search size={24} strokeWidth={1.5} /><h2>没有找到这本书</h2><p>试试其他书名或作者</p><button className="text-button" onClick={() => setLibraryQuery('')}>清除搜索</button></div> : <section className={`book-grid shelf-${shelfLayout}`} aria-label="书架中的书籍">{visibleBooks.map((item, index) => <div className="book-entry" key={item.id}><button type="button" className="book-card" onClick={() => void openBook(item.id)} disabled={openingId !== null || importing} aria-label={`打开 ${item.title}，${item.progress > 0 ? `已读 ${Math.round(item.progress * 100)}%` : '尚未开始'}`}>
          <div className={`book-cover cover-${index % 4}`}><div className="cover-top"><span>{item.format.toUpperCase()}</span><BookOpen size={16} strokeWidth={1.25} /></div><div className="cover-title">{item.title}</div><div className="cover-author">{item.author || '佚名'}</div><span className="cover-bottom">READER LIBRARY</span>{openingId === item.id && <div className="cover-loading"><LoaderCircle size={23} className="spin" /><span>正在打开</span></div>}</div>
          <div className="book-card-info"><h2 title={item.title}>{item.title}</h2><p>{item.author || '佚名'}<span>·</span>{item.format === 'online' ? `${item.chapterCount} 章 · 按需读取` : formatWords(item.wordCount)}</p><div className="book-progress-row"><span>{item.progress > 0 ? `已读 ${Math.round(item.progress * 100)}%` : '未开始'}</span><ArrowRight size={14} /></div><div className="book-progress-track"><span style={{ width: `${Math.max(0, Math.min(100, item.progress * 100))}%` }} /></div></div>
        </button><details className="book-more"><summary aria-label={`更多：${item.title}`}>•••</summary><div><button disabled={trashBusy || importing || openingId !== null} onClick={() => void trashBook(item.id)}>移到回收站</button></div></details></div>)}</section>}
        <details className="import-options"><summary>导入选项 <ChevronDown size={13} /></summary><div><label htmlFor="reader-encoding">TXT 文件编码</label><select id="reader-encoding" value={encoding} onChange={event => setEncoding(event.target.value)} disabled={importing}><option value="auto">自动识别（推荐）</option><option value="utf-8">UTF-8</option><option value="gb18030">GB18030 / GBK</option><option value="big5">Big5</option><option value="utf-16le">UTF-16 LE</option></select><p>如果已知 TXT 编码，可在首次导入前手动选择。</p></div></details>
      </main><footer className="shelf-footer"><span><Library size={13} />书籍保存在 Reader 服务中</span><span>支持 TXT 与无 DRM 的 EPUB</span></footer>
      {dragging && <div className="drop-overlay" aria-hidden="true"><FileUp size={36} strokeWidth={1.4} /><strong>松开，加入你的书架</strong><span>TXT 或 EPUB 文件</span></div>}
    </div> : <div className="reading-shell" inert={helpOpen || trashOpen} aria-busy={returning}>
      {returning && <div className="returning-overlay" role="status"><LoaderCircle size={18} className="spin" /><span>正在保存并返回…</span></div>}
      <header className="reader-toolbar"><div className="reader-title-group"><IconButton label={onlineOpen ? "返回找书" : "返回书架"} disabled={returning} onClick={() => void returnToShelf()}><ArrowLeft size={19} /></IconButton><span className="toolbar-divider"/><div className="reading-title" title={book.document.title}>{book.document.title}</div></div><nav className="reader-actions" aria-label="阅读工具"><IconButton label="目录（T）" active={panel === 'contents'} onClick={() => togglePanel('contents')}><List size={19} /></IconButton><IconButton label={`${searchLabel}（F）`} active={panel === 'search'} onClick={() => togglePanel('search')}><Search size={18} /></IconButton><IconButton label={bookmarked ? '移除当前段落书签（B）' : '收藏当前段落（B）'} active={bookmarked} disabled={bookmarkBusy} onClick={() => void toggleBookmark()}>{bookmarkBusy ? <LoaderCircle size={18} className="spin" /> : bookmarked ? <BookmarkIcon size={18} fill="currentColor" /> : <BookmarkPlus size={19} />}</IconButton><IconButton label="我的书签" active={panel === 'bookmarks'} onClick={() => togglePanel('bookmarks')}><BookmarkIcon size={18} /></IconButton><IconButton label="阅读样式" active={panel === 'appearance'} onClick={() => togglePanel('appearance')}><Settings2 size={19} /></IconButton></nav></header>
      {(saveError || bookmarkError || settingsError || importError) && <div className="reading-errors">{importError && <ErrorNotice text={importError} onClose={() => setImportError('')} />}{saveError && <ErrorNotice text={saveError} onRetry={() => void flushProgress()} />}{bookmarkError && <ErrorNotice text={bookmarkError} onClose={() => setBookmarkError('')} />}{settingsError && <ErrorNotice text={settingsError} onRetry={flushSettings} />}</div>}
      <div className="online-reading-status">{onlineBusy && <span role="status">正在读取章节… <button className="text-button" onClick={() => { openRequestRef.current++; if (onlineRequestRef.current) void api.online?.cancel(onlineRequestRef.current); setOnlineBusy(false); }}>取消联网</button></span>}{onlineError && <div className={onlineIncomplete?.paused ? "online-notice pagination-notice" : "error-notice"} role={onlineIncomplete?.paused ? "status" : "alert"}><span>{onlineError}</span><button className="text-button" disabled={onlineBusy} onClick={() => onlineRetryRef.current?.()}>{onlineIncomplete?.resumable ? onlineIncomplete.stage === "toc" ? "继续加载目录" : "继续加载章节" : "重试"}</button><IconButton label="关闭提示" onClick={() => setOnlineError('')}><X size={15} /></IconButton></div>}</div><div className="reading-layout">
        {panel && <><button type="button" className="panel-scrim" aria-label="关闭侧栏" onClick={() => setPanel(null)} /><aside className="reader-panel" ref={node => { if (!helpOpen) overlayRef.current = node; }} aria-label={panelTitle}><div className="panel-heading"><h2>{panelTitle}</h2><IconButton label={`关闭${panelTitle}`} onClick={() => setPanel(null)}><X size={18} /></IconButton></div>
          {panel === 'contents' && <><p className="panel-caption">{book.document.chapters.length} 个章节</p>{book.document.format === 'online' && <button type="button" className="text-button" disabled={onlineBusy} onClick={() => void refreshOnline()}>刷新在线目录</button>}<nav className="chapter-list" aria-label="章节目录">{book.document.chapters.map((chapter, index) => <button type="button" key={chapter.id || index} className={index === chapterIndex ? 'chapter-item selected' : 'chapter-item'} aria-current={index === chapterIndex ? 'location' : undefined} onClick={() => navigate({ chapter: index, paragraph: 0 })}><span className="chapter-number">{String(index + 1).padStart(2, '0')}</span><span>{chapter.title}</span>{index === chapterIndex && <span className="current-dot" />}</button>)}</nav></>}
          {panel === 'bookmarks' && <><button className="bookmark-current secondary-button" disabled={bookmarkBusy} onClick={() => void toggleBookmark()}>{bookmarkBusy ? <LoaderCircle size={16} className="spin" /> : <BookmarkIcon size={16} fill={bookmarked ? 'currentColor' : 'none'} />}{bookmarked ? '移除当前段落书签' : '收藏当前段落'}</button>{book.bookmarks.length ? <ul className="bookmark-list">{book.bookmarks.map(item => <li key={item.id}><button className="bookmark-jump" onClick={() => navigate(item.locator)}><span>{book.document.chapters[item.locator.chapter]?.title || '章节'}</span><p>{item.label}</p><small>第 {item.locator.paragraph + 1} 段</small></button><IconButton label={`移除书签：${item.label.slice(0, 20)}`} disabled={bookmarkBusy} onClick={() => void removeBookmark(item.id)}><Trash2 size={15} /></IconButton></li>)}</ul> : <EmptyHint title="留住值得再读的地方">阅读时按 B，或点上方按钮收藏当前段落。</EmptyHint>}</>}
          {panel === 'search' && <><label className="search-field panel-search"><Search size={16} /><input type="search" aria-label={`${searchLabel}内容`} placeholder="输入想找的文字" value={bookQuery} onChange={event => setBookQuery(event.target.value)} /></label>{book.document.format === 'online' && <p className="panel-caption">仅搜索当前章节「{activeChapter?.title}」；不包含其他已缓存章节，不自动下载全书。</p>}{bookQuery.trim() ? <><p className="panel-caption">{searchResults.length === 100 ? '显示前 100 条结果' : `${searchResults.length} 处匹配`}</p>{searchResults.length ? <div className="search-results">{searchResults.map(result => <button key={`${result.chapter}-${result.paragraph}`} onClick={() => navigate(result)}><span>{result.title}</span><p>{result.text}</p></button>)}</div> : <EmptyHint title="没有找到匹配的文字">试试更短的关键词</EmptyHint>}</> : <EmptyHint title="找回书中的一句话">{book.document.format === 'online' ? '输入文字，在当前章节中查找。' : '搜索会涵盖这本书的全部章节。'}</EmptyHint>}</>}
          {panel === 'appearance' && <div className="appearance-settings">{error && <ErrorNotice text={error} onClose={() => setError('')}/>}<fieldset><legend>颜色</legend><div className="theme-options">{themes.map(({ value, label, Icon }) => <button type="button" key={value} className={`theme-option theme-swatch-${value} ${settings.theme === value ? 'selected' : ''}`} aria-pressed={settings.theme === value} onClick={() => changeSettings({ theme: value })}><Icon size={18} /><span>{label}</span></button>)}</div></fieldset><fieldset><legend>字体</legend><div className="segmented"><button aria-pressed={settings.fontFamily === 'serif'} className={settings.fontFamily === 'serif' ? 'selected serif-option' : 'serif-option'} onClick={() => changeSettings({ fontFamily: 'serif' })}>宋体 / 衬线</button><button aria-pressed={settings.fontFamily === 'sans'} className={settings.fontFamily === 'sans' ? 'selected' : ''} onClick={() => changeSettings({ fontFamily: 'sans' })}>黑体 / 无衬线</button></div></fieldset><fieldset><legend>字号 <span>{settings.fontSize}px</span></legend><div className="size-control"><IconButton label="缩小字号" disabled={settings.fontSize <= 14} onClick={() => changeSettings({ fontSize: Math.max(14, settings.fontSize - 1) })}><Minus size={16} /></IconButton><span className="size-preview">字</span><IconButton label="增大字号" disabled={settings.fontSize >= 32} onClick={() => changeSettings({ fontSize: Math.min(32, settings.fontSize + 1) })}><Plus size={16} /></IconButton></div></fieldset><fieldset><legend><label htmlFor="reader-line-height">行间距</label><span>{settings.lineHeight.toFixed(1)}</span></legend><input id="reader-line-height" type="range" min="1.4" max="2.4" step="0.1" value={settings.lineHeight} onChange={event => changeSettings({ lineHeight: Number(event.target.value) })} /><div className="range-labels"><span>紧凑</span><span>舒展</span></div></fieldset><fieldset><legend><label htmlFor="reader-line-width">正文宽度</label><span>{settings.lineWidth}px</span></legend><input id="reader-line-width" type="range" min="460" max="960" step="20" value={settings.lineWidth} onChange={event => changeSettings({ lineWidth: Number(event.target.value) })} /><div className="range-labels"><span>窄</span><span>宽</span></div></fieldset><button type="button" className="text-button restore-settings" onClick={() => changeSettings(defaultSettings)}><RotateCcw size={13} />恢复默认样式</button><div className="reading-preferences"><button type="button" className="settings-action" aria-label="键盘快捷键设置" onClick={() => setHelpOpen(true)}><Keyboard size={16} aria-hidden="true" /><span>键盘快捷键</span><ChevronRight size={15} aria-hidden="true" /></button><details className="reading-more"><summary className="settings-action"><BookOpen size={16} aria-hidden="true" /><span>本书操作</span><ChevronDown size={15} aria-hidden="true" /></summary><div className="reading-more-content"><button type="button" className="text-button" disabled={trashBusy || bookmarkBusy} onClick={() => void trashBook(book.document.id)}><Trash2 size={14} />移到回收站</button><p>保留进度和书签，可随时恢复。</p></div></details></div></div>}
        </aside></>}
        <div className="reading-column"><div className="reading-scroll" ref={readingRef} onScroll={onReadingScroll} tabIndex={0} aria-label="正文，向下滚动阅读"><article className="reading-content"><div className="chapter-kicker">{book.document.author || '佚名'}<span>/</span>第 {chapterIndex + 1} 节，共 {book.document.chapters.length} 节</div><div className="chapter-heading"><h1>{activeChapter?.title || book.document.title}</h1></div>
          {book.document.warnings.length > 0 && chapterIndex === 0 && <details className="book-warnings"><summary><CircleAlert size={14} />导入提示（{book.document.warnings.length}）<ChevronDown size={13} /></summary><ul>{book.document.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
          <div className="reading-paragraphs">{activeChapter && readingBlocks(activeChapter).map(block => <p key={`${chapterIndex}-${block.start}`} className={book.bookmarks.some(item => item.locator.chapter === chapterIndex && item.locator.paragraph >= block.start && item.locator.paragraph < block.end) ? 'has-bookmark' : ''}>{block.pieces.map(piece => <span id={`reader-paragraph-${chapterIndex}-${piece.index}`} data-chapter={chapterIndex} data-reader-paragraph={piece.index} key={piece.index}>{piece.text}</span>)}</p>)}</div>
          <nav className="chapter-navigation" aria-label="前后章节"><button type="button" className="chapter-navigation-button" disabled={chapterIndex === 0} onClick={() => navigate({ chapter: chapterIndex - 1, paragraph: 0 })}><ChevronLeft size={17} /><span><small>上一章</small><strong>{book.document.chapters[chapterIndex - 1]?.title || '已是第一章'}</strong></span></button>{chapterIndex < book.document.chapters.length - 1 ? <button type="button" className="chapter-navigation-button next" onClick={() => navigate({ chapter: chapterIndex + 1, paragraph: 0 })}><span><small>下一章</small><strong>{book.document.chapters[chapterIndex + 1]?.title}</strong></span><ChevronRight size={17} /></button> : <div className="end-of-book"><span>本书完</span><button type="button" className="text-button" onClick={() => void returnToShelf()} disabled={returning}>{onlineOpen ? '回到找书' : '回到书架'} <ArrowRight size={14} /></button></div>}</nav>
        </article></div><footer className="reading-footer"><button type="button" className="current-chapter-label" onClick={() => togglePanel('contents')} title={activeChapter?.title}>{activeChapter?.title}</button><div className="reading-footer-right"><span className={`save-indicator ${saveState}`} title={saveState === 'saved' ? '阅读位置已保存在 Reader 服务中' : saveState === 'error' ? '阅读位置尚未保存' : '正在保存阅读位置'}>{saveState === 'saving' ? <LoaderCircle size={12} className="spin" /> : saveState === 'error' ? <CircleAlert size={12} /> : <span className="save-dot" />}<span>{saveState === 'saved' ? '已保存' : saveState === 'error' ? '未保存' : '保存中'}</span></span><span className="reading-percent">{progress}%</span><IconButton label="键盘快捷键（?）" className="footer-help" onClick={() => setHelpOpen(true)}><HelpCircle size={14} /></IconButton></div></footer><div className="reading-progress-line" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div></div>
      </div>
    </div>}
    {api.online && <OnlinePanel api={api.online} active={onlineOpen && !book} onClose={() => { setOnlineOpen(false); requestAnimationFrame(() => document.querySelector<HTMLElement>('.shelf-main .library-navigation button:nth-child(2)')?.focus()); }} onOpen={next => showBook(next)} />}
    {helpOpen && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setHelpOpen(false); }}><section className="help-dialog keyboard-dialog" role="dialog" aria-modal="true" aria-labelledby="keyboard-title" ref={node => { if (node) overlayRef.current = node; }} onKeyDown={trapDialogFocus}><div className="panel-heading"><h2 id="keyboard-title">键盘快捷键</h2><IconButton label="关闭键盘快捷键" onClick={() => setHelpOpen(false)}><X size={18} /></IconButton></div><KeyboardEditor value={keyboard} error={keyboardError} closeStatus={hostCloseMessage} onDismissCloseStatus={() => setHostCloseMessage('')} searchLabel={searchLabel} onSave={async value => { const saved = await api.saveKeyboard(value); setKeyboard(saved); setKeyboardError(''); }} onReset={async () => { setKeyboard(await api.resetKeyboard()); setKeyboardError(''); }} onCloseHost={requestHostClose}/></section></div>}
  </div>;
}
