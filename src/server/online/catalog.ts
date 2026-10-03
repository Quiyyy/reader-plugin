import { createHash } from 'node:crypto';
import { z } from 'zod';

const digest = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const version = z.string().regex(/^\d+\.\d+\.\d+$/);
const path = z.string().max(200).regex(/^sources\/[a-z0-9][a-z0-9-]*\/\d+\.\d+\.\d+\.json$/);
const entrySchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).max(80), version, name: z.string().min(1).max(200), path, sha256: sha, bytes: z.number().int().positive().max(512 * 1024), minReaderVersion: version,
  status: z.enum(['ready', 'candidate', 'blocked', 'failed']), lastVerified: z.string().datetime().nullable(),
  rights: z.object({ ruleLicense: z.string().min(1).max(200), basis: z.string().min(1).max(2000), references: z.array(z.string().url().max(4096)).max(20) }).strict(),
  verification: z.object({ static: z.string().max(40), network: z.string().max(40), acceptance: z.string().max(40), failureStage: z.string().max(100).nullable(), reportPath: z.string().max(200).regex(/^verification\/[a-z0-9-]+\.json$/) }).strict(),
}).strict();
export const catalogReceiptSchema = z.object({ catalogId: z.string().regex(/^[a-z0-9-]+$/).max(100), version, manifestSha256: sha, channel: z.enum(['ready', 'candidates']), sources: z.array(entrySchema).max(50) }).strict();
export type CatalogReceipt = z.infer<typeof catalogReceiptSchema>;
const manifestSchema = z.object({ schemaVersion: z.literal(1), catalogId: catalogReceiptSchema.shape.catalogId, version, createdAt: z.string().datetime(), channel: z.enum(['ready', 'candidates']), sources: z.array(entrySchema).max(50) }).strict();
const envelopeSchema = z.object({ format: z.literal('reader-source-catalog-package'), schemaVersion: z.literal(1), manifestSha256: sha, manifest: z.string(), files: z.array(z.object({ path, content: z.string() }).strict()).max(50) }).strict();
function parseJson(text: string): unknown {
  if (text.startsWith('\uFEFF')) throw new Error('清单包必须使用不带 BOM 的 UTF-8');
  if (/[\uD800-\uDFFF]/u.test(text)) throw new Error('清单包含不完整的 Unicode 字符');
  return JSON.parse(text, (key, value) => { if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('清单包含不允许的对象字段'); if (typeof value === 'string' && /[\uD800-\uDFFF]/u.test(value)) throw new Error('清单包含不完整的 Unicode 字符'); return value; });
}
function newer(required: string, current: string) {
  const a = required.split('.').map(Number), b = current.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i]! > b[i]!; } return false;
}
/** Transport-independent adapter. A future public manifest transport must use
 * SafeHttpClient and feed the same bounded, pinned package into this function.
 * No credentials, automatic subscription or fetching of manifest paths. */
export function parseCatalogPackage(text: string, readerVersion = '0.1.8'): { json: string; receipt: CatalogReceipt } {
  if (Buffer.byteLength(text) > 1024 * 1024) throw new Error('清单包超过 1 MiB');
  const pkg = envelopeSchema.parse(parseJson(text));
  if (digest(pkg.manifest) !== pkg.manifestSha256) throw new Error('manifest SHA-256 不匹配');
  const manifest = manifestSchema.parse(parseJson(pkg.manifest));
  const ids = new Set<string>(), paths = new Set<string>(), files = new Map<string, string>();
  for (const file of pkg.files) { if (files.has(file.path)) throw new Error('清单文件路径重复'); files.set(file.path, file.content); }
  const sources: unknown[] = []; let total = 0;
  for (const entry of manifest.sources) {
    if (ids.has(entry.id) || paths.has(entry.path)) throw new Error('清单 ID 或路径重复');
    if (entry.path !== `sources/${entry.id}/${entry.version}.json`) throw new Error('清单路径与版本不一致');
    ids.add(entry.id); paths.add(entry.path);
    if (newer(entry.minReaderVersion, readerVersion)) throw new Error(`${entry.name} 需要 Reader ${entry.minReaderVersion}`);
    if (manifest.channel === 'ready' && (entry.status !== 'ready' || !entry.lastVerified || entry.verification.static !== 'passed' || entry.verification.network !== 'passed' || entry.verification.acceptance !== 'passed' || entry.verification.failureStage !== null)) throw new Error('ready 清单包含未通过验收的条目');
    const file = files.get(entry.path);
    if (file === undefined) throw new Error('清单缺少规则文件');
    const bytes = Buffer.byteLength(file); total += bytes;
    if (bytes !== entry.bytes || digest(file) !== entry.sha256) throw new Error('书源字节数或 SHA-256 不匹配');
    if (total > 512 * 1024) throw new Error('规则总大小超过 512 KiB');
    const source = parseJson(file);
    if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('每个清单文件必须包含一个书源对象');
    sources.push(source);
  }
  if (files.size !== paths.size) throw new Error('清单包含未声明的额外文件');
  return { json: JSON.stringify(sources), receipt: { catalogId: manifest.catalogId, version: manifest.version, channel: manifest.channel, manifestSha256: pkg.manifestSha256, sources: manifest.sources } };
}
