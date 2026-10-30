import type { ReaderSettings } from '../shared/types';
import type { EpubAppearance } from '../shared/epub';
import { defaultPreferences,type WorkspacePreferences } from '../shared/preferences';

export type SettingsSection='general'|'appearance'|'reading'|'notes'|'bots'|'keyboard'|'sources'|'data'|'sync';
export interface ReadingSettingsController {get:()=>ReaderSettings;apply:(value:ReaderSettings)=>void;}
export interface EpubSettingsController {id:string;title:string;get:()=>EpubAppearance;apply:(value:EpubAppearance)=>void;}
export function resolvePreferences(value?:WorkspacePreferences):Required<WorkspacePreferences> {
  let legacy:WorkspacePreferences={};
  try{const mode=localStorage.getItem('reader-note-visual'),toolbar=localStorage.getItem('reader-note-toolbar');if(mode!==null)legacy.noteMode=mode==='false'?'source':'visual';if(toolbar!==null)legacy.noteToolbar=toolbar==='true';}catch{}
  return {...defaultPreferences,...legacy,...value};
}
