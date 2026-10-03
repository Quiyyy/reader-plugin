import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogPackage, sha256 } from './catalog-fixture.js';
import { parseCatalogPackage } from '../src/server/online/catalog.js';
import { OnlineSourceService } from '../src/server/online/service.js';
import { ReaderStore } from '../src/server/store.js';
import { fixtureSource } from './online/source.js';
let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'Reader 清单 ')); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
it('verifies exact bytes before parsing and rejects unknown schemas, paths, versions, duplicates and extra files', () => {
  const pkg = catalogPackage(); expect(parseCatalogPackage(JSON.stringify(pkg)).receipt.channel).toBe('candidates');
  for (const mutate of [(p: any) => p.schemaVersion = 2, (p: any) => p.manifest += ' ', (p: any) => p.files[0].content += ' ', (p: any) => p.files.push(p.files[0]), (p: any) => p.files[0].path = '../source.json']) { const bad = structuredClone(pkg); mutate(bad); expect(() => parseCatalogPackage(JSON.stringify(bad))).toThrow(); }
  for (const mutate of [(m: any) => m.sources[0].minReaderVersion = '99.0.0', (m: any) => m.sources.push(m.sources[0]), (m: any) => m.channel = 'ready', (m: any) => m.sources[0].path = 'https://user:secret@site.test/source.json']) {
    const bad = structuredClone(pkg), manifest = JSON.parse(bad.manifest); mutate(manifest); bad.manifest = JSON.stringify(manifest); bad.manifestSha256 = sha256(bad.manifest); expect(() => parseCatalogPackage(JSON.stringify(bad))).toThrow();
  }
  expect(() => parseCatalogPackage(' '.repeat(1024 * 1024 + 1))).toThrow('1 MiB');
});
it('commits source and pinned receipt atomically, imports disabled, preserves receipts on enable and rejects same-version changes', async () => {
  const online = new OnlineSourceService(new ReaderStore(directory)); const pkg = JSON.stringify(catalogPackage());
  const preview = await online.previewCatalog(pkg); expect(preview.catalog!.version).toBe('0.1.0');
  const sources = await online.commit(preview.token); expect(sources[0].enabled).toBe(false);
  expect(Object.values(sources[0].stages).every(stage => stage.network === 'untested')).toBe(true);
  await online.manage(sources[0].id, true);
  await online.commit((await online.previewCatalog(pkg)).token);
  const saved = JSON.parse(await readFile(join(directory, 'online-v1', 'sources.json'), 'utf8'));
  expect(saved.catalogReceipts).toHaveLength(1); expect(saved.sources[0].report.enabled).toBe(true);
  const changed = catalogPackage([{ ...fixtureSource, bookSourceName: '修改' }]);
  await expect(online.previewCatalog(JSON.stringify(changed))).rejects.toThrow('不同内容');
  const update = catalogPackage([{ ...fixtureSource, bookSourceName: '修改' }], '0.1.1');
  const updated = await online.commit((await online.previewCatalog(JSON.stringify(update))).token); expect(updated[0].enabled).toBe(false);
  expect(await readFile(join(directory, 'online-v1', 'sources.before-catalog-v1.json'), 'utf8')).toBeTruthy();
});
it('empty accepted catalog offers no import token and no sources', async () => {
  const pkg = catalogPackage([]), manifest = JSON.parse(pkg.manifest); manifest.channel = 'ready'; pkg.manifest = JSON.stringify(manifest); pkg.manifestSha256 = sha256(pkg.manifest);
  const result = await new OnlineSourceService(new ReaderStore(directory)).previewCatalog(JSON.stringify(pkg));
  expect(result.token).toBe(''); expect(result.sources).toEqual([]);
});
