import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { keyboardSchema, defaultKeyboard } from '../shared/keyboard.js';
import type { ReaderStore } from './store.js';
import { OnlineSourceService } from './online/service.js';

const locator = z.object({ chapter: z.number().int().min(0), paragraph: z.number().int().min(0), chapterId: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict();
const id = z.string().regex(/^[a-f0-9]{64}$/);
const requestId = z.string().uuid();
const onlineResult = z.object({ sourceId: id, revision: id, title: z.string().max(500), author: z.string().max(500), url: z.string().max(4096) }).strict();
export const settingsSchema = z.object({ theme: z.enum(['system','light','sepia','dark']), fontSize: z.number().min(14).max(36), lineHeight: z.number().min(1.3).max(2.6), lineWidth: z.number().min(420).max(960), fontFamily: z.enum(['serif','sans']) }).strict();
const MAX_FILE = 32 * 1024 * 1024;
const MAX_CHUNK = 256 * 1024;
const TTL = 15 * 60 * 1000;
export const actionSchemas = {
  reader_keyboard: z.object({}).strict(),
  reader_keyboard_save: z.object({ settings: keyboardSchema }).strict(),
  reader_keyboard_reset: z.object({}).strict(),
  reader_trash_list: z.object({}).strict(),
  reader_trash: z.object({ id }).strict(),
  reader_restore: z.object({ id }).strict(),
  reader_list: z.object({}).strict(),
  reader_get: z.object({ id, requestId: requestId.optional() }).strict(),
  reader_online_sources: z.object({}).strict(),
  reader_catalog_preview: z.object({ packageJson: z.string().max(1024 * 1024) }).strict(),
  reader_online_preview: z.object({ json: z.string().max(512 * 1024) }).strict(),
  reader_online_preview_url: z.object({ url: z.string().max(4096), requestId }).strict(),
  reader_online_commit: z.object({ token: z.string().uuid() }).strict(),
  reader_online_enable: z.object({ id, enabled: z.boolean() }).strict(),
  reader_online_remove: z.object({ id }).strict(),
  reader_online_search: z.object({ sourceId: id, key: z.string().trim().min(1).max(200), page: z.number().int().min(1).max(5), requestId }).strict(),
  reader_online_detail: z.object({ result: onlineResult, requestId }).strict(),
  reader_online_add: z.object({ detail: onlineResult.extend({ intro: z.string().max(10000), tocUrl: z.string().max(4096) }), requestId }).strict(),
  reader_online_chapter: z.object({ id, chapterId: id, requestId }).strict(),
  reader_online_refresh: z.object({ id, requestId }).strict(),
  reader_online_cancel: z.object({ requestId }).strict(),
  reader_import_begin: z.object({ filename: z.string().min(1).max(255), size: z.number().int().min(1).max(MAX_FILE), encoding: z.enum(['utf-8','utf-16le','utf-16be','gb18030','big5']).optional() }).strict(),
  reader_import_chunk: z.object({ uploadId: z.string().uuid(), index: z.number().int().min(0), data: z.string().max(Math.ceil(MAX_CHUNK / 3) * 4).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/) }).strict(),
  reader_import_finish: z.object({ uploadId: z.string().uuid() }).strict(),
  reader_import_cancel: z.object({ uploadId: z.string().uuid() }).strict(),
  reader_progress: z.object({ id, locator }).strict(),
  reader_settings: z.object({ settings: settingsSchema }).strict(),
  reader_bookmark_add: z.object({ id, locator, label: z.string().max(240) }).strict(),
  reader_bookmark_remove: z.object({ id, bookmarkId: z.string().max(100) }).strict(),
} as const;
export type ActionName = keyof typeof actionSchemas;
type Upload = { filename: string; size: number; encoding?: string; chunks: Buffer[]; received: number; next: number; expires: number };
export class ReaderService {
  private uploads = new Map<string, Upload>();
  readonly online: OnlineSourceService;
  constructor(public readonly store: ReaderStore, online?: OnlineSourceService) { this.online = online ?? new OnlineSourceService(store); }
  async call(name: string, input: unknown): Promise<unknown> {
    for (const [key, value] of this.uploads) if (value.expires < Date.now()) this.uploads.delete(key);
    if (!Object.hasOwn(actionSchemas, name)) throw new Error('未知的 Reader 操作');
    const args = actionSchemas[name as ActionName].parse(input) as any;
    switch (name as ActionName) {
      case 'reader_keyboard': return this.store.keyboard();
      case 'reader_keyboard_save': return this.store.saveKeyboard(args.settings);
      case 'reader_keyboard_reset': return this.store.saveKeyboard(defaultKeyboard);
      case 'reader_trash_list': return this.store.listTrash();
      case 'reader_trash': return (await this.online.has(args.id) ? this.online : this.store).trashBook(args.id);
      case 'reader_restore': await this.store.restoreBook(args.id); return { restored: true };
      case 'reader_list': { const library = await this.store.list(); return { ...library, books: [...library.books, ...await this.online.listBooks()] }; }
      case 'reader_get': return await this.online.has(args.id) ? this.online.run(args.requestId ?? randomUUID(), `open:${args.id}`, signal => this.online.open(args.id, signal)) : this.store.open(args.id);
      case 'reader_progress': return (await this.online.has(args.id) ? this.online : this.store).saveProgress(args.id, args.locator);
      case 'reader_settings': return this.store.saveSettings(args.settings);
      case 'reader_bookmark_add': return (await this.online.has(args.id) ? this.online : this.store).addBookmark(args.id, args.locator, args.label);
      case 'reader_bookmark_remove': return (await this.online.has(args.id) ? this.online : this.store).removeBookmark(args.id, args.bookmarkId);
      case 'reader_online_sources': return this.online.listSources();
      case 'reader_catalog_preview': return this.online.previewCatalog(args.packageJson);
      case 'reader_online_preview': return this.online.preview(args.json);
      case 'reader_online_preview_url': return this.online.run(args.requestId, `preview:${args.url}`, signal => this.online.previewUrl(args.url, signal));
      case 'reader_online_commit': return this.online.commit(args.token);
      case 'reader_online_enable': return this.online.manage(args.id, args.enabled);
      case 'reader_online_remove': return this.online.manage(args.id, null);
      case 'reader_online_search': return this.online.run(args.requestId, `search:${args.sourceId}:${args.key}:${args.page}`, signal => this.online.search(args.sourceId, args.key, args.page, signal));
      case 'reader_online_detail': return this.online.run(args.requestId, `detail:${JSON.stringify(args.result)}`, signal => this.online.detail(args.result, signal));
      case 'reader_online_add': return this.online.run(args.requestId, `add:${JSON.stringify(args.detail)}`, signal => this.online.add(args.detail, signal));
      case 'reader_online_chapter': return this.online.run(args.requestId, `chapter:${args.id}:${args.chapterId}`, signal => this.online.chapter(args.id, args.chapterId, signal));
      case 'reader_online_refresh': return this.online.run(args.requestId, `refresh:${args.id}`, signal => this.online.refresh(args.id, signal));
      case 'reader_online_cancel': return this.online.cancel(args.requestId);
      case 'reader_import_begin': {
        if (this.uploads.size >= 2) throw new Error('同时导入过多，请稍后重试');
        if (!/\.(txt|epub)$/i.test(args.filename)) throw new Error('目前支持 TXT 和 EPUB 文件');
        const uploadId = randomUUID();
        this.uploads.set(uploadId, { ...args, chunks: [], received: 0, next: 0, expires: Date.now() + TTL });
        return { uploadId, chunkBytes: 192 * 1024 };
      }
      case 'reader_import_chunk': {
        const upload = this.uploads.get(args.uploadId);
        if (!upload) throw new Error('导入已过期，请重新选择文件');
        if (args.index !== upload.next) throw new Error('导入分块顺序错误，请重新导入');
        const bytes = Buffer.from(args.data, 'base64');
        if (!bytes.length || bytes.length > MAX_CHUNK || upload.received + bytes.length > upload.size) throw new Error('文件大小与导入声明不一致');
        upload.chunks.push(bytes); upload.received += bytes.length; upload.next++; upload.expires = Date.now() + TTL;
        return { received: upload.received };
      }
      case 'reader_import_finish': {
        const upload = this.uploads.get(args.uploadId);
        if (!upload) throw new Error('导入已过期，请重新选择文件');
        this.uploads.delete(args.uploadId);
        if (upload.received !== upload.size) throw new Error('文件传输不完整，请重试');
        return this.store.importBook(upload.filename, Buffer.concat(upload.chunks), upload.encoding);
      }
      case 'reader_import_cancel': this.uploads.delete(args.uploadId); return { cancelled: true };
    }
  }
}
