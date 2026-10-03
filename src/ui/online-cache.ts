import type { BookDetail } from '../shared/types';

/** At most current/previous/next body text; never retain an entire online book. */
export function mergeOnlineChapters(previous: BookDetail | null, incoming: BookDetail, activeId: string): BookDetail {
  if (incoming.document.format !== 'online') return incoming;
  const old = previous?.document.id === incoming.document.id ? previous.document.chapters : [];
  const center = incoming.document.chapters.findIndex(chapter => chapter.id === activeId);
  const retained = new Map<string, string[]>();
  let bytes = 0;
  for (const index of [center, center + 1, center - 1]) {
    const chapter = incoming.document.chapters[index];
    if (!chapter) continue;
    const body = chapter.loaded ? chapter : old.find(item => item.id === chapter.id && item.loaded);
    if (!body) continue;
    const size = body.paragraphs.reduce((total, text) => total + text.length * 2, 0);
    if (index !== center && bytes + size > 12 * 1024 * 1024) continue;
    bytes += size; retained.set(chapter.id, body.paragraphs);
  }
  return { ...incoming, document: { ...incoming.document, chapters: incoming.document.chapters.map(chapter => ({ ...chapter, paragraphs: retained.get(chapter.id) ?? [], loaded: retained.has(chapter.id) })) } };
}
