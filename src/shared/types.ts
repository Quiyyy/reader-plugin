import type { KeyboardSettings } from './keyboard.js';
import type { OnlineApi } from './online.js';
import type { EpubApi } from './epub.js';
export type BookFormat = 'txt' | 'epub' | 'online';
export type Theme = 'system' | 'light' | 'sepia' | 'dark';
export interface ReaderSettings { theme: Theme; fontSize: number; lineHeight: number; lineWidth: number; fontFamily: 'serif' | 'sans'; }
export const defaultSettings: ReaderSettings = { theme: 'system', fontSize: 20, lineHeight: 1.9, lineWidth: 680, fontFamily: 'serif' };
export interface Locator { chapter: number; paragraph: number; chapterId?: string; }
export interface Bookmark { id: string; locator: Locator; label: string; createdAt: string; }
export interface BookSummary { tocComplete?: boolean; id: string; title: string; author: string; format: BookFormat; addedAt: string; lastReadAt?: string; progress: number; locator: Locator; chapterCount: number; wordCount: number; }
export interface Chapter { sourcePath?: string; id: string; title: string; paragraphs: string[]; paragraphStarts?: number[]; loaded?: boolean; }
export interface BookDocument { tocComplete?: boolean; id: string; title: string; author: string; format: BookFormat; chapters: Chapter[]; encoding?: string; warnings: string[]; layoutVersion?: number; }
export interface BookDetail { summary: BookSummary; document: BookDocument; bookmarks: Bookmark[]; }
export interface LibraryState { books: BookSummary[]; settings: ReaderSettings; storage: { mode: 'server'; description: string }; }
export interface TrashEntry { version: 1; summary: BookSummary; trashedAt: string; }
export interface ReaderApi { epub?: EpubApi; keyboard(): Promise<KeyboardSettings>; saveKeyboard(value: KeyboardSettings): Promise<KeyboardSettings>; resetKeyboard(): Promise<KeyboardSettings>; trashList(): Promise<TrashEntry[]>; trash(id: string): Promise<TrashEntry>; restore(id: string): Promise<void>; requestHostClose?(): Promise<{ status: 'requested' | 'unsupported'; message: string }>; online?: OnlineApi; onBeforeClose?(listener: () => Promise<unknown>): () => void; onExternalBook?(listener: (book: BookDetail) => void, onError: (message: string) => void): () => void; list(): Promise<LibraryState>; importBook(file: File, encoding?: string): Promise<BookDetail>; open(id: string, requestId?: string): Promise<BookDetail>; saveProgress(id: string, locator: Locator): Promise<BookSummary>; saveSettings(settings: ReaderSettings): Promise<ReaderSettings>; addBookmark(id: string, locator: Locator, label: string): Promise<Bookmark[]>; removeBookmark(id: string, bookmarkId: string): Promise<Bookmark[]>; }
