import { it,expect } from 'vitest';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/server/mcp';
import { ReaderStore } from '../src/server/store';
import { ReaderService } from '../src/server/service';

it('keeps all Reader tools app-only before and after opening the plugin while preserving app operations',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'reader-private-tools-')),html=join(directory,'index.html');await writeFile(html,'<!doctype html><title>Reader</title>');
  const service=new ReaderService(new ReaderStore(directory)),server=createMcpServer(service,html),client=new Client({name:'visibility-test',version:'1.0.0'}),[clientTransport,serverTransport]=InMemoryTransport.createLinkedPair();
  try{
    await server.connect(serverTransport);await client.connect(clientTransport);
    const before=await client.listTools();expect(before.tools.length).toBeGreaterThan(20);
    for(const tool of before.tools)expect(tool._meta?.ui).toMatchObject({visibility:['app']});
    const opened=await client.callTool({name:'reader_open',arguments:{}});expect(opened.isError).not.toBe(true);
    for(const tool of (await client.listTools()).tools)expect(tool._meta?.ui).toMatchObject({visibility:['app']});
    const note=await client.callTool({name:'reader_note_create',arguments:{title:'UI 笔记',body:'正文',folderId:null,tags:[],sourceIds:[],imageIds:[]}});
    expect(note.isError).not.toBe(true);expect(note.content).toEqual([]);expect(note.structuredContent).toBeUndefined();expect((note._meta?.reader as any).value.title).toBe('UI 笔记');
  }finally{await client.close();await server.close();await service.close();await rm(directory,{recursive:true,force:true});}
});
