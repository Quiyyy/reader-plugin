import { z } from 'zod';
import type { BookDetail, ReaderSettings } from '../shared/types';

const targetSchema = z.discriminatedUnion('kind', [
  z.object({kind:z.enum(['library','notes','online','trash'])}),
  z.object({kind:z.literal('search'),query:z.string().optional(),filter:z.enum(['all','book','note','annotation','passage']).optional()}),
  z.object({kind:z.literal('note'),origin:z.enum(['library','notes']).optional(),noteId:z.string().uuid()}),
  z.object({kind:z.literal('book'),bookId:z.string().min(1).max(200),origin:z.enum(['library','online']).optional(),query:z.string().optional(),sourceId:z.string().uuid().optional(),returnNoteId:z.string().uuid().optional(),locator:z.object({chapter:z.number().int().nonnegative(),paragraph:z.number().int().nonnegative(),chapterId:z.string().optional()}).optional()}),
]);
export type PageTarget = z.infer<typeof targetSchema>;
export interface OpenPage {target:PageTarget;title?:string;book?:BookDetail;settings?:ReaderSettings;password?:string;focus?:'import-options';}
export interface WorkspaceNotice {text:string;undo?:()=>Promise<void>;}
export interface WorkspaceTab extends OpenPage {id:string;title:string;}
export interface TabGroup {kind:'group';id:string;tabs:string[];active:string;}
export interface Split {kind:'split';id:string;axis:'horizontal'|'vertical';ratio:number;first:LayoutNode;second:LayoutNode;}
export type LayoutNode = TabGroup | Split;
export interface TabLayout {version:1;tabs:WorkspaceTab[];root:LayoutNode;focused:string;}
export type DropEdge = 'center'|'left'|'right'|'top'|'bottom';
export const workspaceChrome = {tabHeight:36,toolbarHeight:40,statusHeight:32,dividerSize:1,dividerHitSize:9} as const;
export const layoutStorageKey = 'reader-workspace-tabs-v1';
export const pageTitle = (target:PageTarget) => ({library:'书库',notes:'笔记',search:'搜索',online:'在线找书',trash:'回收站',book:'阅读',note:'未命名笔记'})[target.kind];
export const pageKey = (target:PageTarget) => target.kind==='book' ? `book:${target.bookId}:${target.sourceId??''}` : target.kind==='note' ? `note:${target.noteId}` : target.kind;
export function groups(node:LayoutNode):TabGroup[] {return node.kind==='group'?[node]:[...groups(node.first),...groups(node.second)];}
export function mapLayout(node:LayoutNode, fn:(group:TabGroup)=>LayoutNode):LayoutNode {return node.kind==='group'?fn(node):{...node,first:mapLayout(node.first,fn),second:mapLayout(node.second,fn)};}
function prune(node:LayoutNode):LayoutNode|undefined {
  if(node.kind==='group')return node.tabs.length?node:undefined;
  const first=prune(node.first),second=prune(node.second);
  return first&&second?{...node,first,second}:first??second;
}
export function initialLayout():TabLayout {
  const tab:WorkspaceTab={id:crypto.randomUUID(),target:{kind:'library'},title:'书库'};
  const root:TabGroup={kind:'group',id:crypto.randomUUID(),tabs:[tab.id],active:tab.id};
  return {version:1,tabs:[tab],root,focused:root.id};
}
export function activateTab(layout:TabLayout,id:string):TabLayout {
  const group=groups(layout.root).find(g=>g.tabs.includes(id));if(!group)return layout;
  return {...layout,focused:group.id,root:mapLayout(layout.root,g=>g.id===group.id?{...g,active:id}:g)};
}
export function openTab(layout:TabLayout,page:OpenPage,groupId=layout.focused):TabLayout {
  const existing=layout.tabs.find(tab=>pageKey(tab.target)===pageKey(page.target));
  if(existing){
    const next=activateTab(layout,existing.id);
    // Only an explicit passage navigation reloads an already open document.
    return (page.target.kind==='book'&&page.target.locator||page.target.kind==='search')?{...next,tabs:next.tabs.map(tab=>tab.id===existing.id?{...tab,...page}:tab)}:next;
  }
  const tab:WorkspaceTab={...page,id:crypto.randomUUID(),title:page.title??pageTitle(page.target)};
  const group=groups(layout.root).find(g=>g.id===groupId)??groups(layout.root)[0]!;
  return {...layout,tabs:[...layout.tabs,tab],focused:group.id,root:mapLayout(layout.root,g=>g.id===group.id?{...g,tabs:[...g.tabs,tab.id],active:tab.id}:g)};
}
export function closeTab(layout:TabLayout,id:string):TabLayout {
  const tabs=layout.tabs.filter(t=>t.id!==id);if(tabs.length===layout.tabs.length)return layout;
  if(!tabs.length)return initialLayout();
  const root=prune(mapLayout(layout.root,g=>{const index=g.tabs.indexOf(id),remaining=g.tabs.filter(t=>t!==id);return {...g,tabs:remaining,active:g.active===id?remaining[Math.max(0,index-1)]??'':g.active};}))!;
  return {...layout,tabs,root,focused:groups(root).some(g=>g.id===layout.focused)?layout.focused:groups(root)[0]!.id};
}
export function moveTab(layout:TabLayout,id:string,targetId:string,edge:DropEdge='center',before?:string):TabLayout {
  const source=groups(layout.root).find(g=>g.tabs.includes(id)),target=groups(layout.root).find(g=>g.id===targetId);
  if(!source||!target||source.id===targetId&&(edge!=='center'&&source.tabs.length===1||before===id))return layout;
  const detached=mapLayout(layout.root,g=>{
    if(g.id!==source.id)return g;
    const tabs=g.tabs.filter(t=>t!==id),index=g.tabs.indexOf(id);
    return {...g,tabs,active:g.active===id?tabs[Math.max(0,index-1)]??'':g.active};
  });
  const newGroup:TabGroup={kind:'group',id:crypto.randomUUID(),tabs:[id],active:id};
  const root=prune(mapLayout(detached,g=>{
    if(g.id!==targetId)return g;
    if(edge==='center'){const tabs=[...g.tabs],index=before?tabs.indexOf(before):-1;tabs.splice(index<0?tabs.length:index,0,id);return {...g,tabs,active:id};}
    return {kind:'split',id:crypto.randomUUID(),axis:edge==='left'||edge==='right'?'horizontal':'vertical',ratio:.5,first:edge==='left'||edge==='top'?newGroup:g,second:edge==='left'||edge==='top'?g:newGroup};
  }))!;
  return {...layout,root,focused:edge==='center'?targetId:newGroup.id};
}
export function resizeSplit(node:LayoutNode,id:string,ratio:number):LayoutNode {
  if(node.kind==='group')return node;
  return node.id===id?{...node,ratio:Math.max(.1,Math.min(.9,ratio))}:{...node,first:resizeSplit(node.first,id,ratio),second:resizeSplit(node.second,id,ratio)};
}
export interface Rect {x:number;y:number;width:number;height:number;}
export function minimumSize(node:LayoutNode):{width:number;height:number} {
  if(node.kind==='group')return {width:260,height:200};
  const a=minimumSize(node.first),b=minimumSize(node.second);
  return node.axis==='horizontal'?{width:a.width+b.width+workspaceChrome.dividerSize,height:Math.max(a.height,b.height)}:{width:Math.max(a.width,b.width),height:a.height+b.height+workspaceChrome.dividerSize};
}
export function layoutRects(root:LayoutNode,width:number,height:number) {
  const panes:Array<{group:TabGroup;rect:Rect}>=[],dividers:Array<{split:Split;rect:Rect;parent:Rect;min:number;max:number}>=[];
  const visit=(node:LayoutNode,rect:Rect)=>{
    if(node.kind==='group'){panes.push({group:node,rect});return;}
    const gap=workspaceChrome.dividerSize,horizontal=node.axis==='horizontal',size=(horizontal?rect.width:rect.height)-gap,a=minimumSize(node.first),b=minimumSize(node.second),min=(horizontal?a.width:a.height)/size,max=1-(horizontal?b.width:b.height)/size;
    const first=Math.round(size*Math.max(min,Math.min(max,node.ratio))),second=size-first;
    dividers.push({split:node,parent:rect,min,max,rect:horizontal?{...rect,x:rect.x+first,width:gap}:{...rect,y:rect.y+first,height:gap}});
    visit(node.first,horizontal?{...rect,width:first}:{...rect,height:first});visit(node.second,horizontal?{...rect,x:rect.x+first+gap,width:second}:{...rect,y:rect.y+first+gap,height:second});
  };
  visit(root,{x:0,y:0,width,height});return {panes,dividers};
}
const nodeSchema:z.ZodType<LayoutNode>=z.lazy(()=>z.discriminatedUnion('kind',[
  z.object({kind:z.literal('group'),id:z.string().uuid(),tabs:z.array(z.string().uuid()).min(1).max(100),active:z.string().uuid()}),
  z.object({kind:z.literal('split'),id:z.string().uuid(),axis:z.enum(['horizontal','vertical']),ratio:z.number().min(.1).max(.9),first:nodeSchema,second:nodeSchema}),
]));
export function restoreLayout(raw:string|null):TabLayout|undefined {
  if(!raw||raw.length>100000)return;
  try {
    // Bound tree depth before recursive validation of session data.
    const input=JSON.parse(raw),pending=[{node:input.root,depth:0}];let count=0;
    while(pending.length){const {node,depth}=pending.pop()!;if(!node||depth>12||++count>199)return;if(node.kind==='split')pending.push({node:node.first,depth:depth+1},{node:node.second,depth:depth+1});}
    const parsed=z.object({version:z.literal(1),tabs:z.array(z.object({id:z.string().uuid(),title:z.string().max(500),target:targetSchema})).min(1).max(100),root:nodeSchema,focused:z.string().uuid()}).parse(input);
    const all=groups(parsed.root),ids=all.flatMap(g=>g.tabs),known=new Set(parsed.tabs.map(t=>t.id));
    if(known.size!==parsed.tabs.length||new Set(ids).size!==ids.length||ids.length!==known.size||ids.some(id=>!known.has(id))||all.some(g=>!g.tabs.includes(g.active))||!all.some(g=>g.id===parsed.focused))return;
    const nodeIds=new Set<string>();const check=(node:LayoutNode):boolean=>{if(nodeIds.has(node.id))return false;nodeIds.add(node.id);return node.kind==='group'||check(node.first)&&check(node.second);};
    if(!check(parsed.root)||new Set(parsed.tabs.map(t=>pageKey(t.target))).size!==parsed.tabs.length)return;
    return parsed;
  }catch{return;}
}
export function serializeLayout(layout:TabLayout):string {return JSON.stringify({...layout,tabs:layout.tabs.map(({id,title,target})=>({id,title,target}))});}
