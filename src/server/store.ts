import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { defaultSettings, type BookDetail, type BookSummary, type Bookmark, type LibraryState, type Locator, type ReaderSettings } from '../shared/types.js';
import { importDocument, IMPORT_LIMITS, normalizeEncoding } from './importers.js';

const locatorSchema = z.object({ chapter: z.number().int().nonnegative(), paragraph: z.number().int().nonnegative() });
const settingsSchema = z.object({ theme: z.enum(['system', 'light', 'sepia', 'dark']), fontSize: z.number().min(14).max(36), lineHeight: z.number().min(1.3).max(2.6), lineWidth: z.number().min(420).max(960), fontFamily: z.enum(['serif', 'sans']) });
const summarySchema = z.object({ id: z.string().regex(/^[a-f0-9]{64}$/), title: z.string(), author: z.string(), format: z.enum(['txt', 'epub']), addedAt: z.string(), lastReadAt: z.string().optional(), progress: z.number().min(0).max(1), locator: locatorSchema, chapterCount: z.number().int().positive(), wordCount: z.number().int().nonnegative() });
const bookmarkSchema = z.object({ id: z.string(), locator: locatorSchema, label: z.string(), createdAt: z.string() });
const documentSchema = z.object({ id: z.string(), title: z.string(), author: z.string(), format: z.enum(['txt', 'epub']), chapters: z.array(z.object({ id: z.string(), title: z.string(), paragraphs: z.array(z.string()).min(1) })).min(1), encoding: z.string().optional(), warnings: z.array(z.string()) });
const stateSchema = z.object({ version: z.literal(1), originalFilename: z.string(), summary: summarySchema, bookmarks: z.array(bookmarkSchema) });
type StoredBook = z.infer<typeof stateSchema> & { document: z.infer<typeof documentSchema> };
const isMissing = (error: unknown): boolean => !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';

/** Atomic same-directory replace; private modes; fsync contents before rename. */
async function atomicWrite(filename: string, contents: string | Uint8Array): Promise<void> {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  const handle = await fs.open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(contents);
    await handle.sync();
    await handle.close();
    await fs.rename(temporary, filename);
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
  private async locked<T>(key: string, work: () => Promise<T>): Promise<T> {
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

  private async readState(id: string): Promise<z.infer<typeof stateSchema>> {
    await this.ready;
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
      const document = documentSchema.parse(JSON.parse(await fs.readFile(join(this.bookPath(id), 'document.json'), 'utf8')));
      if (document.id !== id) throw new Error('Mismatched document ID');
      return { ...state, document };
    } catch {
      throw new Error('This book document is damaged. Your original source file is still preserved in the library.');
    }
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
    for (const entry of directories) if (entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name)) books.push((await this.readState(entry.name)).summary);
    books.sort((a, b) => (b.lastReadAt ?? b.addedAt).localeCompare(a.lastReadAt ?? a.addedAt) || a.title.localeCompare(b.title));
    let settings = { ...defaultSettings };
    try { settings = settingsSchema.parse(JSON.parse(await fs.readFile(join(this.dataDir, 'settings.json'), 'utf8'))); }
    catch (error) { if (!isMissing(error)) throw new Error('Saved reading settings are damaged. The book files are unaffected.'); }
    return { books, settings, storage: { mode: 'server', description: 'Saved on the Reader server, including original files, reading positions and bookmarks. Available again after restart on this server.' } };
  }

  async importBook(filename: string, bytes: Uint8Array, encoding?: string): Promise<BookDetail> {
    if (!bytes.length || bytes.length > IMPORT_LIMITS.fileBytes) throw new Error('Choose a non-empty TXT or EPUB file no larger than 32 MiB.');
    if (!/\.(txt|epub)$/i.test(filename)) throw new Error('Only .txt and DRM-free .epub files are supported.');
    const id = createHash('sha256').update(bytes).digest('hex');
    return this.locked(id, async () => {
      const directory = this.bookPath(id);
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
      const record: StoredBook = { version: 1, originalFilename: filename.split(/[\\/]/).pop() ?? filename, summary, document, bookmarks: [] };
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

  async saveSettings(settings: ReaderSettings): Promise<ReaderSettings> {
    const checked = settingsSchema.parse(settings);
    return this.locked('settings', async () => {
      await atomicWrite(join(this.dataDir, 'settings.json'), JSON.stringify(checked));
      await syncDirectory(this.dataDir);
      return checked;
    });
  }

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
