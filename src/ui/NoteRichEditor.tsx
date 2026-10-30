import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { ArrowDown,ArrowUp,Copy,ScanText,Trash2 } from 'lucide-react';
import { LibraryMenu } from './LibraryMenu';
import type { Node as ProseNode } from '@tiptap/pm/model';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { Extension,Node } from '@tiptap/core';
import { Plugin,PluginKey } from '@tiptap/pm/state';
import { Decoration,DecorationSet } from '@tiptap/pm/view';
import { DragHandle } from '@tiptap/extension-drag-handle';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { TableKit } from '@tiptap/extension-table';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Image from '@tiptap/extension-image';
import CodeBlock from '@tiptap/extension-code-block';

export type NoteFormat='bold'|'italic'|'underline'|'strike'|'code'|'paragraph'|'heading1'|'heading'|'heading3'|'list'|'ordered'|'quote'|'task';
export interface NoteSelection { mode:'visual'|'source'; from:number; to:number; text:string; style?:NoteFormat; marks?:string[];rect?:{left:number;top:number;bottom:number;width?:number}; }
export interface NoteMention { from:number; to:number; query:string; rect:{left:number;top:number;bottom:number}; }
export interface NoteRichHandle {
  capture(atEnd?:boolean):NoteSelection|undefined;
  replace(selection:NoteSelection, markdown:string, insert?:boolean):void;
  removeMention(mention:NoteMention):NoteSelection;
  format(kind:NoteFormat):void;
  highlight(selection?:NoteSelection):void;
  heading(index:number):void;
  focus():void;
}

// Keep raw HTML and unsupported block syntax as literal, exportable Markdown.
// These nodes never mount HTML from the note into the document.
const LiteralBlock = Node.create({
  name:'noteLiteralBlock',group:'block',atom:true,
  addAttributes:()=>({raw:{default:''}}),
  parseHTML:()=>[{tag:'pre[data-note-literal]'}],
  renderHTML:({node})=>['pre',{'data-note-literal':'true',class:'note-literal'},node.attrs.raw],
  markdownTokenizer:{name:'noteLiteralBlock',level:'block',
    start:src=>src.search(/^ {0,3}(?:---$|<[A-Za-z!/]|\[\^[^\]]+\]:|\$\$)/m),
    tokenize(src){
      if(/^<u>/i.test(src))return undefined;
      const frontmatter=/^---\n[\s\S]*?\n---(?:\n|$)/.exec(src);if(frontmatter)return {type:'noteLiteralBlock',raw:frontmatter[0],text:frontmatter[0].trimEnd()};
      const match=/^ {0,3}(?:<[A-Za-z!/][\s\S]*?(?=\n\s*\n|$)|\[\^[^\]]+\]:[^\n]*(?:\n[ \t]+[^\n]*)*|\$\$[\s\S]*?\$\$)(?:\n|$)/.exec(src);
      return match?{type:'noteLiteralBlock',raw:match[0],text:match[0].trimEnd()}:undefined;
    }},
  parseMarkdown:(token,helpers)=>helpers.createNode('noteLiteralBlock',{raw:token.text}),
  renderMarkdown:node=>node.attrs?.raw??'',
});
const LiteralTag = Node.create({
  name:'noteLiteralTag',group:'inline',inline:true,atom:true,
  addAttributes:()=>({raw:{default:''}}),
  parseHTML:()=>[{tag:'span[data-note-tag]'}],
  renderHTML:({node})=>['span',{'data-note-tag':'true'},node.attrs.raw],
  markdownTokenizer:{name:'noteLiteralTag',level:'inline',start:src=>src.indexOf('<'),tokenize(src){if(/^<\/?u>/.test(src))return undefined;const match=/^(?:<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>)/.exec(src);return match?{type:'noteLiteralTag',raw:match[0]}:undefined;}},
  parseMarkdown:(token,helpers)=>helpers.createNode('noteLiteralTag',{raw:token.raw}),
  renderMarkdown:node=>node.attrs?.raw??'',
});
const SafeImage = Image.extend({
  renderHTML({node}) {
    const src=String(node.attrs.src??''),alt=String(node.attrs.alt??'图片');
    return /^(https?:\/\/|data:image\/(?:png|jpeg|webp);base64,)/i.test(src)
      ?['img',{src,alt,title:node.attrs.title??'',loading:'lazy',referrerpolicy:'no-referrer'}]
      :['span',{class:'note-image-reference','data-image-source':src},alt+' · '+src];
  },
});
const EditableCode = CodeBlock.extend({
  addNodeView(){return ({node})=>{
    const dom=document.createElement('div'),pre=document.createElement('pre'),contentDOM=document.createElement('code'),button=document.createElement('button');
    dom.className='note-code-block';button.type='button';button.contentEditable='false';button.setAttribute('aria-label','复制代码');button.textContent='复制';let current=node;
    button.onmousedown=event=>event.preventDefault();button.onclick=()=>{void navigator.clipboard?.writeText(current.textContent).then(()=>{button.textContent='已复制';}).catch(()=>{const range=document.createRange();range.selectNodeContents(contentDOM);window.getSelection()?.removeAllRanges();window.getSelection()?.addRange(range);button.textContent='已选中';});};
    pre.append(contentDOM);dom.append(button,pre);
    return {dom,contentDOM,stopEvent:event=>button.contains(event.target as globalThis.Node),ignoreMutation:mutation=>mutation.type!=='selection'&&!contentDOM.contains(mutation.target),update:next=>{if(next.type!==current.type)return false;current=next;return true;}};
  };},
});
const contextKey=new PluginKey<DecorationSet>('note-ai-context');
const ContextHighlight=Extension.create({name:'noteContextHighlight',addProseMirrorPlugins(){return [new Plugin({key:contextKey,state:{init:()=>DecorationSet.empty,apply(transaction,previous){const selection=transaction.getMeta(contextKey) as NoteSelection|null|undefined;if(selection!==undefined)return selection&&selection.from<selection.to?DecorationSet.create(transaction.doc,[Decoration.inline(selection.from,selection.to,{class:'note-context-highlight'})]):DecorationSet.empty;return previous.map(transaction.mapping,transaction.doc);}},props:{decorations:state=>contextKey.getState(state)}})];}});
interface BlockTarget {anchor:HTMLButtonElement;editor:Editor;node:ProseNode;pos:number;}
export function noteEditorExtensions(onBlock?:(target:BlockTarget)=>void) {
  let hovered:{node:ProseNode;editor:Editor}|undefined;
  // Focusing or opening a note must not append a paragraph and rewrite its source.
  return [StarterKit.configure({link:{openOnClick:false,autolink:false,linkOnPaste:false},codeBlock:false,trailingNode:false}),EditableCode,ContextHighlight,
    DragHandle.configure({onNodeChange:({node,editor})=>{hovered=node?{node,editor}:undefined;},render:()=>{
      const handle=document.createElement('button');handle.type='button';handle.className='note-block-handle';handle.title='拖动调整顺序，点击打开块操作';handle.setAttribute('aria-label','块操作');handle.setAttribute('aria-haspopup','menu');
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 14 14');svg.setAttribute('width','14');svg.setAttribute('height','14');svg.setAttribute('aria-hidden','true');
      for(const x of [4.5,9.5])for(const y of [3,7,11]){const dot=document.createElementNS(svg.namespaceURI,'circle');dot.setAttribute('cx',String(x));dot.setAttribute('cy',String(y));dot.setAttribute('r','1');dot.setAttribute('fill','currentColor');svg.append(dot);}handle.append(svg);
      handle.onclick=()=>{if(!hovered)return;const {editor,node}=hovered;editor.state.doc.forEach((child,pos)=>{if(child===node)onBlock?.({anchor:handle,editor,node,pos});});};return handle;
    }}),
    Markdown,TableKit.configure({table:{resizable:false}}),TaskList,TaskItem.configure({nested:true}),SafeImage,LiteralBlock,LiteralTag];
}
function capture(editor:Editor,atEnd=false):NoteSelection {
  const {from,to}=atEnd?{from:editor.state.doc.content.size,to:editor.state.doc.content.size}:editor.state.selection,start=editor.view.coordsAtPos(from),end=editor.view.coordsAtPos(to);
  const box=editor.view.dom.getBoundingClientRect(),range=window.getSelection()?.rangeCount?window.getSelection()!.getRangeAt(0):undefined;
  const rect=range&&editor.view.dom.contains(range.commonAncestorContainer)?range.getBoundingClientRect():undefined;
  const level=editor.state.selection.$from.parent.attrs.level;
  return {mode:'visual',from,to,text:editor.state.doc.textBetween(from,to,'\n'),style:editor.isActive('heading')?(level===1?'heading1':level===3?'heading3':'heading'):'paragraph',marks:['bold','italic','underline','strike','code'].filter(mark=>editor.isActive(mark)),rect:{left:rect?.left??box.left,top:rect?.top??start.top,bottom:rect?.bottom??end.bottom,width:rect?.width??box.width}};
}
interface Props {value:string;onChange:(value:string)=>void;onSelection:(selection:NoteSelection)=>void;onMention:(mention:NoteMention|undefined)=>void;onKey:(event:KeyboardEvent)=>boolean;onRequest?:(selection:NoteSelection)=>void;}
export const NoteRichEditor=forwardRef<NoteRichHandle,Props>(function NoteRichEditor(props,ref){
  const latest=useRef(props);latest.current=props;const last=useRef(props.value);
  const [block,setBlock]=useState<BlockTarget>();
  const closeBlock=()=>{if(editor&&!editor.isDestroyed)editor.commands.unlockDragHandle();setBlock(undefined);};
  const extensions=useMemo(()=>noteEditorExtensions(target=>{target.editor.commands.lockDragHandle();setBlock(target);const selection=capture(target.editor);latest.current.onSelection({...selection,to:selection.from});}),[]);
  const report=(editor:Editor)=>{
    if(editor.view.composing)return;
    latest.current.onSelection(capture(editor));
    const {$from,empty}=editor.state.selection;
    const before=$from.parent.textBetween(0,$from.parentOffset,'','\ufffc');
    const match=empty?/(?:^|\s)@([^@\s]{0,32})$/.exec(before):null;
    const rect=editor.view.coordsAtPos($from.pos);
    latest.current.onMention(match&&!$from.parent.type.spec.code?{from:$from.pos-match[1].length-1,to:$from.pos,query:match[1],rect:{left:rect.left,top:rect.top,bottom:rect.bottom}}:undefined);
  };
  const editor=useEditor({
    extensions,content:props.value,contentType:'markdown',
    editorProps:{attributes:{class:'note-rich-content',role:'textbox','aria-label':'笔记正文','aria-multiline':'true','data-placeholder':'写下想法，输入 @ 指派 Note Bot…'},
      handleKeyDown:(_view,event)=>latest.current.onKey(event),
      handlePaste:(_view,event)=>{if([...event.clipboardData?.files??[]].some(file=>file.type.startsWith('image/')))return true;return false;},
      handleDOMEvents:{compositionend:()=>{requestAnimationFrame(()=>{if(editor&&!editor.isDestroyed)report(editor);});return false;}},
    },
    onUpdate:({editor})=>{last.current=editor.getMarkdown();latest.current.onChange(last.current);report(editor);},
    onSelectionUpdate:({editor})=>report(editor),
    immediatelyRender:true,
  });
  useEffect(()=>{if(editor&&props.value!==last.current){last.current=props.value;editor.commands.setContent(props.value,{contentType:'markdown',emitUpdate:false});}},[editor,props.value]);
  useEffect(()=>{if(block&&editor?.state.doc.nodeAt(block.pos)!==block.node)closeBlock();},[props.value]);
  useImperativeHandle(ref,()=>({
    capture:atEnd=>editor?capture(editor,atEnd):undefined,
    replace(selection,markdown,insert){if(!editor)return;const at=insert?selection.to:selection.from;editor.chain().focus().insertContentAt({from:at,to:insert?at:selection.to},markdown,{contentType:'markdown'}).run();},
    removeMention(mention){if(!editor)throw Error('编辑器尚未就绪');editor.chain().focus().deleteRange({from:mention.from,to:mention.to}).run();return capture(editor);},
    format(kind){if(!editor)return;const chain=editor.chain().focus();if(kind==='bold')chain.toggleBold().run();else if(kind==='italic')chain.toggleItalic().run();else if(kind==='underline')chain.toggleUnderline().run();else if(kind==='strike')chain.toggleStrike().run();else if(kind==='code')chain.toggleCode().run();else if(kind==='paragraph')chain.setParagraph().run();else if(kind.startsWith('heading'))chain.toggleHeading({level:kind==='heading1'?1:kind==='heading3'?3:2}).run();else if(kind==='list')chain.toggleBulletList().run();else if(kind==='ordered')chain.toggleOrderedList().run();else if(kind==='quote')chain.toggleBlockquote().run();else chain.toggleTaskList().run();},
    highlight(selection){if(!editor)return;const valid=selection?.mode==='visual'&&selection.from>=0&&selection.to<=editor.state.doc.content.size?selection:null;editor.view.dispatch(editor.state.tr.setMeta(contextKey,valid));},
    heading(index){if(!editor)return;let count=0;editor.state.doc.descendants((node,pos)=>{if(node.type.name==='heading'&&count++===index)editor.chain().focus().setTextSelection(pos+1).scrollIntoView().run();});},
    focus(){editor?.commands.focus();},
  }),[editor]);
  const act=(action:'request'|'up'|'down'|'duplicate'|'delete')=>{
    if(!block||!editor)return;const {pos,node}=block;if(editor.state.doc.nodeAt(pos)!==node){closeBlock();return;}const end=pos+node.nodeSize;
    closeBlock();
    if(action==='request'){editor.chain().focus().setTextSelection({from:pos+1,to:Math.max(pos+1,end-1)}).run();latest.current.onRequest?.(capture(editor));return;}
    const tr=editor.state.tr;
    if(action==='duplicate')tr.insert(end,node);
    else if(action==='delete')tr.delete(pos,end);
    else if(action==='up'){const previous=editor.state.doc.resolve(pos).nodeBefore;if(!previous)return;tr.delete(pos,end).insert(pos-previous.nodeSize,node);}
    else{const next=editor.state.doc.nodeAt(end);if(!next)return;tr.delete(pos,end).insert(pos+next.nodeSize,node);}
    editor.view.dispatch(tr.scrollIntoView());editor.commands.focus();
  };
  return <><EditorContent editor={editor} className="note-rich-editor"/>{block&&<LibraryMenu anchor={block.anchor} label="块操作" onClose={closeBlock}>
    <button type="button" role="menuitem" disabled={!block.node.textContent.trim()} onClick={()=>act('request')}><ScanText size={15}/>提出修改要求</button>
    <button type="button" role="menuitem" disabled={block.pos===0} onClick={()=>act('up')}><ArrowUp size={15}/>上移</button>
    <button type="button" role="menuitem" disabled={block.pos+block.node.nodeSize===editor?.state.doc.content.size} onClick={()=>act('down')}><ArrowDown size={15}/>下移</button>
    <button type="button" role="menuitem" onClick={()=>act('duplicate')}><Copy size={15}/>创建副本</button>
    <button type="button" role="menuitem" className="library-menu-danger" onClick={()=>act('delete')}><Trash2 size={15}/>删除块</button>
  </LibraryMenu>}</>;
});
