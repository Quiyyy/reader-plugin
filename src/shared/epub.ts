import { z } from 'zod';
export interface EpubTarget { resource: string; fragment?: string; }
export interface EpubToc { label: string; target: EpubTarget; children: EpubToc[]; }
export interface EpubSection { path: string; title: string; legacyChapter?: number; size: number; }
export interface EpubResource { path: string; mediaType: string; size: number; }
export interface EpubPackage { version: 2; id: string; sections: EpubSection[]; toc: EpubToc[]; resources: EpubResource[]; layout: 'reflowable' | 'fixed'; direction: 'ltr' | 'rtl'; warnings: string[]; }
/** No arbitrary HTML/URL/CSS crosses this boundary. Only reconstructed allowlisted nodes. */
export type EpubNode = string | { tag: string; attrs: Record<string, string>; children: EpubNode[]; target?: EpubTarget; resource?: string; note?: boolean; };
export interface EpubCssRule { selector: string; declarations: Record<string, string>; }
export interface EpubFont { family: string; resource: string; weight?: string; style?: string; }
export interface EpubChapter { resource: string; nodes: EpubNode[]; styles: EpubCssRule[]; fonts: EpubFont[]; warnings: string[]; }
export const epubLocationSchema = z.object({ version: z.literal(2), sourceHash: z.string().regex(/^[a-f0-9]{64}$/), resource: z.string().min(1).max(1024), element: z.string().max(128), offset: z.number().int().min(0).max(16000000), quote: z.object({ exact: z.string().max(160), prefix: z.string().max(60), suffix: z.string().max(60) }).strict() }).strict();
export type EpubLocation = z.infer<typeof epubLocationSchema>;
export interface EpubMark { id: string; label: string; createdAt: string; location?: EpubLocation; legacy?: { chapter: number; paragraph: number }; }
export const epubAppearanceSchema = z.object({ style: z.enum(['original','comfort']), flow: z.enum(['scroll','pages']), fontSize: z.number().min(14).max(36) }).strict();
export type EpubAppearance = z.infer<typeof epubAppearanceSchema>;
export interface EpubState { version: 2; sourceHash: string; location?: EpubLocation; bookmarks: EpubMark[]; appearance: EpubAppearance; updatedAt?: string; legacyRevision: string; }
export interface EpubOpen { package: EpubPackage; state: EpubState; legacyLocation?: { resource: string; exact: string; prefix: string; suffix: string }; }
export interface EpubApi {
  open(id: string): Promise<EpubOpen>;
  chapter(id: string, resource: string): Promise<EpubChapter>;
  resource(id: string, resource: string, offset: number): Promise<{ mediaType: string; data: string; total: number; next: number | null }>;
  save(id: string, location: EpubLocation, appearance: EpubAppearance): Promise<{ progress: number; lastReadAt: string }>;
  settings(id: string, appearance: EpubAppearance): Promise<void>;
  bookmark(id: string, location: EpubLocation, label: string): Promise<EpubMark[]>;
  removeBookmark(id: string, bookmarkId: string): Promise<EpubMark[]>;
}
