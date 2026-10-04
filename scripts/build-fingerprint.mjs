import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
export const sha256=value=>createHash('sha256').update(value).digest('hex');
async function pathsUnder(root,directory){const result=[];for(const entry of await readdir(join(root,directory),{withFileTypes:true})){const path=directory+'/'+entry.name;if(entry.isDirectory())result.push(...await pathsUnder(root,path));else result.push(path);}return result;}
async function fingerprint(root,paths){let value='';for(const path of paths.sort())value+=`${path}\0${sha256(await readFile(join(root,path)))}\n`;return sha256(value);}
export async function buildInputs(root){return fingerprint(root,[...await pathsUnder(root,'src'),...await pathsUnder(root,'tests/host'),'package.json','package-lock.json','vite.config.ts','tsconfig.json','tsconfig.server.json','scripts/inline-ui.mjs','scripts/build-reader.mjs','scripts/build-fingerprint.mjs']);}
export async function serverFingerprint(root){return fingerprint(root,[...await pathsUnder(root,'dist/server'),...await pathsUnder(root,'dist/shared')]);}
