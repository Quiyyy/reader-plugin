import type { Chapter } from './types.js';

/** Source-fragment indexes stay stable; only the displayed paragraph grouping changes. */
export function readingBlocks(chapter: Chapter): { start: number; end: number; text: string; pieces: { index: number; text: string; offset: number }[] }[] {
  const starts = chapter.paragraphStarts ?? chapter.paragraphs.map((_, index) => index);
  return starts.map((start, block) => {
    const end = starts[block + 1] ?? chapter.paragraphs.length;
    let text = '';
    const pieces = [];
    for (let index = start; index < end; index++) {
      const source = chapter.paragraphs[index]!;
      // Preserve a word boundary when a Chinese paragraph wraps between Latin words.
      const separator = /[\p{Script=Latin}\p{N}]$/u.test(text) && /^[\p{Script=Latin}\p{N}]/u.test(source) ? ' ' : '';
      const piece = separator + source;
      pieces.push({ index, text: piece, offset: text.length });
      text += piece;
    }
    return { start, end, text, pieces };
  });
}
