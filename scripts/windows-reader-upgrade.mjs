// Explicit Windows maintainer delivery. Reuses the official plugin CLI and the
// existing package format. Never edits Codex configuration or restores user data.
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { resolve, join, dirname, isAbsolute, relative, sep } from 'node:path';
import { homedir } from 'node:os';
import { parseArgs, promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const mode=process.argv[2];
const {values}=parseArgs({args:process.argv.slice(3),options:{codex:{type:'string'},package:{type:'string'},output:{type:'string'},receipt:{type:'string'},inspection:{type:'string'},'data-dir':{type:'string'},'expected-previous':{type:'string'},'codex-home':{type:'string'}}});
assert.equal(process.platform,'win32','This delivery command is Windows only');
assert.ok(['prepare','install','verify','rollback','retire-probe'].includes(mode),'Choose prepare|install|verify|rollback|retire-probe');
assert.ok(values.codex&&isAbsolute(values.codex),'Pass the installed official Codex CLI absolute path');
const run=promisify(execFile), hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const readJson=async path=>JSON.parse(await fs.readFile(path,'utf8'));
const writeJson=async(path,value)=>{await fs.writeFile(path+'.tmp',JSON.stringify(value,null,2)+'\n',{mode:0o600});await fs.rename(path+'.tmp',path);};
const cli=async(...args)=>JSON.parse((await run(values.codex,[...args,'--json'],{windowsHide:true,maxBuffer:16*1024*1024})).stdout);
function child(root,name){assert.ok(name&&!name.includes('\\')&&!name.split('/').some(p=>!p||p==='.'||p==='..')&&!/^[a-z]:|^\//i.test(name));const path=resolve(root,...name.split('/'));assert.ok(path.toLowerCase().startsWith(resolve(root).toLowerCase()+sep));return path;}
async function inventory(root,skipLocks=false){
  const result={};
  async function visit(prefix=''){for(const entry of await fs.readdir(join(root,prefix),{withFileTypes:true})){
    const name=prefix?prefix+'/'+entry.name:entry.name;if(skipLocks&&name==='.locks')continue;
    assert.ok(!entry.isSymbolicLink(),'Unexpected link in delivery scope');
    if(entry.isDirectory())await visit(name);else if(entry.isFile()){const bytes=await fs.readFile(child(root,name));result[name]={sha256:hash(bytes),bytes:bytes.length};}
  }}await visit();return Object.fromEntries(Object.entries(result).sort(([a],[b])=>a.localeCompare(b)));
}
async function copyInventory(from,to,files){
  await fs.mkdir(to,{recursive:false,mode:0o700});
  for(const name of Object.keys(files)){const target=child(to,name);await fs.mkdir(dirname(target),{recursive:true});await fs.copyFile(child(from,name),target);}
  assert.deepEqual(await inventory(to),files,'Copied bytes differ');
}
async function verifyPackage(root){
  const manifest=await readJson(join(root,'runtime-manifest.json')), index=await readJson(join(root,'PACKAGE-SHA256.json'));
  assert.equal(manifest.kind,'reader-bundled-runtime');assert.equal(manifest.target,'win32-x64');assert.equal(manifest.source.dirty,false);assert.equal(manifest.testFixture,false);
  const files=await inventory(root);assert.deepEqual(Object.keys(files).sort(),[...Object.keys(index),'PACKAGE-SHA256.json'].sort(),'Unexpected package files');
  for(const [name,digest] of Object.entries(index))assert.equal(files[name]?.sha256,digest,name);
  assert.equal((await readJson(join(root,'plugin.json'))).version,manifest.version);
  return {root,manifest,files,manifestSha256:hash(await fs.readFile(join(root,'runtime-manifest.json'))),inventorySha256:hash(await fs.readFile(join(root,'PACKAGE-SHA256.json')))};
}
async function makeMarketplace(destination,packageRoot,files){
  await fs.mkdir(destination,{recursive:false,mode:0o700});await fs.mkdir(join(destination,'plugins'));
  await copyInventory(packageRoot,join(destination,'plugins','reader-win32-x64'),files);
  await fs.mkdir(join(destination,'.agents','plugins'),{recursive:true});
  await writeJson(join(destination,'.agents','plugins','marketplace.json'),{name:'reader-marketplace',interface:{displayName:'Reader'},plugins:[{name:'reader-win32-x64',source:{source:'local',path:'./plugins/reader-win32-x64'},policy:{installation:'AVAILABLE',authentication:'ON_INSTALL'},category:'Productivity'}]});
}
const receiptPath=values.receipt?resolve(values.receipt):values.output?join(resolve(values.output),'upgrade-receipt.json'):undefined;
assert.ok(receiptPath,'Pass --output for prepare or --receipt for subsequent steps');
let receipt;
if(mode==='prepare'){
  assert.ok(values.package&&values.output&&values['expected-previous']);
  const output=resolve(values.output),data=resolve(values['data-dir']??join(process.env.LOCALAPPDATA,'Reader'));
  assert.ok(!output.toLowerCase().startsWith(data.toLowerCase()+sep)&&output.toLowerCase()!==data.toLowerCase());
  const candidate=await verifyPackage(resolve(values.package));
  const registration=await cli('mcp','get','reader'),oldRoot=dirname(registration.transport.command),old=await verifyPackage(oldRoot);
  assert.equal(old.manifest.version,values['expected-previous'],'Installed Reader changed; do not guess the base');
  assert.notEqual(candidate.manifest.version,old.manifest.version,'New bytes require a new version');
  const marketplaces=await cli('plugin','marketplace','list');const previous=marketplaces.marketplaces.find(x=>x.name==='reader-marketplace');assert.ok(previous?.root);
  await fs.mkdir(output,{recursive:false,mode:0o700});
  const before=await inventory(data,true);await copyInventory(data,join(output,'data-backup'),before);assert.deepEqual(await inventory(data,true),before,'Data changed during backup');
  await makeMarketplace(join(output,'rollback-marketplace'),oldRoot,old.files);
  await makeMarketplace(join(output,'marketplace'),candidate.root,candidate.files);
  const codexHome=resolve(values['codex-home']??join(homedir(),'.codex'));
  await fs.copyFile(join(codexHome,'config.toml'),join(output,'codex-config.before.toml'));
  const registry=await readJson(join(data,'online-v1','sources.json'));
  receipt={schemaVersion:1,phase:'prepared',preparedAt:new Date().toISOString(),output,data,codexHome,candidate:{version:candidate.manifest.version,source:candidate.manifest.source,manifestSha256:candidate.manifestSha256,inventorySha256:candidate.inventorySha256,files:candidate.files},previous:{version:old.manifest.version,source:old.manifest.source,marketplace:previous.root,registration,manifestSha256:old.manifestSha256},marketplace:join(output,'marketplace'),rollbackMarketplace:join(output,'rollback-marketplace'),dataBefore:before,catalogVersions:registry.catalogReceipts?.map(x=>({catalogId:x.catalogId,version:x.version})),realCodexUIAccepted:false,mainApplicationStopped:false,automaticDataRestore:false};
  await writeJson(receiptPath,receipt);
}else receipt=await readJson(receiptPath);

async function switchTo(marketplace){
  const list=await cli('plugin','marketplace','list');
  if(list.marketplaces.some(x=>x.name==='reader-marketplace'))await cli('plugin','marketplace','remove','reader-marketplace');
  await cli('plugin','marketplace','add',marketplace);
  return cli('plugin','add','reader-win32-x64@reader-marketplace');
}
async function verifyInstalled(expected){
  const registration=await cli('mcp','get','reader');const root=dirname(registration.transport.command),installed=await verifyPackage(root);
  assert.equal(installed.manifest.version,expected.version);assert.equal(installed.manifest.source.commit,expected.source.commit);assert.equal(installed.manifestSha256,expected.manifestSha256);
  const transport=registration.transport;const env={};for(const name of ['SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA'])if(process.env[name])env[name]=process.env[name];
  const client=new Client({name:'Reader authorized Windows delivery verification',version:expected.version});
  const stdio=new StdioClientTransport({command:transport.command,args:transport.args??[],cwd:transport.cwd,env:{...env,...transport.env,READER_DATA_DIR:receipt.data,PATH:'',NODE_OPTIONS:'',NODE_PATH:''},stderr:'pipe'});
  let result;
  try{
    await client.connect(stdio);const server=client.getServerVersion();assert.equal(server.version,expected.version);
    const resource=await client.readResource({uri:`ui://reader/v${expected.version}/bookshelf.html`});assert.equal(hash(resource.contents[0].text),installed.manifest.files['app/dist/ui/index.html']);
    const toolList=await client.listTools();const epubTools=toolList.tools.filter(x=>x.name.startsWith('reader_epub_'));for(const tool of epubTools)assert.deepEqual(tool._meta?.ui?.visibility,['app']);
    const call=async name=>{const value=await client.callTool({name,arguments:{}});assert.ok(!value.isError);return value._meta.reader;};
    const library=await call('reader_list'),trash=await call('reader_trash_list'),sources=await call('reader_online_sources');await call('reader_keyboard');
    result={checkedAt:new Date().toISOString(),version:server.version,source:installed.manifest.source,root,pid:stdio.pid,nativeLauncherStarted:true,uiResourceVerified:true,uiSha256:hash(resource.contents[0].text),packageFilesVerified:Object.keys(installed.files).length,manifestSha256:installed.manifestSha256,epubAppOnlyTools:epubTools.length,shelfBooks:library.books.length,trashRecords:trash.length,sourceStates:sources.map(x=>({id:x.id,enabled:x.enabled,revision:x.revision})),realCodexUIAccepted:false};
  }finally{await client.close();}
  assert.deepEqual(await inventory(receipt.data,true),receipt.dataBefore,'Persistent data changed; retain both snapshots and do not restore automatically');
  result.allPersistentDataByteIdentical=true;result.persistentFiles=Object.keys(receipt.dataBefore).length;
  return result;
}
if(mode==='install'){
  assert.ok(values.inspection,'Pass the final package inspection report');
  const inspection=await readJson(resolve(values.inspection));assert.equal(inspection.passed,true);assert.equal(inspection.package?.manifestSha256,receipt.candidate.manifestSha256);assert.equal(inspection.package?.source.commit,receipt.candidate.source.commit);
  const current=await cli('mcp','get','reader');const currentPackage=await verifyPackage(dirname(current.transport.command));assert.equal(currentPackage.manifestSha256,receipt.previous.manifestSha256,'Registered base changed');
  assert.deepEqual(await inventory(receipt.data,true),receipt.dataBefore,'Library changed since backup; prepare a new coherent backup');
  const candidate=await verifyPackage(join(receipt.marketplace,'plugins','reader-win32-x64'));assert.equal(candidate.manifestSha256,receipt.candidate.manifestSha256);
  receipt.inspection=resolve(values.inspection);receipt.phase='installing';await writeJson(receiptPath,receipt);
  try{receipt.install=await switchTo(receipt.marketplace);receipt.verification=await verifyInstalled(receipt.candidate);receipt.phase='installed-and-verified';}
  catch(error){receipt.failure=String(error.stack??error);receipt.phase='failed';try{await switchTo(receipt.rollbackMarketplace);receipt.registrationRolledBack=true;}catch(rollbackError){receipt.rollbackError=String(rollbackError);}await writeJson(receiptPath,receipt);throw error;}
  await writeJson(receiptPath,receipt);
}
if(mode==='verify'){receipt.verification=await verifyInstalled(receipt.candidate);await writeJson(receiptPath,receipt);}
if(mode==='rollback'){
  await verifyPackage(join(receipt.rollbackMarketplace,'plugins','reader-win32-x64'));
  const before=await inventory(receipt.data,true);await switchTo(receipt.rollbackMarketplace);assert.deepEqual(await inventory(receipt.data,true),before);
  receipt.rollback={at:new Date().toISOString(),version:receipt.previous.version,dataRestored:false,sidecarsRetained:true};receipt.phase='rolled-back';await writeJson(receiptPath,receipt);
}
if(mode==='retire-probe'){
  const id='reader-epub-probe@reader-epub-lab',installed=await cli('plugin','list');const probe=installed.installed.find(x=>x.pluginId===id);
  const list=await cli('plugin','marketplace','list'),market=list.marketplaces.find(x=>x.name==='reader-epub-lab');
  const backup=join(receipt.output,'probe-backup');await fs.mkdir(backup,{recursive:false,mode:0o700});
  await writeJson(join(backup,'registration.json'),{probe,market});
  if(market?.root)await copyInventory(market.root,join(backup,'marketplace'),await inventory(market.root));
  if(probe){const cached=join(receipt.codexHome,'plugins','cache','reader-epub-lab','reader-epub-probe',probe.version);await copyInventory(cached,join(backup,'installed'),await inventory(cached));await cli('plugin','remove',id);}
  if(market)await cli('plugin','marketplace','remove','reader-epub-lab');
  const after=await cli('plugin','list');assert.ok(!after.installed.some(x=>x.pluginId===id));
  assert.deepEqual(await inventory(receipt.data,true),receipt.dataBefore);
  receipt.probe={retiredAt:new Date().toISOString(),backup,recoverable:true,sourceDirectoryRetained:true,restore:'Re-add the preserved original marketplace path, then plugin add reader-epub-probe@reader-epub-lab'};await writeJson(receiptPath,receipt);
}
console.log(JSON.stringify({receipt:receiptPath,phase:receipt.phase,version:receipt.candidate.version,source:receipt.candidate.source,verification:receipt.verification,probe:receipt.probe},null,2));
