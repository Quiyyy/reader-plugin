import { createHash } from 'node:crypto';
import { fixtureSource } from './online/source.js';
export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
/** Original fixture, NEVER a real-site ready acceptance receipt. */
export function catalogPackage(sources: unknown[] = [fixtureSource], version = '0.1.0') {
  const files = sources.map((source, index) => ({ path: `sources/original-${index}/1.0.0.json`, content: JSON.stringify(source) + '\n' }));
  const manifest = JSON.stringify({ schemaVersion: 1, catalogId: 'fixture-only', version, createdAt: '2026-10-03T00:00:00Z', channel: 'candidates', sources: files.map((file, index) => ({ id: `original-${index}`, version: '1.0.0', name: '原创测试书源', path: file.path, sha256: sha256(file.content), bytes: Buffer.byteLength(file.content), minReaderVersion: '0.1.7', status: 'candidate', lastVerified: null, rights: { ruleLicense: 'LicenseRef-Test-Only', basis: 'Original synthetic fixture, not real-site acceptance', references: [] }, verification: { static: 'passed', network: 'untested', acceptance: 'untested', failureStage: null, reportPath: `verification/original-${index}.json` } })) }) + '\n';
  return { format: 'reader-source-catalog-package', schemaVersion: 1, manifestSha256: sha256(manifest), manifest, files };
}
