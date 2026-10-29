import { App, applyDocumentTheme, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps';
import { OpenAIExtensions, OpenAIFileEntrypointInputSchema } from '@openai/mcp-extensions/app';
import '@openai/mcp-extensions/app/styles.css';
import type { BookDetail, ReaderApi } from '../shared/types';
import { IncompleteLoadError } from '../shared/online';

type Rpc = (name: string, args: Record<string, unknown>) => Promise<unknown>;
const MAX_FILE = 64 * 1024 * 1024;
const PREVIEW_REQUEST_TIMEOUT_MS = 15000;
export function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
export function decodeBase64(value: string): Uint8Array {
  if (value.length > Math.ceil(MAX_FILE / 3) * 4) throw new Error('文件超过 64 MiB 导入上限');
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}
function unwrap(result: any): unknown {
  const serverVersion=result?._meta?.readerVersion;
  if(typeof document!=='undefined'){
    if(typeof serverVersion==='string'&&/^\d+\.\d+\.\d+$/.test(serverVersion)){document.documentElement.dataset.readerServerVersion=serverVersion;document.documentElement.dataset.readerServerCheckedAt=new Date().toISOString();}
    else{delete document.documentElement.dataset.readerServerVersion;delete document.documentElement.dataset.readerServerCheckedAt;}
  }
  if (result.isError) { const message = result.content?.find((item: any) => item.type === 'text')?.text ?? 'Reader 操作失败'; throw result._meta?.readerIncomplete ? new IncompleteLoadError(message, result._meta.readerIncomplete) : new Error(message); }
  if (!result._meta || !('reader' in result._meta)) throw new Error('Reader 服务返回了无效响应');
  return result._meta.reader;
}
export function createReaderApi(): ReaderApi {
  let call: Rpc;
  let download:((filename:string,mimeType:string,data:Uint8Array)=>Promise<void>)|undefined;
  let hostClose: (() => Promise<void>) | undefined;
  let nativeMessage: ((text:string,images?:Array<{data:string;mimeType:string}>)=>Promise<void>) | undefined;
  const beforeClose = new Set<() => Promise<unknown>>();
  let onBook: ((book: BookDetail) => void) | undefined;
  let onError: ((message: string) => void) | undefined;
  let queuedBook: BookDetail | undefined;
  let queuedError: string | undefined;
  let incomingVersion = 0;
  const opened = (book: BookDetail) => { if (onBook) onBook(book); else queuedBook = book; };
  const failed = (error: unknown) => { const message = error instanceof Error ? error.message : '无法打开文件'; if (onError) onError(message); else queuedError = message; };

  const importFile = async (file: File, encoding?: string, password?: string): Promise<BookDetail> => {
    if (file.size === 0 || file.size > MAX_FILE) throw new Error('请选择 TXT、EPUB（32 MiB 内）或 PDF（64 MiB 内）');
    const begin = await call('reader_import_begin', { filename: file.name, size: file.size, ...(encoding ? { encoding } : {}), ...(password ? {password} : {}) }) as { uploadId: string; chunkBytes: number };
    try {
      for (let offset = 0, index = 0; offset < file.size; offset += begin.chunkBytes, index++) {
        const bytes = new Uint8Array(await file.slice(offset, offset + begin.chunkBytes).arrayBuffer());
        await call('reader_import_chunk', { uploadId: begin.uploadId, index, data: encodeBase64(bytes) });
      }
      return await call('reader_import_finish', { uploadId: begin.uploadId }) as BookDetail;
    } catch (error) { await call('reader_import_cancel', { uploadId: begin.uploadId }).catch(() => {}); throw error; }
  };
  if (window.parent === window) {
    download=async(filename,mimeType,data)=>{const url=URL.createObjectURL(new Blob([new Uint8Array(data)],{type:mimeType}));const link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),5000);};
    call = async (name, args) => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), name.startsWith('reader_online_') || name.startsWith('reader_pdf_') || name.startsWith('reader_chat_') || name === 'reader_import_finish' || name === 'reader_get' ? 60000 : PREVIEW_REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch('/api/tool', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Reader-Client': 'preview' }, body: JSON.stringify({ name, arguments: args }), signal: controller.signal });
        if (!response.ok) { const error = await response.json().catch(() => ({})); const message = error.error ?? `Reader 服务未就绪 (${response.status})`; throw error.incomplete ? new IncompleteLoadError(message, error.incomplete) : new Error(message); }
        return unwrap(await response.json());
      } catch (error) {
        if (controller.signal.aborted) throw new Error('Reader 服务响应超时，请重试');
        throw error;
      } finally { window.clearTimeout(timeout); }
    };
  } else {
    const app = new App({ name: 'Reader', version: '0.2.14' });
    const extensions = new OpenAIExtensions(app);
    const applyContext = (context: ReturnType<App['getHostContext']>) => {
      if (context?.theme) { applyDocumentTheme(context.theme); document.documentElement.dataset.hostTheme = context.theme; }
      if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
    };
    app.onhostcontextchanged = applyContext;
    // Install handlers before connect: the host can deliver initial file input immediately.
    app.ontoolresult = () => {};
    app.onteardown = async () => { await Promise.all([...beforeClose].map(listener => listener())); return {}; };
    let ready: Promise<void>;
    app.ontoolinput = ({ arguments: args }) => {
      const parsed = OpenAIFileEntrypointInputSchema.safeParse(args);
      if (!parsed.success) return;
      const version = ++incomingVersion;
      queueMicrotask(() => {
        void ready.then(async () => {
          if (!extensions.resources) throw new Error('当前宿主尚未提供文件读取接口。请从书架手动导入该文件');
          const result = await extensions.resources.read({ uri: parsed.data.file.resourceUri, representation: 'blob' });
          const content = result.contents.find(item => item.uri === parsed.data.file.resourceUri) ?? result.contents[0];
          if (!content) throw new Error('宿主返回的文件为空');
          const bytes = 'blob' in content ? decodeBase64(content.blob) : new TextEncoder().encode(content.text);
          if (version !== incomingVersion) return;
          const book = await importFile(new File([new Uint8Array(bytes)], parsed.data.file.name));
          if (version === incomingVersion) {
            await Promise.all([...beforeClose].map(listener => listener()));
            if (version === incomingVersion) opened(book);
          }
        }).catch(failed);
      });
    };
    ready = app.connect(undefined, { timeout: 15000 }).then(() => applyContext(app.getHostContext()));
    download=async(filename,mimeType,data)=>{await ready;const result=await app.downloadFile({contents:[{type:'resource',resource:{uri:'file:///'+encodeURIComponent(filename),mimeType,blob:encodeBase64(data)}}]});if(result.isError)throw Error('宿主未完成导出，可以重试或复制笔记文字');};
    nativeMessage = async (text,images=[]) => { await ready; const result=await app.sendMessage({role:'user',content:[{type:'text',text},...images.map(image=>({type:'image' as const,...image}))]});if(result.isError)throw Error('宿主未接受消息，请复制内容后继续'); };
    hostClose = async () => { await ready; await app.requestTeardown(); };
    call = async (name, args) => { await ready; return unwrap(await app.callServerTool({ name, arguments: args })); };
  }
  return {
    study: {
      download,
      call: (name,args={})=>call(name,args) as any,
      snapshot: ()=>call('reader_workspace',{}) as any,
      note: id=>call('reader_note_get',{id}) as any,
      source: source=>call('reader_source_create',{source}) as any,
      asset: id=>call('reader_image_get',{id}) as any,
      uploadImage: data=>call('reader_image_put',{data}) as any,
      search: (query,bookId)=>call('reader_workspace_search',{query,...(bookId?{bookId}:{})}) as any,
      openSource: id=>call('reader_source_open',{id,navigate:false}) as any,
      nativeMessage,
    },
    epub: {
      open: id => call('reader_epub_open', { id }) as any,
      chapter: (id, resource) => call('reader_epub_chapter', { id, resource }) as any,
      resource: (id, resource, offset) => call('reader_epub_resource', { id, resource, offset }) as any,
      save: (id, location, appearance) => call('reader_epub_progress', { id, location, appearance }) as any,
      settings: (id, appearance) => call('reader_epub_settings', { id, appearance }) as any,
      bookmark: (id, location, label) => call('reader_epub_bookmark', { id, location, label }) as any,
      removeBookmark: (id, bookmarkId) => call('reader_epub_bookmark_remove', { id, bookmarkId }) as any,
    },
    keyboard: () => call('reader_keyboard', {}) as ReturnType<ReaderApi['keyboard']>,
    saveKeyboard: settings => call('reader_keyboard_save', { settings }) as ReturnType<ReaderApi['saveKeyboard']>,
    resetKeyboard: () => call('reader_keyboard_reset', {}) as ReturnType<ReaderApi['resetKeyboard']>,
    trashList: () => call('reader_trash_list', {}) as ReturnType<ReaderApi['trashList']>,
    trash: id => call('reader_trash', { id }) as ReturnType<ReaderApi['trash']>,
    restore: async id => { await call('reader_restore', { id }); },
    async requestHostClose() {
      const openai = (window as Window & { openai?: { requestClose?: () => void | Promise<void> } }).openai;
      if (!openai?.requestClose && !hostClose) return { status: 'unsupported', message: '当前预览没有宿主关闭接口。请使用宿主面板的关闭按钮；Esc 只返回 Reader 或关闭弹层。' };
      await Promise.all([...beforeClose].map(listener => listener()));
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([Promise.resolve().then(() => openai?.requestClose ? openai.requestClose() : hostClose!()), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('宿主未在 5 秒内完成关闭请求；面板状态未知，请用宿主关闭按钮')), 5000); })]);
      } finally { if (timer) clearTimeout(timer); }
      return { status: 'requested', message: '已发送关闭请求，是否关闭由宿主决定。若面板仍显示，请使用宿主关闭按钮。' };
    },
    onBeforeClose(listener) { beforeClose.add(listener); return () => { beforeClose.delete(listener); }; },
    list: () => call('reader_list', {}) as ReturnType<ReaderApi['list']>,
    importBook: importFile,
    open: (id, requestId) => call('reader_get', { id, ...(requestId ? { requestId } : {}) }) as ReturnType<ReaderApi['open']>,
    online: {
      sources: () => call('reader_online_sources', {}) as any,
      preview: input => call('json' in input ? 'reader_online_preview' : 'reader_online_preview_url', input) as any,
      catalogPreview: packageJson => call('reader_catalog_preview', { packageJson }) as any,
      commit: token => call('reader_online_commit', { token }) as any,
      setEnabled: (id, enabled) => call('reader_online_enable', { id, enabled }) as any,
      removeSource: id => call('reader_online_remove', { id }) as any,
      search: (sourceId, key, page, requestId) => call('reader_online_search', { sourceId, key, page, requestId }) as any,
      detail: (result, requestId) => call('reader_online_detail', { result, requestId }) as any,
      add: (detail, requestId) => call('reader_online_add', { detail, requestId }) as any,
      chapter: (id, chapterId, requestId) => call('reader_online_chapter', { id, chapterId, requestId }) as any,
      refresh: (id, requestId) => call('reader_online_refresh', { id, requestId }) as any,
      cancel: requestId => call('reader_online_cancel', { requestId }),
    },
    saveProgress: (id, locator) => call('reader_progress', { id, locator }) as ReturnType<ReaderApi['saveProgress']>,
    saveSettings: settings => call('reader_settings', { settings }) as ReturnType<ReaderApi['saveSettings']>,
    addBookmark: (id, locator, label) => call('reader_bookmark_add', { id, locator, label }) as ReturnType<ReaderApi['addBookmark']>,
    removeBookmark: (id, bookmarkId) => call('reader_bookmark_remove', { id, bookmarkId }) as ReturnType<ReaderApi['removeBookmark']>,
    onExternalBook(listener, errorListener) {
      onBook = listener; onError = errorListener;
      if (queuedBook) { const book = queuedBook; queuedBook = undefined; queueMicrotask(() => listener(book)); }
      if (queuedError) { const error = queuedError; queuedError = undefined; queueMicrotask(() => errorListener(error)); }
      return () => { onBook = undefined; onError = undefined; };
    },
  };
}
