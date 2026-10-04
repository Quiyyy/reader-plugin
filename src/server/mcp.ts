import { readFile } from 'node:fs/promises';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { OpenAIExtensions, OpenAIFileEntrypointInputSchema, type OpenAIUiToolMetadata, type OpenAIUiResourceMetadata } from '@openai/mcp-extensions/server';
import { actionSchemas, type ReaderService } from './service.js';
import { IncompleteLoadError } from '../shared/online.js';
export const UI_URI = 'ui://reader/v0.1.11/bookshelf.html';
const names: Record<string, string> = { reader_list: '读取书架', reader_get: '打开书籍', reader_import_begin: '开始导入书籍', reader_import_chunk: '传输书籍分块', reader_import_finish: '完成书籍导入', reader_import_cancel: '取消书籍导入', reader_progress: '保存阅读进度', reader_settings: '保存阅读设置', reader_bookmark_add: '添加书签', reader_bookmark_remove: '移除书签' };
export function createMcpServer(service: ReaderService, htmlPath: string): McpServer {
  const server = new McpServer({ name: 'reader-plugin', version: '0.1.11' });
  new OpenAIExtensions(server);
  const meta = { ui: { csp: { connectDomains: [], resourceDomains: [], frameDomains: [] }, prefersBorder: false }, 'openai/ui': { preferredDisplayMode: 'fullscreen', availableDisplayModes: ['inline', 'fullscreen'] } satisfies OpenAIUiResourceMetadata };
  registerAppResource(server, 'Reader', UI_URI, { _meta: meta }, async () => ({ contents: [{ uri: UI_URI, mimeType: RESOURCE_MIME_TYPE, text: await readFile(htmlPath, 'utf8'), _meta: meta }] }));
  registerAppTool(server, 'reader_open', {
    title: 'Reader', description: 'Open the private Reader bookshelf. Book text is not sent to the model; import and reading happen in the app.', inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    _meta: { ui: { resourceUri: UI_URI }, 'openai/ui': { entrypoints: [{ type: 'global' }, { type: 'thread' }] } satisfies OpenAIUiToolMetadata },
  }, async () => ({ content: [{ type: 'text', text: 'Reader is ready. Use the app to import and read your books.' }] }));
  registerAppTool(server, 'reader_open_file', {
    title: 'Reader', description: 'Open a DRM-free TXT or EPUB file from a host-managed resource.', inputSchema: OpenAIFileEntrypointInputSchema,
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    _meta: { ui: { resourceUri: UI_URI, visibility: ['app'] }, 'openai/ui': { entrypoints: [{ type: 'file', extensions: ['.txt', '.epub'] }] } satisfies OpenAIUiToolMetadata },
  }, async () => ({ content: [] }));
  for (const [name, schema] of Object.entries(actionSchemas)) {
    server.registerTool(name, {
      title: names[name] ?? name, description: 'Private Reader UI operation. Not intended for model invocation.', inputSchema: schema,
      annotations: { readOnlyHint: ['reader_list', 'reader_online_sources', 'reader_keyboard', 'reader_trash_list'].includes(name), destructiveHint: ['reader_bookmark_remove', 'reader_online_remove', 'reader_trash'].includes(name), openWorldHint: name.startsWith('reader_online_') || name === 'reader_get' },
      _meta: { ui: { visibility: ['app'] } },
    }, async (args: unknown): Promise<CallToolResult> => {
      try { return { content: [], _meta: { reader: await service.call(name, args) } }; }
      catch (error) { return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : 'Reader 操作失败' }], ...(error instanceof IncompleteLoadError ? { _meta: { readerIncomplete: error.incomplete } } : {}) }; }
    });
  }
  return server;
}
