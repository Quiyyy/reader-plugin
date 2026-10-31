import { useCallback, useEffect, useRef, useState, type DragEvent, type RefObject } from 'react';
import type { Folder } from '../shared/workspace';
import { libraryKey, moveDestinations, type LibraryEntry } from './library-entries';

export const LIBRARY_DRAG_TYPE = 'application/x-reader-library-items';
const targetKey = (id: string | null) => id ?? 'root';
interface Session { token: string; entries: LibraryEntry[] }
interface Options {
  root: RefObject<HTMLElement | null>; folders: Folder[]; disabled: boolean;
  folderId: string | null; query: string; selected: LibraryEntry[];
  onMove: (entries: LibraryEntry[], folderId: string | null) => void;
}

export function useLibraryDrag(options: Options) {
  const session = useRef<Session | null>(null), suppressUntil = useRef(0), speed = useRef(0);
  const [items, setItems] = useState<LibraryEntry[]>([]), [over, setOver] = useState<string>();
  const clear = useCallback(() => {
    if (session.current) suppressUntil.current = performance.now() + 300;
    session.current = null; speed.current = 0; setItems([]); setOver(undefined);
  }, []);
  useEffect(clear, [options.folderId, options.query, clear]);
  useEffect(() => { if (options.disabled) clear(); }, [options.disabled, clear]);
  useEffect(() => {
    if (!items.length) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape'&&!event.isComposing) { event.preventDefault(); event.stopImmediatePropagation(); clear(); } };
    let frame: number;
    const scroll = () => { if (speed.current) options.root.current?.scrollBy({ top: speed.current }); frame = requestAnimationFrame(scroll); };
    frame = requestAnimationFrame(scroll);
    window.addEventListener('dragend', clear); window.addEventListener('drop', clear); window.addEventListener('keydown', escape, true);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('dragend', clear); window.removeEventListener('drop', clear); window.removeEventListener('keydown', escape, true); };
  }, [items.length, clear, options.root]);
  const isInternal = (event: DragEvent) => !!session.current && event.dataTransfer.types.includes(LIBRARY_DRAG_TYPE);
  const allowed = (id: string | null) => !!session.current && !options.disabled && session.current.entries.some(entry => entry.parentId !== id) && moveDestinations(session.current.entries, options.folders).some(folder => (folder?.id ?? null) === id);
  const track = (event: DragEvent) => {
    const rect = options.root.current?.getBoundingClientRect();
    speed.current = rect ? event.clientY < rect.top + 70 ? -10 : event.clientY > rect.bottom - 55 ? 10 : 0 : 0;
  };
  const source = (entry: LibraryEntry) => ({
    draggable: !options.disabled,
    onDragStart: (event: DragEvent<HTMLElement>) => {
      if (options.disabled) { event.preventDefault(); return; }
      const selected = options.selected.some(item => libraryKey(item) === libraryKey(entry)) ? options.selected : [entry];
      const token = crypto.randomUUID(); session.current = { token, entries: selected };
      // Keep identifiers inside this page: a foreign drag payload cannot move library data.
      event.dataTransfer.setData(LIBRARY_DRAG_TYPE, token); event.dataTransfer.effectAllowed = 'move';
      suppressUntil.current = Infinity; setItems(selected); setOver(undefined);
    },
    onDragEnd: clear,
  });
  const target = (id: string | null) => ({
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!isInternal(event)) return;
      event.preventDefault(); event.stopPropagation(); track(event);
      const valid = allowed(id); event.dataTransfer.dropEffect = valid ? 'move' : 'none'; setOver(valid ? targetKey(id) : undefined);
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
      setOver(previous => previous === targetKey(id) ? undefined : previous);
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      if (!event.dataTransfer.types.includes(LIBRARY_DRAG_TYPE)) return;
      event.preventDefault(); event.stopPropagation();
      const current = session.current;
      const valid = isInternal(event) && allowed(id) && event.dataTransfer.getData(LIBRARY_DRAG_TYPE) === current?.token;
      clear();
      if (valid && current) options.onMove(current.entries, id);
    },
  });
  return {
    source, target, clear, count: items.length,
    isDragging: (entry: LibraryEntry) => items.some(item => libraryKey(item) === libraryKey(entry)),
    isOver: (id: string | null) => over === targetKey(id),
    canDrop: (id: string | null) => items.length > 0 && allowed(id),
    suppressClick: () => performance.now() < suppressUntil.current,
    resumeClick: () => { if (!session.current) suppressUntil.current = 0; },
    surface: {
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (!isInternal(event)) return;
        event.preventDefault(); track(event); event.dataTransfer.dropEffect = 'none'; setOver(undefined);
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) { speed.current = 0; setOver(undefined); }
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        if (event.dataTransfer.types.includes(LIBRARY_DRAG_TYPE)) { event.preventDefault(); clear(); return true; }
        return false;
      },
    },
  };
}
