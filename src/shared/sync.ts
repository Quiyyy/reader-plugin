import { z } from 'zod';

export const syncOptionsSchema=z.object({books:z.boolean(),preferences:z.boolean()}).strict();
export type SyncOptions=z.infer<typeof syncOptionsSchema>;
export const defaultSyncOptions:SyncOptions={books:true,preferences:false};
export const googleClientSchema=z.object({clientId:z.string().max(256).regex(/^[\w.-]+\.apps\.googleusercontent\.com$/),clientSecret:z.string().min(1).max(512).optional()}).strict();
export type GoogleClient=z.infer<typeof googleClientSchema>;
export type SyncPhase='unconfigured'|'disconnected'|'authorizing'|'connected'|'paused'|'syncing'|'ready'|'error';
export interface SyncConflictSummary {key:string;title:string;kind:string;versions:number;}
export interface SyncStatus {
  phase:SyncPhase;configured:boolean;connected:boolean;email?:string;vaultId?:string;vaultName?:string;
  deviceName:string;enabled:boolean;options:SyncOptions;lastSyncedAt?:string;error?:string;
  pending:number;conflicts:SyncConflictSummary[];downloadedBooks:number;cloudBooks:number;
}
export interface CloudVault {id:string;fileId:string;name:string;}
export interface SyncConflictVersion {id:string;deviceName:string;createdAt:string;deleted:boolean;title:string;text:string;}
export interface SyncConflictDetail {key:string;versions:SyncConflictVersion[];canKeepBoth:boolean;}
export const syncSchemas={
  reader_sync_status:z.object({}).strict(),
  reader_sync_configure:googleClientSchema,
  reader_sync_authorize:z.object({}).strict(),
  reader_sync_auth_cancel:z.object({}).strict(),
  reader_sync_disconnect:z.object({}).strict(),
  reader_sync_leave:z.object({}).strict(),
  reader_sync_vaults:z.object({}).strict(),
  reader_sync_create:z.object({name:z.string().trim().min(1).max(80),deviceName:z.string().trim().min(1).max(80),options:syncOptionsSchema}).strict(),
  reader_sync_join:z.object({recoveryKey:z.string().max(160),deviceName:z.string().trim().min(1).max(80),options:syncOptionsSchema}).strict(),
  reader_sync_settings:z.object({enabled:z.boolean().optional(),options:syncOptionsSchema.optional(),deviceName:z.string().trim().min(1).max(80).optional()}).strict(),
  reader_sync_run:z.object({}).strict(),
  reader_sync_cancel:z.object({}).strict(),
  reader_sync_recovery_key:z.object({}).strict(),
  reader_sync_conflict:z.object({key:z.string().max(240)}).strict(),
  reader_sync_resolve:z.object({key:z.string().max(240),expectedHeads:z.array(z.string().uuid()).min(2).max(128),versionId:z.string().uuid().optional(),keepBoth:z.boolean().default(false)}).strict(),
  reader_sync_positions:z.object({bookId:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
  reader_sync_resume:z.object({key:z.string().max(240),versionId:z.string().uuid()}).strict(),
  reader_sync_download:z.object({id:z.string().regex(/^[a-f0-9]{64}$/),password:z.string().max(1024).optional()}).strict(),
};
