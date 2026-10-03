import type { BookDetail } from './types.js';

export type SyntaxStatus = 'supported' | 'partial' | 'blocked' | 'invalid';
export type NetworkStatus = 'untested' | 'passed' | 'failed';
export type Stage = 'search' | 'detail' | 'toc' | 'content';
export const stages: Stage[] = ['search', 'detail', 'toc', 'content'];
export interface Diagnostic { field: string; status: SyntaxStatus; reason: string; }
export interface StageReport { syntax: SyntaxStatus; network: NetworkStatus; diagnostics: Diagnostic[]; lastError?: string; checkedAt?: string; }
export interface SourceReport { id: string; revision: string; name: string; url: string; enabled: boolean; syntax: SyntaxStatus; stages: Record<Stage, StageReport>; diagnostics: Diagnostic[]; }
export interface CatalogInfo { catalogId: string; version: string; channel: 'ready' | 'candidates'; manifestSha256: string; sources: { id: string; version: string; name: string; sha256: string; lastVerified: string | null; rights: { ruleLicense: string; basis: string; references: string[] } }[]; }
export interface SourcePreview { catalog?: CatalogInfo; token: string; sources: SourceReport[]; changes: { id: string; kind: 'new' | 'unchanged' | 'replace'; previousName?: string; fields: string[] }[]; }
export interface OnlineResult { sourceId: string; revision: string; title: string; author: string; url: string; }
export interface OnlineDetail extends OnlineResult { intro: string; tocUrl: string; }
export interface OnlineApi {
  sources(): Promise<SourceReport[]>;
  preview(input: { json: string } | { url: string; requestId: string }): Promise<SourcePreview>;
  catalogPreview(packageJson: string): Promise<SourcePreview>;
  commit(token: string): Promise<SourceReport[]>;
  setEnabled(id: string, enabled: boolean): Promise<SourceReport[]>;
  removeSource(id: string): Promise<SourceReport[]>;
  search(sourceId: string, key: string, page: number, requestId: string): Promise<OnlineResult[]>;
  detail(result: OnlineResult, requestId: string): Promise<OnlineDetail>;
  add(detail: OnlineDetail, requestId: string): Promise<BookDetail>;
  chapter(id: string, chapterId: string, requestId: string): Promise<BookDetail>;
  refresh(id: string, requestId: string): Promise<BookDetail>;
  cancel(requestId: string): Promise<unknown>;
}
