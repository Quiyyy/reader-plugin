import {z} from 'zod';
import type {ReaderSettings} from './types.js';
import type {EpubAppearance} from './epub.js';

export const readerSettingsSchema=z.object({
  theme:z.enum(['system','light','sepia','dark']),fontSize:z.number().min(14).max(36),
  lineHeight:z.number().min(1.3).max(2.6),lineWidth:z.number().min(420).max(960),fontFamily:z.enum(['serif','sans']),
  epub:z.object({style:z.enum(['original','comfort']),flow:z.enum(['scroll','pages'])}).strict().optional(),
}).strict();

/** EPUB shares typography with text reading; only layout and flow are format-specific. */
export function epubAppearance(settings:ReaderSettings):EpubAppearance {
  return {style:settings.epub?.style??'original',flow:settings.epub?.flow??'scroll',fontSize:settings.fontSize};
}
