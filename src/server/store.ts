import {readerSettingsSchema} from '../shared/reader-settings.js';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { isAbsolute, join, resolve, relative } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { defaultSettings, type BookDetail, type BookSummary, type Bookmark, type LibraryState, type Locator, type ReaderSettings } from '../shared/types.js';
import { keyboardSchema, defaultKeyboard, type KeyboardSettings } from '../shared/keyboard.js';
import type { TrashEntry } from '../shared/types.js';
import { importDocument, IMPORT_LIMITS, normalizeEncoding } from './importers.js';
import {assertUnchanged} from './sync/entities.js';

const locatorSchema = z.object({ chapter: z.number().int().nonnegative(), paragraph: z.number().int().nonnegative() });
const settingsSchema = readerSettingsSchema;
const summarySchema = z.object({ id: z.string().regex(/^[a-f0-9]{64}$/), title: z.string(), author: z.string(), format: z.enum(['txt', 'epub']), addedAt: z.string(), lastReadAt: z.string().optional(), progress: z.number().min(0).max(1), locator: locatorSchema, chapterCount: z.number().int().positive(), wordCount: z.number().int().nonnegative() });
const bookmarkSchema = z.object({ id: z.string(), locator: locatorSchema, label: z.string(), createdAt: z.string() });
const chapterSchema = z.object({ sourcePath: z.string().optional(), id: z.string(), title: z.string(), paragraphs: z.array(z.string()).min(1), paragraphStarts: z.array(z.number().int().nonnegative()).min(1).optional() }).refine(chapter => !chapter.paragraphStarts || chapter.paragraphStarts.every((start, index, starts) => start < chapter.paragraphs.length && (index === 0 ? start === 0 : start > starts[index - 1]!)), 'Invalid reading paragraph boundaries');
const textCompatibilitySchema = z.object({ version: z.literal(1), paddingCharacters: z.number().int().nonnegative(), paddingLines: z.number().int().nonnegative(), formFeeds: z.number().int().nonnegative(), verticalTabs: z.number().int().nonnegative(), terminalEof: z.number().int().min(0).max(1) });
const documentSchema = z.object({ id: z.string(), title: z.string(), author: z.string(), format: z.enum(['txt', 'epub']), chapters: z.array(chapterSchema).min(1), encoding: z.string().optional(), warnings: z.array(z.string()), layoutVersion: z.number().int().positive().optional(), textCompatibility: textCompatibilitySchema.optional() });
const stateSchema = z.object({ version: z.literal(1), originalFilename: z.string(), summary: summarySchema, bookmarks: z.array(bookmarkSchema) });
type StoredBook = z.infer<typeof stateSchema> & { document: z.infer<typeof documentSchema> };
const isMissing = (error: unknown): boolean => !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';

/** Atomic same-directory replace; private modes; fsync contents before rename. */
export async function atomicWrite(filename: string, contents: string | Uint8Array): Promise<void> {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  const handle = await fs.open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(contents);
    await handle.sync();
    await handle.close();
    // Windows readers or scanners can briefly deny replacement. Retry the same
    // fully written file; never unlink the destination or expose partial data.
    for (let attempt = 0; ; attempt++) {
      try { await fs.rename(temporary, filename); break; }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (attempt >= 5 || !['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '')) throw error;
        await delay(Math.min(50 * 2 ** attempt, 400));
      }
    }
  } catch (error) {
    await handle.close().catch(() => undefined);
    await fs.unlink(temporary).catch(() => undefined);
    throw error;
  }
}
async function syncDirectory(path: string): Promise<void> {
  // Directory fsync is supported on Unix, but not all filesystems/platforms.
  try { const handle = await fs.open(path, constants.O_RDONLY); try { await handle.sync(); } finally { await handle.close(); } } catch { /* The file itself has already been fsynced. */ }
}
function countWords(paragraphs: string[]): number {
  let count = 0;
  for (const text of paragraphs) {
    // Han characters count individually; other words use Unicode letters/numbers.
    count += (text.match(/\p{Script=Han}/gu) ?? []).length;
    count += (text.replace(/\p{Script=Han}/gu, ' ').match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? []).length;
  }
  return count;
}
function detail(record: StoredBook): BookDetail { return { summary: record.summary, document: record.document, bookmarks: record.bookmarks }; }

/**
 * Server-owned, durable library. The caller must choose an app-data directory,
 * e.g. XDG_DATA_HOME/reader-plugin, outside the plugin checkout. Sources are kept
 * byte-for-byte beside versioned JSON records; no book text is sent elsewhere.
 */
export class ReaderStore {
  readonly dataDir: string;
  private readonly booksDir: string;
  private readonly locksDir: string;
  private readonly ready: Promise<void>;

  /** Rich EPUB state is a separate representation. These never rewrite legacy records. */
  async epubSnapshot(id: string) {
    return this.locked(id, async () => {
      const record = await this.readBook(id);
      if (record.document.format !== 'epub') throw new Error('This book is not an EPUB.');
      const source = await fs.readFile(join(this.bookPath(id), 'source.epub'));
      if (createHash('sha256').update(source).digest('hex') !== id) throw new Error('EPUB source hash mismatch.');
      let rich: unknown;
      try { rich = JSON.parse(await fs.readFile(join(this.bookPath(id), 'epub-v2.json'), 'utf8')); }
      catch(error) { if (!isMissing(error)) throw new Error('Saved EPUB reading state is damaged; original data is retained.'); }
      return { source, detail: detail(record), rich };
    });
  }
  async updateEpub<T>(id: string, update: (value: unknown, book: BookDetail) => { state: unknown; result: T }): Promise<T> {
    return this.locked(id, async () => {
      const record = await this.readBook(id);
      if(record.document.format !== 'epub') throw new Error('This book is not an EPUB.');
      let rich: unknown;
      const path=join(this.bookPath(id),'epub-v2.json');
      try { rich=JSON.parse(await fs.readFile(path,'utf8')); } catch(error) { if(!isMissing(error)) throw error; }
      const value=update(rich,detail(record));
      await atomicWrite(path,JSON.stringify(value.state));await syncDirectory(this.bookPath(id));
      return value.result;
    });
  }

  constructor(dataDir: string) {
    if (!dataDir || !isAbsolute(dataDir)) throw new Error('Reader storage requires an absolute app-data directory.');
    this.dataDir = resolve(dataDir);
    this.booksDir = join(this.dataDir, 'books');
    this.locksDir = join(this.dataDir, '.locks');
    this.ready = Promise.all([fs.mkdir(this.booksDir, { recursive: true, mode: 0o700 }), fs.mkdir(this.locksDir, { recursive: true, mode: 0o700 })]).then(() => undefined);
  }

  private bookPath(id: string): string {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid book ID.');
    return join(this.booksDir, id);
  }

  /** Per-book, cross-process locks prevent two plugin clients losing each other's updates. */
  async locked<T>(key: string, work: () => Promise<T>): Promise<T> {
    if (!/^[a-z0-9-]+$/.test(key)) throw new Error('Invalid lock key.');
    await this.ready;
    const lockPath = join(this.locksDir, key);
    const ownerPath = join(lockPath, 'owner.json');
    const token = randomUUID();
    const deadline = Date.now() + 10_000;
    while (true) {
      try {
        await fs.mkdir(lockPath, { mode: 0o700 });
        try { await fs.writeFile(ownerPath, JSON.stringify({ pid: process.pid, token }), { mode: 0o600, flag: 'wx' }); }
        catch (error) { await fs.rm(lockPath, { recursive: true, force: true }); throw error; }
        break;
      } catch (error) {
        if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'EEXIST') throw error;
        try {
          const owner = JSON.parse(await fs.readFile(ownerPath, 'utf8'));
          if (Number.isInteger(owner.pid) && owner.pid > 0) {
            let dead = false;
            try { process.kill(owner.pid, 0); }
            catch (probeError) { dead = !!probeError && typeof probeError === 'object' && 'code' in probeError && probeError.code === 'ESRCH'; }
            if (dead) { await fs.rm(lockPath, { recursive: true, force: true }); continue; }
          }
        } catch (readError) {
          if (isMissing(readError)) {
            // A process can crash between mkdir and writing its lock owner.
            const stat = await fs.stat(lockPath).catch(() => undefined);
            if (stat && Date.now() - stat.mtimeMs > 30_000) { await fs.rm(lockPath, { recursive: true, force: true }); continue; }
          }
        }
        if (Date.now() >= deadline) throw new Error('The library is busy in another Reader process. Try again shortly.');
        await delay(25);
      }
    }
    try { return await work(); }
    finally {
      const owner = await fs.readFile(ownerPath, 'utf8').then(text => JSON.parse(text)).catch(() => undefined);
      if (owner?.token === token) await fs.rm(lockPath, { recursive: true, force: true });
    }
  }

  private trashPath(id: string) { this.bookPath(id); return join(this.dataDir, 'trash-v1', `${id}.json`); }
  async isTrashed(id: string): Promise<boolean> {
    try { return (await this.readTrash(id)).state === 'trashed'; } catch (error) { if (isMissing(error)) return false; throw error; }
  }
  async lifecycle(id: string): Promise<string> { try { return await fs.readFile(this.trashPath(id), 'utf8'); } catch (error) { if (isMissing(error)) return ''; throw error; } }
  async assertActive(id: string) { if (await this.isTrashed(id)) throw new Error('这本书已在回收站，请先恢复；进度、书签及缓存均已保留。'); }
  /** Caller holds the same per-book lock used by every writer. One atomic marker
   * gates the entire book, source bytes, bookmarks, progress and online cache.
   * No multi-file move/copy or permanent deletion, so interruption cannot split it. */
  async markTrashed(summary: BookSummary,when?:string): Promise<TrashEntry> {
    const entry: TrashEntry = { version: 1, summary, trashedAt: when?z.string().datetime().parse(when):new Date().toISOString() };
    const directory = join(this.dataDir, 'trash-v1');
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await atomicWrite(this.trashPath(summary.id), JSON.stringify({ ...entry, state: 'trashed', generation: randomUUID() })); await syncDirectory(directory);
    return entry;
  }
  async trashBook(id: string): Promise<TrashEntry> { return this.locked(id, async () => this.markTrashed((await this.readState(id)).summary)); }
  async syncLifecycle(summary:BookSummary,before:string|undefined,after:string|undefined){return this.locked(summary.format==='pdf'?'pdf-'+summary.id:summary.format==='online'?'online-'+summary.id:summary.id,async()=>{let current:Awaited<ReturnType<ReaderStore['readTrash']>>|undefined;try{current=await this.readTrash(summary.id);}catch(e){if(!isMissing(e))throw e;}assertUnchanged(current?.state==='trashed'?current.trashedAt:null,before??null);if(after)await this.markTrashed(summary,after);else if(current?.state==='trashed')await atomicWrite(this.trashPath(summary.id),JSON.stringify({...current,state:'active',generation:randomUUID()}));});}
  private async readTrash(id: string): Promise<TrashEntry & { state: 'trashed' | 'active' }> {
    const schema = z.object({ state: z.enum(['trashed', 'active']).default('trashed'), version: z.literal(1), summary: summarySchema.extend({ format: z.enum(['txt', 'epub', 'online', 'pdf']), locator: locatorSchema.extend({ chapterId: z.string().optional() }) }), trashedAt: z.string() });
    const entry = schema.parse(JSON.parse(await fs.readFile(this.trashPath(id), 'utf8')));
    if (entry.summary.id !== id) throw new Error('回收站记录损坏；原文件未改动');
    return entry;
  }
  async listTrash(): Promise<TrashEntry[]> {
    const directory = join(this.dataDir, 'trash-v1');
    let names: string[]; try { names = await fs.readdir(directory); } catch (error) { if (isMissing(error)) return []; throw error; }
    const entries: TrashEntry[] = [];
    for (const name of names.filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
      try { const entry = await this.readTrash(name.slice(0, -5)); if (entry.state === 'trashed') entries.push(entry); } catch (error) { if (!isMissing(error)) throw error; }
    }
    return entries.sort((a, b) => b.trashedAt.localeCompare(a.trashedAt));
  }
  async restoreBook(id: string): Promise<void> {
    const entry = await this.readTrash(id);
    await this.locked(entry.summary.format === 'online' ? `online-${id}` : entry.summary.format === 'pdf' ? `pdf-${id}` : id, async () => {
      const latest = await this.readTrash(id);
      if (latest.state !== 'trashed') return;
      // IDs, not titles, are identities. Same-title books coexist unchanged.
      const record = entry.summary.format === 'pdf' ? join(this.dataDir,'pdf-v1',id,'record.json') : entry.summary.format === 'online' ? join(this.dataDir, 'online-v1', `${id}.json`) : join(this.bookPath(id), 'record.json');
      await fs.access(record);
      await atomicWrite(this.trashPath(id), JSON.stringify({ ...entry, state: 'active', generation: randomUUID() })); await syncDirectory(join(this.dataDir, 'trash-v1'));
    });
  }
  async purgeBook(id:string,trashedAt:string):Promise<{deleted:true}>{
    this.bookPath(id);const entry=await this.readTrash(id),key=entry.summary.format==='online'?`online-${id}`:entry.summary.format==='pdf'?`pdf-${id}`:id;
    return this.locked(key,async()=>{const latest=await this.readTrash(id);if(latest.state!=='trashed'||latest.trashedAt!==trashedAt)throw Error('回收站条目已变化，请刷新后重试');
      const targets=latest.summary.format==='pdf'?[join(this.dataDir,'pdf-v1',id)]:latest.summary.format==='online'?[join(this.dataDir,'online-v1',`${id}.json`),join(this.dataDir,'online-v1','cache',id)]:[this.bookPath(id)];
      for(const target of targets){const inside=relative(this.dataDir,resolve(target));if(!inside||isAbsolute(inside)||inside.startsWith('..'))throw Error('拒绝删除书库之外的内容');await fs.rm(target,{recursive:true,force:true});}
      await fs.unlink(this.trashPath(id));return {deleted:true};});
  }
  async keyboard(): Promise<KeyboardSettings> {
    try { return keyboardSchema.parse(JSON.parse(await fs.readFile(join(this.dataDir, 'keyboard-v1.json'), 'utf8'))); }
    catch (error) { if (isMissing(error)) return structuredClone(defaultKeyboard); throw new Error('快捷键设置损坏，请恢复默认；旧设置保留在备份中。'); }
  }
  async saveKeyboard(value: KeyboardSettings, expected?:KeyboardSettings): Promise<KeyboardSettings> {
    const checked = keyboardSchema.parse(value);
    return this.locked('keyboard', async () => {
      if(expected)assertUnchanged(await this.keyboard(),expected);
      const path = join(this.dataDir, 'keyboard-v1.json');
      try { await atomicWrite(join(this.dataDir, 'keyboard-v1.before-save.json'), await fs.readFile(path)); } catch (error) { if (!isMissing(error)) throw error; }
      await atomicWrite(path, JSON.stringify(checked)); await syncDirectory(this.dataDir); return checked;
    });
  }

  private async readState(id: string): Promise<z.infer<typeof stateSchema>> {
    await this.ready;
    await this.assertActive(id);
    try {
      const state = stateSchema.parse(JSON.parse(await fs.readFile(join(this.bookPath(id), 'record.json'), 'utf8')));
      if (state.summary.id !== id) throw new Error('Mismatched book ID');
      return state;
    } catch (error) {
      if (isMissing(error)) throw new Error('Book not found in this library.');
      throw new Error('This book record is damaged. Your original source file is still preserved in the library.');
    }
  }
  private async readBook(id: string): Promise<StoredBook> {
    const state = await this.readState(id);
    try {
      let document = documentSchema.parse(JSON.parse(await fs.readFile(join(this.bookPath(id), 'document.json'), 'utf8')));
      if (document.id !== id) throw new Error('Mismatched document ID');
      if (document.format === 'txt' && (document.layoutVersion ?? 1) < 2) {
        // All callers hold the per-book lock. Upgrade display metadata only:
        // original fragments, locators, progress, bookmarks and timestamps stay
        // byte-for-byte stable. A stale open client can still save its locator.
        const directory = this.bookPath(id);
        const source = await fs.readFile(join(directory, 'source.txt'));
        const parsed = importDocument(state.originalFilename, source, document.encoding);
        if (parsed.id !== id || parsed.chapters.length !== document.chapters.length || parsed.chapters.some((chapter, index) => JSON.stringify(chapter.paragraphs) !== JSON.stringify(document.chapters[index]!.paragraphs))) {
          throw new Error('Source structure does not match the saved reading positions; text layout was not changed.');
        }
        await atomicWrite(join(directory, 'document.before-layout-v2.json'), JSON.stringify(document));
        await atomicWrite(join(directory, 'record.before-layout-v2.json'), JSON.stringify(state));
        document = { ...document, layoutVersion: 2, chapters: document.chapters.map((chapter, index) => ({ ...chapter, paragraphStarts: parsed.chapters[index]!.paragraphStarts })) };
        await atomicWrite(join(directory, 'document.json'), JSON.stringify(document));
        await syncDirectory(directory);
      }
      return { ...state, document };
    } catch {
      throw new Error('This book document is damaged. Your original source file is still preserved in the library.');
    }
  }

  /** Explicit maintenance path; never marks a book as read or rewrites its record. */
  async reflowText(id: string): Promise<{ id: string; layoutVersion: number; fragments: number; readingParagraphs: number }> {
    this.bookPath(id);
    return this.locked(id, async () => {
      const { document } = await this.readBook(id);
      return { id, layoutVersion: document.layoutVersion ?? 1, fragments: document.chapters.reduce((n, chapter) => n + chapter.paragraphs.length, 0), readingParagraphs: document.chapters.reduce((n, chapter) => n + (chapter.paragraphStarts?.length ?? chapter.paragraphs.length), 0) };
    });
  }
  private async writeBook(record: StoredBook): Promise<void> {
    const directory = this.bookPath(record.summary.id);
    const { document: _document, ...state } = record;
    await atomicWrite(join(directory, 'record.json'), JSON.stringify(state));
    await syncDirectory(directory);
  }
  private validLocator(record: StoredBook, locator: Locator): Locator {
    const checked = locatorSchema.parse(locator);
    const chapter = record.document.chapters[checked.chapter];
    if (!chapter || checked.paragraph >= chapter.paragraphs.length) throw new Error('Reading position is outside this book.');
    return checked;
  }

  async list(): Promise<LibraryState> {
    await this.ready;
    const directories = await fs.readdir(this.booksDir, { withFileTypes: true });
    const books: BookSummary[] = [];
    // Fail explicitly on corruption rather than making a stored book silently disappear.
    for (const entry of directories) if (entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name)) await this.locked(entry.name, async () => {
      if (await this.isTrashed(entry.name)) return;
      const summary=(await this.readState(entry.name)).summary;
      if(summary.format==='epub'){
        try{
          const rich=JSON.parse(await fs.readFile(join(this.bookPath(entry.name),'epub-v2.json'),'utf8'));
          const revision=createHash('sha256').update(JSON.stringify(summary.locator)).digest('hex');
          if(rich.version===2&&rich.sourceHash===summary.id&&rich.legacyRevision===revision&&typeof rich.progress==='number'&&rich.progress>=0&&rich.progress<=1){summary.progress=rich.progress;if(typeof rich.updatedAt==='string'&&rich.updatedAt>(summary.lastReadAt??''))summary.lastReadAt=rich.updatedAt;}
        }catch(error){if(!isMissing(error))throw new Error('Saved EPUB reading state is damaged; original book data is retained.');}
      }
      books.push(summary);
    });
    books.sort((a, b) => (b.lastReadAt ?? b.addedAt).localeCompare(a.lastReadAt ?? a.addedAt) || a.title.localeCompare(b.title));
    let settings = { ...defaultSettings };
    try { settings = settingsSchema.parse(JSON.parse(await fs.readFile(join(this.dataDir, 'settings.json'), 'utf8'))); }
    catch (error) { if (!isMissing(error)) throw new Error('Saved reading settings are damaged. The book files are unaffected.'); }
    return { books, settings, storage: { mode: 'server', path:this.dataDir, description: 'Saved on the Reader server, including original files, reading positions and bookmarks. Available again after restart on this server.' } };
  }

  async importBook(filename: string, bytes: Uint8Array, encoding?: string): Promise<BookDetail> {
    if (!bytes.length || bytes.length > IMPORT_LIMITS.fileBytes) throw new Error('Choose a non-empty TXT or EPUB file no larger than 32 MiB.');
    if (!/\.(txt|epub)$/i.test(filename)) throw new Error('Only .txt and DRM-free .epub files are supported.');
    const id = createHash('sha256').update(bytes).digest('hex');
    return this.locked(id, async () => {
      const directory = this.bookPath(id);
      await this.assertActive(id);
      // Exact-byte duplicates retain the existing title, progress, bookmarks and chosen decoding.
      try {
        await fs.access(join(directory, 'record.json'));
        const existing = await this.readBook(id);
        if (encoding && existing.document.format === 'txt' && normalizeEncoding(encoding) !== existing.document.encoding) {
          throw new Error('This TXT file is already imported with a different encoding. The existing book, reading position and bookmarks were retained. Re-decoding an existing import is not available yet.');
        }
        if (encoding && existing.document.format === 'epub') throw new Error('Encoding overrides apply only to TXT files.');
        return detail(existing);
      } catch (error) { if (!isMissing(error)) throw error; }
      const document = importDocument(filename, bytes, encoding);
      const summary: BookSummary = { id, title: document.title, author: document.author, format: document.format, addedAt: new Date().toISOString(), progress: 0, locator: { chapter: 0, paragraph: 0 }, chapterCount: document.chapters.length, wordCount: countWords(document.chapters.flatMap(chapter => chapter.paragraphs)) };
      const record: StoredBook = { version: 1, originalFilename: filename.split(/[\\/]/).pop() ?? filename, summary: summarySchema.parse(summary), document: documentSchema.parse(document), bookmarks: [] };
      const staging = join(this.booksDir, `.import-${id}-${randomUUID()}`);
      await fs.mkdir(staging, { mode: 0o700 });
      try {
        await atomicWrite(join(staging, `source.${document.format}`), bytes);
        await atomicWrite(join(staging, 'document.json'), JSON.stringify(document));
        const { document: _document, ...state } = record;
        await atomicWrite(join(staging, 'record.json'), JSON.stringify(state));
        await syncDirectory(staging);
        await fs.rename(staging, directory);
        await syncDirectory(this.booksDir);
      } catch (error) { await fs.rm(staging, { recursive: true, force: true }); throw error; }
      return detail(record);
    });
  }

  async peek(id: string): Promise<BookDetail> { return this.locked(id, async () => detail(await this.readBook(id))); }

  /** Internal sync export includes a trashed file without marking it as visited. */
  async syncBook(id:string){return this.locked(id,async()=>{const root=this.bookPath(id),state=stateSchema.parse(JSON.parse(await fs.readFile(join(root,'record.json'),'utf8'))),document=documentSchema.parse(JSON.parse(await fs.readFile(join(root,'document.json'),'utf8')));if(state.summary.id!==id||document.id!==id)throw Error('书籍标识不一致');let rich:unknown;try{rich=JSON.parse(await fs.readFile(join(root,'epub-v2.json'),'utf8'));}catch(e){if(!isMissing(e))throw e;}return {detail:detail({...state,document}),filename:state.originalFilename,bytes:(await fs.stat(join(root,'source.'+state.summary.format))).size,rich};});}
  async syncBookmarks(id:string,expected:Bookmark[],next:Bookmark[]){return this.locked(id,async()=>{const record=await this.readBook(id);assertUnchanged(record.bookmarks,expected);record.bookmarks=z.array(bookmarkSchema).max(1000).parse(next);for(const mark of record.bookmarks)this.validLocator(record,mark.locator);await this.writeBook(record);});}
  async syncDescriptor(id:string,title:string,author:string,filename:string){return this.locked(id,async()=>{const record=await this.readBook(id);record.summary.title=title;record.summary.author=author;record.document.title=title;record.document.author=author;record.originalFilename=filename;await atomicWrite(join(this.bookPath(id),'document.json'),JSON.stringify(documentSchema.parse(record.document)));await this.writeBook(record);});}

  async open(id: string): Promise<BookDetail> {
    this.bookPath(id);
    return this.locked(id, async () => {
      const record = await this.readBook(id);
      record.summary.lastReadAt = new Date().toISOString();
      await this.writeBook(record);
      return detail(record);
    });
  }

  async saveProgress(id: string, locator: Locator): Promise<BookSummary> {
    this.bookPath(id);
    return this.locked(id, async () => {
      const record = await this.readBook(id);
      record.summary.locator = this.validLocator(record, locator);
      const chapters = record.document.chapters;
      const total = chapters.reduce((sum, chapter) => sum + chapter.paragraphs.length, 0);
      const offset = chapters.slice(0, locator.chapter).reduce((sum, chapter) => sum + chapter.paragraphs.length, 0) + locator.paragraph;
      record.summary.progress = total <= 1 ? 0 : offset / (total - 1);
      record.summary.lastReadAt = new Date().toISOString();
      await this.writeBook(record);
      return record.summary;
    });
  }

  async saveSettings(settings: ReaderSettings, expected?:ReaderSettings): Promise<ReaderSettings> {
    const checked = settingsSchema.parse(settings);
    return this.locked('settings', async () => {
      if(expected)assertUnchanged(await this.settings(),expected);
      const value=expected?checked:{...await this.settings(),...checked};
      await atomicWrite(join(this.dataDir, 'settings.json'), JSON.stringify(value));
      await syncDirectory(this.dataDir);
      return value;
    });
  }
  async saveEpubSettings(appearance:import('../shared/epub.js').EpubAppearance){
    return this.locked('settings',async()=>{const current=await this.settings(),value=settingsSchema.parse({...current,fontSize:appearance.fontSize,epub:{style:appearance.style,flow:appearance.flow}});await atomicWrite(join(this.dataDir,'settings.json'),JSON.stringify(value));await syncDirectory(this.dataDir);return value;});
  }
  async settings():Promise<ReaderSettings>{try{return settingsSchema.parse(JSON.parse(await fs.readFile(join(this.dataDir,'settings.json'),'utf8')));}catch(error){if(isMissing(error))return {...defaultSettings};throw Error('阅读设置损坏，书籍文件不受影响');}}

  async addBookmark(id: string, locator: Locator, label: string): Promise<Bookmark[]> {
    this.bookPath(id);
    if (typeof label !== 'string' || label.length > 240) throw new Error('Bookmark labels must be at most 240 characters.');
    return this.locked(id, async () => {
      const record = await this.readBook(id);
      const checked = this.validLocator(record, locator);
      if (record.bookmarks.some(bookmark => bookmark.locator.chapter === checked.chapter && bookmark.locator.paragraph === checked.paragraph)) return record.bookmarks;
      if (record.bookmarks.length >= 1_000) throw new Error('This book has reached the 1,000-bookmark limit.');
      record.bookmarks.push({ id: randomUUID(), locator: checked, label: label.trim() || record.document.chapters[checked.chapter]!.title, createdAt: new Date().toISOString() });
      await this.writeBook(record);
      return record.bookmarks;
    });
  }

  async removeBookmark(id: string, bookmarkId: string): Promise<Bookmark[]> {
    this.bookPath(id);
    if (typeof bookmarkId !== 'string' || bookmarkId.length > 100) throw new Error('Invalid bookmark ID.');
    return this.locked(id, async () => {
      const record = await this.readBook(id);
      record.bookmarks = record.bookmarks.filter(bookmark => bookmark.id !== bookmarkId);
      await this.writeBook(record);
      return record.bookmarks;
    });
  }
}
