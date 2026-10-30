import {expect,type Page} from '@playwright/test';

interface BookFile {name:string;mimeType:string;buffer:Buffer;}

/** Selecting files starts an asynchronous import; it does not await durable writes. */
export async function importBooks(page:Page,input:BookFile|BookFile[]){
  const files=Array.isArray(input)?input:[input];let completed=0;
  const finished=page.waitForResponse(response=>response.url().endsWith('/api/tool')&&response.request().postDataJSON()?.name==='reader_import_finish'&&++completed===files.length,{timeout:60000}).then(async response=>{expect(response.ok()).toBe(true);const result=await response.json();expect(result.isError,JSON.stringify(result)).not.toBe(true);});
  // Closing a failed test's page rejects the pending response waiter as well.
  void finished.catch(()=>{});
  await page.getByLabel('选择 TXT、EPUB 或 PDF 书籍').setInputFiles(input);
  await finished;
}
