import { App, applyDocumentTheme, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps';
import { OpenAIExtensions, OpenAIFileEntrypointInputSchema } from '@openai/mcp-extensions/app';
import '@openai/mcp-extensions/app/styles.css';
import type { BookDetail, ReaderApi } from '../shared/types';

type Rpc = (name: string, args: Record<string, unknown>) => Promise<unknown>;
const MAX_FILE = 32 * 1024 * 1024;
const PREVIEW_REQUEST_TIMEOUT_MS = 15000;
export function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
export function decodeBase64(value: string): Uint8Array {
  if (value.length > Math.ceil(MAX_FILE / 3) * 4) throw new Error('文件超过 32 MiB 导入上限');
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}
function unwrap(result: any): unknown {
  if (result.isError) throw new Error(result.content?.find((item: any) => item.type === 'text')?.text ?? 'Reader 操作失败');
  if (!result._meta || !('reader' in result._meta)) throw new Error('Reader 服务返回了无效响应');
  return result._meta.reader;
}
export function createReaderApi(): ReaderApi {
  let call: Rpc;
  let beforeClose: (() => Promise<unknown>) | undefined;
  let onBook: ((book: BookDetail) => void) | undefined;
  let onError: ((message: string) => void) | undefined;
  let queuedBook: BookDetail | undefined;
  let queuedError: string | undefined;
  let incomingVersion = 0;
  const opened = (book: BookDetail) => { if (onBook) onBook(book); else queuedBook = book; };
  const failed = (error: unknown) => { const message = error instanceof Error ? error.message : '无法打开文件'; if (onError) onError(message); else queuedError = message; };

  const importFile = async (file: File, encoding?: string): Promise<BookDetail> => {
    if (file.size === 0 || file.size > MAX_FILE) throw new Error('请选择 1 字节至 32 MiB 的 TXT 或 EPUB 文件');
    const begin = await call('reader_import_begin', { filename: file.name, size: file.size, ...(encoding ? { encoding } : {}) }) as { uploadId: string; chunkBytes: number };
    try {
      for (let offset = 0, index = 0; offset < file.size; offset += begin.chunkBytes, index++) {
        const bytes = new Uint8Array(await file.slice(offset, offset + begin.chunkBytes).arrayBuffer());
        await call('reader_import_chunk', { uploadId: begin.uploadId, index, data: encodeBase64(bytes) });
      }
      return await call('reader_import_finish', { uploadId: begin.uploadId }) as BookDetail;
    } catch (error) { await call('reader_import_cancel', { uploadId: begin.uploadId }).catch(() => {}); throw error; }
  };
  if (window.parent === window) {
    call = async (name, args) => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), PREVIEW_REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch('/api/tool', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Reader-Client': 'preview' }, body: JSON.stringify({ name, arguments: args }), signal: controller.signal });
        if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.error ?? `Reader 服务未就绪 (${response.status})`); }
        return unwrap(await response.json());
      } catch (error) {
        if (controller.signal.aborted) throw new Error('Reader 服务响应超时，请重试');
        throw error;
      } finally { window.clearTimeout(timeout); }
    };
  } else {
    const app = new App({ name: 'Reader', version: '0.1.4' });
    const extensions = new OpenAIExtensions(app);
    const applyContext = (context: ReturnType<App['getHostContext']>) => {
      if (context?.theme) { applyDocumentTheme(context.theme); document.documentElement.dataset.hostTheme = context.theme; }
      if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
    };
    app.onhostcontextchanged = applyContext;
    // Install handlers before connect: the host can deliver initial file input immediately.
    app.ontoolresult = () => {};
    app.onteardown = async () => { await beforeClose?.(); return {}; };
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
          if (version === incomingVersion) opened(book);
        }).catch(failed);
      });
    };
    ready = app.connect(undefined, { timeout: 15000 }).then(() => applyContext(app.getHostContext()));
    call = async (name, args) => { await ready; return unwrap(await app.callServerTool({ name, arguments: args })); };
  }
  return {
    onBeforeClose(listener) { beforeClose = listener; return () => { beforeClose = undefined; }; },
    list: () => call('reader_list', {}) as ReturnType<ReaderApi['list']>,
    importBook: importFile,
    open: id => call('reader_get', { id }) as ReturnType<ReaderApi['open']>,
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
