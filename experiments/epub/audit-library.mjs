// Explicit read-only migration readiness audit. Never instantiate/open ReaderStore.
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { importDocument } from '../../src/server/importers.ts';
import { readSafeZip } from '../../src/server/formats/zip.ts';

const [directory,bookPath,output]=process.argv.slice(2);
if(!directory||!bookPath||!output)throw Error('Usage: node --import tsx audit-library.mjs <Reader data directory> <authorized EPUB> <output JSON>');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function inventory(path,prefix=''){
  const files=[];
  for(const item of await readdir(path,{withFileTypes:true})){
    const relative=prefix+item.name,full=join(path,item.name);
    if(item.isSymbolicLink())throw Error('Unexpected symlink in audit scope');
    if(item.isDirectory())files.push(...await inventory(full,relative+'/'));
    else if(item.isFile())files.push({path:relative,sha256:hash(await readFile(full))});
  }
  return files.sort((a,b)=>a.path.localeCompare(b.path));
}
const before=await inventory(resolve(directory)),books=[];
for(const file of before.filter(f=>f.path.endsWith('/source.epub'))){
  const bytes=await readFile(join(directory,file.path));
  const parent=file.path.slice(0,-'source.epub'.length);
  const document=JSON.parse(await readFile(join(directory,parent,'document.json'),'utf8'));
  const record=JSON.parse(await readFile(join(directory,parent,'record.json'),'utf8'));
  const parsed=importDocument('source.epub',bytes);
  books.push({id:document.id,sourceHashMatchesId:hash(bytes)===document.id,legacyParagraphsReproduce:JSON.stringify(document.chapters.map(c=>c.paragraphs))===JSON.stringify(parsed.chapters.map(c=>c.paragraphs)),legacyLocator:record.summary.locator,bookmarkCount:record.bookmarks.length,sourceBytes:bytes.length});
}
const bytes=await readFile(resolve(bookPath)),archive=readSafeZip(bytes),parsed=importDocument('authorized.epub',bytes);
const entries=[...archive.keys()];
const report={mode:'read-only-pre-migration-audit',migrationPerformed:false,existingEpubs:books,requestedBook:{path:resolve(bookPath),sha256:hash(bytes),bytes:bytes.length,safeZipAccepted:true,legacyImportAccepted:true,chapters:parsed.chapters.length,images:entries.filter(p=>/\.(png|jpe?g|gif|svg|webp)$/i.test(p)).length,fonts:entries.filter(p=>/\.(ttf|otf|woff2?)$/i.test(p)).length,hasStandardNcxDoctype:entries.filter(p=>/\.ncx$/i.test(p)).some(p=>new TextDecoder().decode(archive.get(p)).includes('<!DOCTYPE ncx'))},persistentFileCount:before.length,filesByteIdenticalDuringAudit:JSON.stringify(before)===JSON.stringify(await inventory(resolve(directory))),inventory:before};
await writeFile(resolve(output),JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,inventory:undefined},null,2));
