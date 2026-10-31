import {agentTools,agentDescriptions} from './workspace-service.js';
import { readFile } from 'node:fs/promises';
import { ErrorCode, McpError, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { OpenAIExtensions, OpenAIFileEntrypointInputSchema, type OpenAIUiToolMetadata, type OpenAIUiResourceMetadata } from '@openai/mcp-extensions/server';
import { actionSchemas, type ReaderService } from './service.js';
import { IncompleteLoadError } from '../shared/online.js';
export const VERSION = '0.3.6';
export const UI_URI = `ui://reader/v${VERSION}/bookshelf.html`;
function isPreviousUiVersion(value: string): boolean {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) return false;
  const requested = value.split('.').map(Number), current = VERSION.split('.').map(Number);
  if (requested.some(part => !Number.isSafeInteger(part)) || requested[0] !== current[0]) return false;
  for (let i = 0; i < current.length; i++) {
    if (requested[i] !== current[i]) return requested[i]! < current[i]!;
  }
  return false;
}
const names: Record<string, string> = { reader_list: '读取书架', reader_get: '打开书籍', reader_import_begin: '开始导入书籍', reader_import_chunk: '传输书籍分块', reader_import_finish: '完成书籍导入', reader_import_cancel: '取消书籍导入', reader_progress: '保存阅读进度', reader_settings: '保存阅读设置', reader_bookmark_add: '添加书签', reader_bookmark_remove: '移除书签' };
export function createMcpServer(service: ReaderService, htmlPath: string): McpServer {
  const server = new McpServer({ name: 'reader-plugin', version: VERSION });
  new OpenAIExtensions(server);
  const meta = { ui: { csp: { connectDomains: [], resourceDomains: [], frameDomains: [] }, prefersBorder: false }, 'openai/ui': { preferredDisplayMode: 'fullscreen', availableDisplayModes: ['inline', 'fullscreen'] } satisfies OpenAIUiResourceMetadata };
  registerAppResource(server, 'Reader', UI_URI, { _meta: meta }, async () => ({ contents: [{ uri: UI_URI, mimeType: RESOURCE_MIME_TYPE, text: await readFile(htmlPath, 'utf8'), _meta: meta }] }));
  // An open host can reconnect to a new server before refreshing its entrypoint
  // descriptor. Keep those older UI addresses readable without listing stale UIs.
  server.registerResource('Reader compatible UI', new ResourceTemplate('ui://reader/v{version}/bookshelf.html', { list: undefined }), { mimeType: RESOURCE_MIME_TYPE, _meta: meta }, async (uri, variables) => {
    if (typeof variables.version !== 'string' || !isPreviousUiVersion(variables.version)) throw new McpError(ErrorCode.InvalidParams, `Resource ${uri.href} not found`);
    return { contents: [{ uri: uri.href, mimeType: RESOURCE_MIME_TYPE, text: await readFile(htmlPath, 'utf8'), _meta: meta }] };
  });
  registerAppTool(server, 'reader_open', {
    title: 'Reader', description: 'Open the private Reader bookshelf. Books and notes remain on the Reader server. Model access follows the selected reading scope.', inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    _meta: { ui: { resourceUri: UI_URI,visibility:['app'] }, 'openai/ui': { entrypoints: [{ type: 'global' }, { type: 'thread' }] } satisfies OpenAIUiToolMetadata },
  }, async () => ({ content: [] }));
  registerAppTool(server, 'reader_open_file', {
    title: 'Reader', description: 'Open a TXT, DRM-free EPUB, or PDF file from a host-managed resource.', inputSchema: OpenAIFileEntrypointInputSchema,
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    _meta: { ui: { resourceUri: UI_URI, visibility: ['app'] }, 'openai/ui': { entrypoints: [{ type: 'file', extensions: ['.txt', '.epub', '.pdf'] }] } satisfies OpenAIUiToolMetadata },
  }, async () => ({ content: [] }));
  for (const [name, schema] of Object.entries(actionSchemas)) {
    server.registerTool(name, {
      title: names[name] ?? name, description: agentDescriptions[name] ?? (agentTools.has(name)?'Reader 笔记、批注与文件夹操作。修改前读取当前标识与 revision。':'Private Reader UI operation. Not intended for model invocation.'), inputSchema: schema,
      annotations: { readOnlyHint: ['reader_list','reader_online_sources','reader_keyboard','reader_trash_list','reader_books_search','reader_book_toc','reader_read_passage','reader_note_list','reader_note_get','reader_source_get','reader_annotation_list','reader_folder_list','reader_study_search','reader_workspace_search','reader_pdf_text','reader_image_get','reader_chat_get','reader_chat_list','reader_chat_models','reader_sync_status','reader_sync_network_test','reader_sync_vaults','reader_sync_conflict','reader_sync_positions','reader_sync_recovery_key'].includes(name), destructiveHint: ['reader_bookmark_remove','reader_online_remove','reader_trash','reader_study_trash','reader_study_purge','reader_book_purge'].includes(name), openWorldHint: name.startsWith('reader_sync_') || name==='reader_image_get' || name.startsWith('reader_online_') || name === 'reader_get' || name === 'reader_read_passage' || name === 'reader_book_toc' },
      _meta: { ui: { visibility: ['app'] } },
    }, async (args: unknown): Promise<CallToolResult> => {
      try { const data=await service.call(name,args);return {content:[],_meta:{reader:data,readerVersion:VERSION}}; }
      catch (error) { return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : 'Reader 操作失败' }], _meta: { readerVersion:VERSION, ...(error instanceof IncompleteLoadError ? { readerIncomplete: error.incomplete } : {}) } }; }
    });
  }
  return server;
}
