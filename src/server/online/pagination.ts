import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { atomicWrite } from '../store.js';

// Trusted application policy, never configurable by a downloaded source.
export const PAGINATION_LIMITS = Object.freeze({ pages: 256, requests: 512, batchPages: 8, batchMs: 20_000, lifetimeMs: 24 * 60 * 60_000, entries: 16, checkpointBytes: 16 * 1024 * 1024, diskBytes: 64 * 1024 * 1024, tocBytes: 32 * 1024 * 1024, contentBytes: 8 * 1024 * 1024 });
const variables = z.record(z.string(), z.string());
export const ruleStateSchema = z.object({ variables, scopes: z.record(z.string(), variables) });
export type RuleState = z.infer<typeof ruleStateSchema>;
export class PaginationBoundaryError extends Error {}
export const checkpointSchema = z.object({ version: z.literal(1), updatedAt: z.number(), pages: z.number().int().min(0).max(PAGINATION_LIMITS.pages), next: z.string().max(4096), visited: z.array(z.string().max(4096)).max(PAGINATION_LIMITS.pages * 2), fingerprints: z.array(z.string()).max(PAGINATION_LIMITS.pages), requests: z.number().int().min(0).max(PAGINATION_LIMITS.requests + 1), bytes: z.number().int().min(0), rules: ruleStateSchema.optional(), payload: z.unknown() });
export type PaginationCheckpoint = z.infer<typeof checkpointSchema>;

/** Private disposable drafts. Complete books/caches are committed separately. */
export class PaginationDraft {
  readonly path: string;
  readonly directory: string;
  constructor(directory: string, identity: unknown) {
    this.directory = join(directory, 'pagination-v1');
    this.path = join(this.directory, `${createHash('sha256').update(JSON.stringify(identity)).digest('hex')}.json`);
  }
  async read(): Promise<PaginationCheckpoint | undefined> {
    try {
      if ((await fs.stat(this.path)).size > PAGINATION_LIMITS.checkpointBytes) throw Error('分页续点过大；请重新加载');
      const state = checkpointSchema.parse(JSON.parse(await fs.readFile(this.path, 'utf8')));
      if (Date.now() - state.updatedAt > PAGINATION_LIMITS.lifetimeMs) { await this.remove(); return; }
      return state;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  }
  async save(state: PaginationCheckpoint) {
    const bytes = JSON.stringify(checkpointSchema.parse({ ...state, updatedAt: Date.now() }));
    if (Buffer.byteLength(bytes) > PAGINATION_LIMITS.checkpointBytes) throw Error('分页续点超过 16 MiB；未保存不完整书籍');
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const files = await Promise.all((await fs.readdir(this.directory)).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).map(async name => {
      const path = join(this.directory, name);
      try { return { path, stat: await fs.stat(path) }; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    }));
    const other = files.filter(file => file && file.path !== this.path).sort((a, b) => a!.stat.mtimeMs - b!.stat.mtimeMs);
    let size = other.reduce((sum, file) => sum + file!.stat.size, Buffer.byteLength(bytes)), count = other.length + 1;
    for (const file of other) {
      if (count <= PAGINATION_LIMITS.entries && size <= PAGINATION_LIMITS.diskBytes && Date.now() - file!.stat.mtimeMs <= PAGINATION_LIMITS.lifetimeMs) continue;
      await fs.rm(file!.path, { force: true }); size -= file!.stat.size; count--;
    }
    await atomicWrite(this.path, bytes);
  }
  async remove() { await fs.rm(this.path, { force: true }); }
}
