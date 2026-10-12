import { it,expect } from 'vitest';
import { mkdtemp,rm,readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ReaderService } from '../src/server/service.js';
import { ReaderStore } from '../src/server/store.js';
import { pdfFixture } from './pdf-fixture.js';
it('imports a real PDF, reads original text, preserves bytes and restores progress and trash',async()=>{const dir=await mkdtemp(join(tmpdir(),'Reader PDF '));try{const s=new ReaderService(new ReaderStore(dir)),bytes=pdfFixture();const book=await s.pdf.importBook('学习.pdf',bytes);expect(book.summary.format).toBe('pdf');expect(book.summary.chapterCount).toBe(1);expect((await s.pdf.text(book.summary.id,1)).text).toContain('Recall a concept');expect(await readFile(join(dir,'pdf-v1',book.summary.id,'source.pdf'))).toEqual(bytes);await s.pdf.save(book.summary.id,{page:1,scroll:.4,scale:1.5,rotation:90});const second=new ReaderService(new ReaderStore(dir));expect(await second.pdf.open(book.summary.id)).toMatchObject({scroll:.4,scale:1.5,rotation:90});await second.call('reader_trash',{id:book.summary.id});expect(await second.pdf.list()).toEqual([]);await second.call('reader_restore',{id:book.summary.id});expect((await second.pdf.list()).length).toBe(1);await expect(second.pdf.importBook('bad.pdf',Buffer.from('%PDF-corrupt'))).rejects.toThrow();}finally{await rm(dir,{recursive:true,force:true});}},60000);
