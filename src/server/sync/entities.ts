import {z} from 'zod';
import {noteSchema,folderSchema,annotationSchema,sourceSchema,bookMetadataSchema,appearanceSchema,bookIdSchema} from '../../shared/workspace.js';
import {noteBotSchema} from '../../shared/note-bots.js';
import {preferencesSchema} from '../../shared/preferences.js';
import {keyboardSchema} from '../../shared/keyboard.js';
import {epubAppearanceSchema,epubLocationSchema} from '../../shared/epub.js';
import type {SyncValue} from './engine.js';
import {digest} from './protocol.js';

const locator=z.object({chapter:z.number().int().nonnegative(),paragraph:z.number().int().nonnegative(),chapterId:bookIdSchema.optional()}).strict();
export const syncBookmarkSchema=z.object({id:z.string().regex(/^[\w-]{1,100}$/),locator,label:z.string().max(240),createdAt:z.string().max(100)}).strict();
export const syncEpubMarkSchema=z.object({id:z.string().regex(/^[\w-]{1,100}$/),label:z.string().max(240),createdAt:z.string().max(100),location:epubLocationSchema.optional(),legacy:locator.optional()}).strict();
export const bookManifestSchema=z.object({id:bookIdSchema,title:z.string().max(500),author:z.string().max(500),format:z.enum(['txt','epub','pdf','online']),filename:z.string().max(255).refine(value=>!/[\\/\u0000]/.test(value),'文件名无效'),encoding:z.string().max(80).optional(),bytes:z.number().int().min(0).max(64*1024*1024),chapterCount:z.number().int().nonnegative().max(100000),wordCount:z.number().int().nonnegative(),trashedAt:z.string().datetime().optional()}).strict();
export type BookManifest=z.infer<typeof bookManifestSchema>;
export const positionSchema=z.object({bookId:bookIdSchema,deviceId:z.string().uuid(),deviceName:z.string().min(1).max(80),format:z.enum(['txt','epub','pdf','online']),title:z.string().max(500),updatedAt:z.string().datetime(),locator:locator.optional(),epub:epubLocationSchema.optional(),appearance:epubAppearanceSchema.optional(),pdf:z.object({page:z.number().int().min(1).max(10000),scroll:z.number().min(0).max(1),scale:z.number().min(.3).max(3),rotation:z.number().int().multipleOf(90).min(0).max(270)}).strict().optional()}).strict();
export type SyncedPosition=z.infer<typeof positionSchema>;
export const workspacePreferencesSchema=z.object({appearance:appearanceSchema,preferences:preferencesSchema.optional(),layout:z.enum(['cards','list'])}).strict();
export const readerPreferencesSchema=z.object({theme:z.enum(['system','light','sepia','dark']),fontSize:z.number().min(14).max(36),lineHeight:z.number().min(1.3).max(2.6),lineWidth:z.number().min(420).max(960),fontFamily:z.enum(['serif','sans'])}).strict();
export const syncWorkspaceKinds={note:{collection:'notes',schema:noteSchema},folder:{collection:'folders',schema:folderSchema},annotation:{collection:'annotations',schema:annotationSchema},source:{collection:'sources',schema:sourceSchema},bookmeta:{collection:'books',schema:bookMetadataSchema}} as const;
export const normalValue=(value:unknown):SyncValue=>JSON.parse(JSON.stringify(value)) as SyncValue;
export const revisionless=(value:unknown):SyncValue=>value&&typeof value==='object'&&'revision' in value?normalValue({...value,revision:1}):normalValue(value);
export function workspaceValues(state:any,preferences:boolean):Record<string,SyncValue>{
  const result:Record<string,SyncValue>={};
  for(const [kind,{collection}] of Object.entries(syncWorkspaceKinds)){if(kind==='bookmeta'){for(const [id,value] of Object.entries(state.books))result[kind+':'+id]=revisionless(value);}else for(const value of state[collection])result[kind+':'+value.id]=revisionless(value);}
  if(preferences)result['preferences:workspace']=normalValue({appearance:state.appearance,preferences:state.preferences,layout:state.layout??'cards'});return result;
}
export class LocalSyncChanged extends Error {constructor(){super('本地内容正在编辑，稍后重试同步');}}
export function validateEntity(key:string,value:SyncValue){
  const [kind,id,extra]=key.split(':');
  if(key.split(':').length!==(['position','bookmark','epub-bookmark'].includes(kind!)?3:2))throw Error('同步标识无效');
  if(kind in syncWorkspaceKinds){const descriptor=syncWorkspaceKinds[kind as keyof typeof syncWorkspaceKinds];if(kind==='bookmeta')bookIdSchema.parse(id);else z.string().uuid().parse(id);if(extra)throw Error('同步标识无效');if(value!==null){const parsed=descriptor.schema.parse(value);if('id' in parsed&&parsed.id!==id)throw Error('同步实体标识不一致');}return;}
  if(kind==='bot'){z.string().uuid().parse(id);if(value!==null&&noteBotSchema.parse(value).id!==id)throw Error('Bot 标识不一致');return;}
  if(kind==='bot-default'&&id==='default'&&!extra){if(value!==null)z.object({id:z.string().uuid()}).strict().parse(value);return;}
  if(kind==='preferences'&&!extra){if(value===null)return;const schema=id==='workspace'?workspacePreferencesSchema:id==='reader'?readerPreferencesSchema:id==='keyboard'?keyboardSchema:undefined;if(!schema)throw Error('设置同步类型无效');schema.parse(value);return;}
  if(kind==='book'){bookIdSchema.parse(id);if(extra)throw Error('书籍同步标识无效');if(value!==null&&bookManifestSchema.parse(value).id!==id)throw Error('书籍标识不一致');return;}
  if(kind==='position'){bookIdSchema.parse(id);z.string().uuid().parse(extra);if(value!==null){const position=positionSchema.parse(value);if(position.bookId!==id||position.deviceId!==extra)throw Error('阅读位置标识不一致');}return;}
  if(kind==='bookmark'||kind==='epub-bookmark'){bookIdSchema.parse(id);z.string().regex(/^[\w-]{1,100}$/).parse(extra);if(value!==null){const parsed=(kind==='bookmark'?syncBookmarkSchema:syncEpubMarkSchema).parse(value);if(parsed.id!==extra)throw Error('书签标识不一致');}return;}
  throw Error('此版本尚不支持该同步数据');
}
export function assertUnchanged(current:unknown,expected:unknown){if(digest(current??null)!==digest(expected??null))throw new LocalSyncChanged();}
