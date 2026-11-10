import {describe,expect,it} from 'vitest';
import {activateTab,closeTab,groups,initialLayout,layoutRects,minimumSize,moveTab,openTab,restoreLayout,serializeLayout,type TabLayout} from '../src/ui/workspace-tabs';

const note=(id=crypto.randomUUID())=>({target:{kind:'note' as const,noteId:id},title:'笔记'});
function invariant(layout:TabLayout){
  const panes=groups(layout.root),ids=panes.flatMap(g=>g.tabs);
  expect(ids.length).toBe(new Set(ids).size);expect(new Set(ids)).toEqual(new Set(layout.tabs.map(t=>t.id)));
  expect(panes.every(g=>g.tabs.includes(g.active))).toBe(true);expect(panes.some(g=>g.id===layout.focused)).toBe(true);
}
describe('workspace tab layout',()=>{
  it('opens distinct documents without replacing the original and reuses existing tabs',()=>{
    const start=initialLayout(),page=note(),opened=openTab(start,page);
    expect(opened.tabs).toHaveLength(2);expect(groups(opened.root)[0]!.tabs[0]).toBe(start.tabs[0]!.id);
    const focused=openTab(activateTab(opened,start.tabs[0]!.id),page);expect(focused.tabs).toHaveLength(2);expect(groups(focused.root)[0]!.active).toBe(opened.tabs[1]!.id);
  });
  it('supports nested four-edge splits, moves and automatic empty-pane removal',()=>{
    let value=initialLayout();for(let i=0;i<4;i++)value=openTab(value,note());
    const original=groups(value.root)[0]!.id;
    for(const [i,edge] of (['right','bottom','left','top'] as const).entries()){value=moveTab(value,value.tabs[i+1]!.id,original,edge);invariant(value);}
    expect(groups(value.root)).toHaveLength(5);
    for(const tab of value.tabs.slice(1)){value=moveTab(value,tab.id,original);invariant(value);}
    expect(groups(value.root)).toHaveLength(1);
    value=moveTab(value,value.tabs[4]!.id,original,'center',value.tabs[0]!.id);expect(groups(value.root)[0]!.tabs[0]).toBe(value.tabs[4]!.id);
  });
  it('preserves layout invariants over repeated moves and closes',()=>{
    let value=initialLayout();for(let i=0;i<12;i++)value=openTab(value,note());
    for(let i=0;i<80;i++){const all=groups(value.root),tab=value.tabs[(i*7)%value.tabs.length]!;value=moveTab(value,tab.id,all[(i*3)%all.length]!.id,(['center','left','right','top','bottom'] as const)[i%5]);invariant(value);}
    for(const tab of [...value.tabs]){value=closeTab(value,tab.id);invariant(value);}expect(value.tabs).toHaveLength(1);expect(value.tabs[0]!.target.kind).toBe('library');
  });
  it('never splits a sole tab into an empty sibling',()=>{const start=initialLayout();expect(moveTab(start,start.tabs[0]!.id,start.focused,'right')).toBe(start);});
  it('restores identifiers and geometry without persisting book bytes or passwords',()=>{
    let value=openTab(initialLayout(),{target:{kind:'book',bookId:'book-1'},title:'原书',password:'secret',book:{document:{chapters:['private body']}} as any});
    value=moveTab(value,value.tabs[1]!.id,value.focused,'right');const saved=serializeLayout(value);expect(saved).not.toContain('secret');expect(saved).not.toContain('private body');
    const restored=restoreLayout(saved)!;invariant(restored);expect(restored.root).toEqual(value.root);
    const bad=JSON.parse(saved);bad.root.first.tabs=[bad.root.second.tabs[0]];expect(restoreLayout(JSON.stringify(bad))).toBeUndefined();
    expect(restoreLayout('{broken')).toBeUndefined();
  });
  it('allocates minimum pane sizes and keeps separators inside the canvas',()=>{
    let value=openTab(initialLayout(),note());value=moveTab(value,value.tabs[1]!.id,value.focused,'right');value=openTab(value,note());value=moveTab(value,value.tabs[2]!.id,value.focused,'bottom');
    const min=minimumSize(value.root),rects=layoutRects(value.root,min.width,min.height);
    for(const {rect} of rects.panes){expect(rect.width).toBeGreaterThanOrEqual(259);expect(rect.height).toBeGreaterThanOrEqual(199);expect(rect.x+rect.width).toBeLessThanOrEqual(min.width);expect(rect.y+rect.height).toBeLessThanOrEqual(min.height);}
  });
});
