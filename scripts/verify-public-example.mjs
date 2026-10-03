// Maintainer smoke test against the project's original public sample only.
// Uses the production client: no resolver/transport, cookies, proxy or SSRF override.
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { ReaderStore } from '../dist/server/store.js';
import { OnlineSourceService } from '../dist/server/online/service.js';
const input = resolve(process.argv[2] ?? 'examples/online/declarative/reader-declarative.json');
const raw = JSON.parse(await fs.readFile(input, 'utf8'));
const base = new URL(raw.bookSourceUrl);
if (!['raw.githubusercontent.com', 'cdn.jsdelivr.net'].includes(base.hostname) || !base.pathname.includes('Quiyyy/reader-plugin') || !base.pathname.includes('/examples/online/declarative/')) throw new Error('This check accepts only the Reader original public example');
const directory = await fs.mkdtemp(join(tmpdir(), 'Reader public original '));
const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 60000);
let online;
try {
  online = new OnlineSourceService(new ReaderStore(directory));
  const preview = await online.preview(JSON.stringify(raw));
  assert.ok(Object.values(preview.sources[0].stages).every(s => ['supported', 'partial'].includes(s.syntax)));
  await online.commit(preview.token); await online.manage(preview.sources[0].id, true);
  const results = await online.search(preview.sources[0].id, '纸桥', 1, controller.signal);
  assert.equal(results[0].title, '原创纸桥');
  const detail = await online.detail(results[0], controller.signal);
  const book = await online.add(detail, controller.signal);
  assert.equal(book.document.chapters.length, 2);
  assert.deepEqual(book.document.chapters[0].paragraphs, ['折好的纸桥横跨浅浅的水洼。', '纸桥的另一端留着一片叶子。']);
  const chapter = book.document.chapters[0], locator = { chapter: 0, paragraph: 1, chapterId: chapter.id };
  await online.saveProgress(book.summary.id, locator); await online.addBookmark(book.summary.id, locator, '原创公网验证');
  await online.manage(preview.sources[0].id, false);
  const restored = await new OnlineSourceService(new ReaderStore(directory)).open(book.summary.id, controller.signal);
  assert.deepEqual(restored.summary.locator, locator); assert.equal(restored.bookmarks[0].label, '原创公网验证');
  console.log(JSON.stringify({ status: 'passed', source: 'Reader original public example', hostname: base.hostname, syntax: preview.sources[0].syntax, stages: (await online.listSources())[0].stages, chapters: 2, firstChapterPages: 2, disabledSourceCacheReopen: true, productionHttpClient: true, thirdPartyNovelSitesTested: false }, null, 2));
} catch (error) {
  console.log(JSON.stringify({ status: 'failed', hostname: base.hostname, error: error.message, stages: online ? (await online.listSources())[0]?.stages : null, productionHttpClient: true, thirdPartyNovelSitesTested: false }, null, 2));
  process.exitCode = 1;
} finally { clearTimeout(timer); await fs.rm(directory, { recursive: true, force: true }); }
