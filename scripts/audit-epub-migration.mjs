// Read the original library only. Exercise writes against a newly created copy.
import { readdir, readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { ReaderStore } from '../dist/server/store.js';
import { EpubService } from '../dist/server/epub-service.js';
const [sourceArg, outputArg] = process.argv.slice(2);
if (!sourceArg || !outputArg) throw Error('Usage: node scripts/audit-epub-migration.mjs <read-only library> <workspace output>');
const source = resolve(sourceArg), output = resolve(outputArg);
if (output === source || output.startsWith(source + '\\') || output.startsWith(source + '/')) throw Error('Audit output must be outside the source library');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
await mkdir(output, { recursive: true });
const copy = await mkdtemp(join(output, 'copy-')), before = [], results = [];
for (const entry of await readdir(join(source, 'books'), { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.isSymbolicLink() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
  const path = join(source, 'books', entry.name);
  const record = JSON.parse(await readFile(join(path, 'record.json'), 'utf8'));
  if (record.summary.format !== 'epub') continue;
  const target = join(copy, 'books', entry.name); await mkdir(target, { recursive: true });
  for (const name of ['source.epub', 'document.json', 'record.json']) {
    const bytes = await readFile(join(path, name));
    before.push({ path: join(path, name), copy: join(target, name), sha256: hash(bytes) });
    await writeFile(join(target, name), bytes);
  }
  const service = new EpubService(new ReaderStore(copy));
  const opened = await service.open(entry.name);
  await service.settings(entry.name, opened.state.appearance);
  if (opened.state.location) await service.save(entry.name, opened.state.location, opened.state.appearance);
  const restarted = await new EpubService(new ReaderStore(copy)).open(entry.name);
  results.push({ id: entry.name, sourceHashMatchesId: before.at(-3).sha256 === entry.name, chapters: opened.package.sections.length,
    locationMatched: !!opened.state.location, legacyRetained: !opened.state.location && !!opened.legacyLocation,
    bookmarkIdsPreserved: record.bookmarks.every(old => restarted.state.bookmarks.some(mark => mark.id === old.id)),
    bookmarks: restarted.state.bookmarks.length, matchedBookmarks: restarted.state.bookmarks.filter(mark => mark.location).length,
    restartPreserved: JSON.stringify(opened.state.location) === JSON.stringify(restarted.state.location) });
}
const originalsUnchanged = (await Promise.all(before.map(async item => hash(await readFile(item.path)) === item.sha256))).every(Boolean);
const copyLegacyUnchanged = (await Promise.all(before.map(async item => hash(await readFile(item.copy)) === item.sha256))).every(Boolean);
const report = { mode: 'read-only originals; migration and restart on isolated copies', source, copy, originalsUnchanged, copyLegacyUnchanged, results };
await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!originalsUnchanged || !copyLegacyUnchanged || results.some(x => !x.sourceHashMatchesId || !x.bookmarkIdsPreserved || !x.restartPreserved)) process.exitCode = 1;
