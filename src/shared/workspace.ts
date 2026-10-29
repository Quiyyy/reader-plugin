import { z } from 'zod';
export const bookIdSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const entityIdSchema = z.string().uuid();
const point = z.object({ chapter: z.number().int().nonnegative(), paragraph: z.number().int().nonnegative(), offset: z.number().int().nonnegative(), chapterId: bookIdSchema.optional() }).strict();
const epubPoint = z.object({ element: z.string().min(1).max(128), offset: z.number().int().nonnegative() }).strict();
export const rectangleSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1) }).strict().refine(r => r.x+r.width<=1.001 && r.y+r.height<=1.001, '区域超出页面');
export const anchorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), start: point, end: point }).strict(),
  z.object({ kind: z.literal('epub'), resource: z.string().min(1).max(1024), start: epubPoint, end: epubPoint }).strict(),
  z.object({ kind: z.literal('pdf'), rotation:z.number().int().multipleOf(90).min(0).max(270).default(0), page: z.number().int().min(1).max(10000), rectangles: z.array(rectangleSchema).max(100), region: rectangleSchema.optional() }).strict(),
]);
export const sourceInputSchema = z.object({ bookId: bookIdSchema, quote: z.string().max(20000), anchor: anchorSchema, imageId: bookIdSchema.optional() }).strict();
export const sourceSchema = sourceInputSchema.extend({ id: entityIdSchema, title: z.string(), label: z.string(), createdAt: z.string() });
export type SourceInput = z.input<typeof sourceInputSchema>;
export type SourceRef = z.infer<typeof sourceSchema>;
export type Anchor = z.infer<typeof anchorSchema>;
export const folderSchema = z.object({ id: entityIdSchema, name: z.string().trim().min(1).max(80), parentId: entityIdSchema.nullable(), revision: z.number().int().positive(), trashedAt: z.string().optional() });
export type Folder = z.infer<typeof folderSchema>;
export type LibraryEntryKind = 'book' | 'note' | 'folder';
export interface LibraryTarget { kind:LibraryEntryKind; id:string; }
export interface LibraryMoveItem extends LibraryTarget { revision:number; }
const unit=z.number().min(0).max(1),markColor=z.enum(['red','blue','green','yellow']).default('red');
export const imageMarkSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('rect'),x:unit,y:unit,width:unit,height:unit,color:markColor}).strict(),
  z.object({kind:z.literal('highlight'),x:unit,y:unit,width:unit,height:unit,color:markColor}).strict(),
  z.object({kind:z.literal('arrow'),x:unit,y:unit,x2:unit,y2:unit,color:markColor}).strict(),
  z.object({kind:z.literal('label'),x:unit,y:unit,text:z.string().trim().min(1).max(80),color:markColor}).strict(),
]).refine(mark=>!('width' in mark)||(mark.width>0&&mark.height>0&&mark.x+mark.width<=1.001&&mark.y+mark.height<=1.001),'标注超出图片');
export const noteImageAnnotationsSchema=z.array(z.object({imageId:bookIdSchema,marks:z.array(imageMarkSchema).max(50)}).strict()).max(100).refine(items=>new Set(items.map(item=>item.imageId)).size===items.length,'图片标注重复');
export type ImageMark=z.infer<typeof imageMarkSchema>;
export type NoteImageAnnotations=z.infer<typeof noteImageAnnotationsSchema>;
export const noteSchema = z.object({ id: entityIdSchema, title: z.string().max(240), body: z.string().max(500000), sourceIds: z.array(entityIdSchema).max(300), imageIds: z.array(bookIdSchema).max(100), imageAnnotations:noteImageAnnotationsSchema.optional(), folderId: entityIdSchema.nullable(), tags: z.array(z.string().trim().min(1).max(40)).max(30), relatedBookId: bookIdSchema.optional(), revision: z.number().int().positive(), createdAt: z.string(), updatedAt: z.string(), trashedAt: z.string().optional(), space: z.object({ url: z.string().url().max(2048), revision: z.number().int().positive(), exportedAt: z.string() }).optional() });
export type Note = z.infer<typeof noteSchema>;
export type NoteSummary = Omit<Note,'body'> & { preview: string };
export const annotationSchema = z.object({ id: entityIdSchema, sourceId: entityIdSchema, comment: z.string().max(10000), color: z.enum(['yellow','green','blue','pink']), revision: z.number().int().positive(), createdAt: z.string(), updatedAt: z.string(), trashedAt: z.string().optional() });
export type Annotation = z.infer<typeof annotationSchema>;
export const bookMetadataSchema = z.object({ title: z.string().trim().min(1).max(240).optional(), folderId: entityIdSchema.nullable(), tags: z.array(z.string().trim().min(1).max(40)).max(30), revision: z.number().int().positive() });
export type BookMetadata = z.infer<typeof bookMetadataSchema>;
export const appearanceSchema = z.object({ mode: z.enum(['system','light','dark']), accent: z.string().regex(/^#[a-fA-F0-9]{6}$/), paper: z.enum(['white','cream']), fontSize: z.number().int().min(14).max(36) }).strict();
export type Appearance = z.infer<typeof appearanceSchema>;
export const defaultAppearance: Appearance = { mode:'system',accent:'#526dad',paper:'white',fontSize:20 };
export interface WorkspaceSnapshot { layout?:'cards'|'list'; revision:number; accessRevision?:number; visits?:Record<string,string>; folders:Folder[]; notes:NoteSummary[]; annotations:Annotation[]; sources:SourceRef[]; books:Record<string,BookMetadata>; appearance:Appearance; aiBooks:string[]; }
export interface Mutation<T> { value:T; undoId?:string; revision:number; }
export interface SearchHit { kind:'book'|'note'|'annotation'|'passage'; id:string; title:string; text:string; source?:SourceRef; locator?:{chapter:number;paragraph:number;chapterId?:string}; }
export interface PdfBook { id:string; title:string; author:string; pages:number; addedAt:string; lastReadAt?:string; page:number; scroll:number; scale:number; rotation:number; outline:{title:string;page:number;depth:number}[]; warnings:string[]; locked:boolean; }
export interface ChatMessage { id:string; role:'user'|'assistant'|'tool'; text:string; sourceIds:string[]; imageIds?:string[]; createdAt:string; }
export interface ChatModel { id:string; name:string; defaultReasoningEffort?:string; supportedReasoningEfforts:string[]; }
export interface ChatModels { models:ChatModel[]; defaultModel:string|null; }
export interface ChatSession { id:string; bookId?:string; noteId?:string; title:string; threadId?:string; messages:ChatMessage[]; draft:string; draftSourceIds?:string[]; draftImageIds?:string[]; allowBook?:boolean; model?:string|null; status:'idle'|'running'|'error'|'interrupted'; error?:string; createdAt:string; updatedAt:string; revision:number; }
export interface WorkspaceApi {
  download?(filename:string,mimeType:string,data:Uint8Array):Promise<void>;
  call<T=unknown>(name:string,args?:Record<string,unknown>):Promise<T>;
  snapshot():Promise<WorkspaceSnapshot>;
  note(id:string):Promise<Note>;
  source(input:SourceInput):Promise<SourceRef>;
  asset(id:string):Promise<{data:string;mimeType:string}>;
  uploadImage(data:string):Promise<{id:string}>;
  search(query:string,bookId?:string):Promise<SearchHit[]>;
  openSource(id:string):Promise<{source:SourceRef;available:boolean;reason?:string}>;
  nativeMessage?(text:string,images?:Array<{data:string;mimeType:string}>):Promise<void>;
}
