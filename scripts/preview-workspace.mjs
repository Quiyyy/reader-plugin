// Production UI preview with original samples and an isolated local library.
// It exposes only the existing Reader loopback server, without test controls.
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { ReaderService } from '../dist/server/service.js';
import { ReaderStore } from '../dist/server/store.js';
import { createReaderHttpServer } from '../dist/server/http.js';
import { epubFixture } from './epub-fixture.mjs';

const { values } = parseArgs({ options: { port: { type: 'string', default: '4187' } } });
const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Invalid preview port');
await mkdir('artifacts/workspace-preview', { recursive: true });
const directory = await mkdtemp(join(process.cwd(), 'artifacts/workspace-preview/library-'));
const service = new ReaderService(new ReaderStore(directory));
const book = await service.store.importBook('阅读与思考.txt', Buffer.from('第一章 留下自己的理解\n\n阅读不只是在页面上前进。合上书，用自己的话解释一个观点，才能知道自己究竟理解了什么。\n\n疑问也值得记录。下次阅读时，带着它重新看原文，常常会发现新的线索。\n\n第二章 从一句话开始\n\n选中一句值得保留的话，写下它与你已有经验的联系。\n\n积累的笔记不必很长。一句清楚的判断，加上一处可靠的来源，就能成为下一次思考的起点。'));
await service.store.importBook('纸页之间.epub', await epubFixture());
const folder = (await service.workspace.store.folderSave({ name: '阅读与思考', parentId: null })).value;
await service.workspace.store.bookSave(book.summary.id, 0, { folderId: folder.id, tags: ['学习'] });
const paragraph = 1, quote = book.document.chapters[0].paragraphs[paragraph];
const source = await service.workspace.createSource({ bookId: book.summary.id, quote, anchor: { kind: 'text', start: { chapter: 0, paragraph, offset: 0 }, end: { chapter: 0, paragraph, offset: quote.length } } });
await service.workspace.store.createNote({ title: '怎样把阅读变成自己的理解', body: '## 我的理解\n\n主动回忆可以暴露理解中的空缺。读完一段后，先合上书，再尝试解释。\n\n- 用自己的话写下一个观点\n- 保留原文来源，方便回来核对\n- 记录尚未想明白的问题', folderId: folder.id, tags: ['主动回忆'], sourceIds: [source.id], imageIds: [], relatedBookId: book.summary.id });
const server = createReaderHttpServer(service, new URL('../dist/ui/index.html', import.meta.url));
server.listen(port, '127.0.0.1', async () => {
  const url = `http://127.0.0.1:${server.address().port}`;
  const info = { url, dataDir: directory, isolated: true, originalSamples: true, productionUI: true, realCodexHost: false, stop: 'Ctrl+C' };
  await writeFile('artifacts/workspace-preview/latest.json', JSON.stringify(info, null, 2) + '\n');
  console.log(JSON.stringify(info));
});
let stopping = false;
const stop = async () => { if (stopping) return; stopping = true; await service.close(); server.closeAllConnections(); server.close(() => process.exit(0)); };
process.once('SIGINT', () => void stop()); process.once('SIGTERM', () => void stop());
