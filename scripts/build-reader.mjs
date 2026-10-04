import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildInputs, serverFingerprint, sha256 } from './build-fingerprint.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));process.chdir(root);
const before=await buildInputs(root);
for(const args of [['node_modules/vite/bin/vite.js','build'],['node_modules/typescript/bin/tsc','-p','tsconfig.server.json']]){
  const result=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit',windowsHide:true});if(result.status!==0)throw Error('Reader build failed');
}
if(await buildInputs(root)!==before)throw Error('Source changed during build');
const git=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true});if(git.status!==0)throw Error('Cannot identify build commit');
await writeFile('dist/inspection-build.json',JSON.stringify({inputs:before,ui:sha256(await readFile('dist/ui/index.html')),server:await serverFingerprint(root),commit:git.stdout.trim()},null,2)+'\n');
