// Targeted UI acceptance, using the inspector's existing isolated native bridge.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

export async function inspectTxt({ page, app, client, dataDir, output, report, bytes, expectedChapters }) {
  const hash=b=>createHash('sha256').update(b).digest('hex');
  const input=app.getByLabel('选择 TXT 或 EPUB 书籍');
  const count=name=>report.calls.filter(call=>call===name).length;
  const initial=count('reader_import_begin');
  await input.setInputFiles([]); // A cancelled file selection must not create an upload.
  assert.equal(count('reader_import_begin'),initial);
  await input.setInputFiles({name:'invalid-control.txt',mimeType:'text/plain',buffer:Buffer.from('private-fixture\n\0')});
  await expect(app.getByText(/1 个无法安全处理的控制字符/)).toBeVisible();
  await expect(app.getByText(/U\+0000（第 2 行第 1 列）/)).toBeVisible();
  const failureText=await app.locator('.error-notice').innerText();
  assert(!failureText.includes('private-fixture'));
  await app.getByRole('button',{name:'重试',exact:true}).click();
  await expect.poll(()=>count('reader_import_cancel')).toBe(2);
  await expect(app.getByRole('button',{name:'导入书籍',exact:true})).toBeEnabled();
  await page.screenshot({path:join(output,'txt-error.png')});
  report.screenshots.push(join(output,'txt-error.png'));
  const before=count('reader_import_begin');
  await input.setInputFiles({name:'兼容验收.txt',mimeType:'text/plain',buffer:bytes});
  // Simulate a repeated input event while the real upload is in flight. The
  // existing synchronous lock must reject it, alongside disabled UI controls.
  await input.dispatchEvent('change');
  await expect(app.getByRole('button',{name:'返回书架',exact:true})).toBeVisible();
  assert.equal(count('reader_import_begin')-before,1);
  await expect(app.locator('.toast')).toHaveText('书籍已导入，已兼容处理文本格式');
  await expect(app.locator('.toast')).toBeVisible();
  const id=hash(bytes),raw=await readFile(join(dataDir,'books',id,'source.txt'));
  assert(raw.equals(bytes));
  const document=JSON.parse(await readFile(join(dataDir,'books',id,'document.json'),'utf8'));
  const contentHash=hash(JSON.stringify(document.chapters));
  if(expectedChapters)assert.equal(contentHash,expectedChapters,'Non-target chapter content changed');
  assert(document.textCompatibility);
  await page.screenshot({path:join(output,'txt-reading.png')});report.screenshots.push(join(output,'txt-reading.png'));
  await app.locator('.book-warnings summary').click();
  await expect(app.getByText('已兼容处理文本格式字符，原始文件完整保留。',{exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:900});
  await page.screenshot({path:join(output,'txt-reading-390.png')});report.screenshots.push(join(output,'txt-reading-390.png'));
  await expect(app.getByRole('button',{name:'返回书架',exact:true})).toBeVisible();
  await app.getByRole('button',{name:'返回书架',exact:true}).click();
  const listed=await client.callTool({name:'reader_list',arguments:{}});
  assert(!listed.isError);assert.equal(listed._meta.reader.books.filter(b=>b.id===id).length,1);
  report.txt={id,bytes:bytes.length,encoding:document.encoding,compatibility:document.textCompatibility,chapters:document.chapters.length,paragraphs:document.chapters.reduce((n,c)=>n+c.paragraphs.length,0),chapterContentSha256:contentHash,rawSourceByteIdentical:true,expectedChaptersMatched:!!expectedChapters,cancelledSelectionNoUpload:true,failedUploadsCancelled:2,retryVerified:true,duplicateInputSuppressed:true,realCodexHost:false};
  await page.setViewportSize({width:1100,height:900});
  report.checks.push('Default TXT import, compatibility notice, private error positions, cancellation/retry, duplicate input, original source bytes, narrow layout');
}
