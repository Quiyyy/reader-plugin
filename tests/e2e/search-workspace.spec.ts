import {test,expect} from '@playwright/test';
import {openSettings} from './navigation';

test('search filters folders on the server, loads more results and opens a note using the keyboard',async({page,request})=>{
  const rpc=async(name:string,args:Record<string,unknown>={})=>{const response=await request.post('/api/tool',{headers:{'X-Reader-Client':'preview'},data:{name,arguments:args}});const body=await response.json();if(!response.ok()||body.isError)throw Error(JSON.stringify(body));return body._meta.reader;};
  const folder=(await rpc('reader_folder_save',{name:'检索实践',parentId:null})).value;
  const ids:string[]=[];for(let i=0;i<23;i++)ids.push((await rpc('reader_note_create',{title:`检索实践 ${String(i).padStart(2,'0')}`,body:'真实搜索结果正文，记录一段原创学习思路。',folderId:i<22?folder.id:null,tags:[],imageIds:[],sourceIds:[]})).value.id);
  await rpc('reader_library_visit',{kind:'note',id:ids[0]});await page.goto('/');
  await expect(page.locator('.library-entry.note')).not.toHaveCount(0);await page.screenshot({path:'artifacts/library-centered-captions.png'});
  await page.getByRole('button',{name:'搜索书库与笔记',exact:true}).filter({visible:true}).click();await expect(page.getByRole('heading',{name:'最近访问'})).toBeVisible();
  const search=page.getByRole('main',{name:'书库搜索'}),input=search.getByLabel('搜索书籍、批注和笔记');await input.fill('检索实践');await search.getByRole('group',{name:'搜索范围'}).getByRole('button',{name:'笔记',exact:true}).click();await search.getByLabel('搜索文件夹').selectOption(folder.id);
  await expect(search.locator('.study-search-hit')).toHaveCount(20);await search.getByRole('button',{name:'加载更多'}).click();await expect(search.locator('.study-search-hit')).toHaveCount(22);await expect(search.getByRole('button',{name:'加载更多'})).toHaveCount(0);await expect(search.locator('.study-search-hit').first().locator('mark')).toHaveText('检索实践');
  await search.evaluate(element=>{element.scrollTop=0;});await page.screenshot({path:'artifacts/search-workspace-wide.png'});
  for(const width of [390,320]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);await expect(input).toBeVisible();await page.screenshot({path:`artifacts/search-workspace-${width}.png`});}
  await search.getByLabel('搜索文件夹').selectOption('root');await expect(search.locator('.study-search-hit')).toHaveCount(1);await expect(search.locator('.study-search-hit')).toContainText('检索实践 22');
  await input.focus();await input.press('ArrowDown');await expect(search.locator('.study-search-hit')).toBeFocused();await page.keyboard.press('Enter');await expect(page.getByLabel('笔记标题')).toHaveValue('检索实践 22');
});

test('search ignores stale results and exposes recoverable request errors',async({page})=>{
  let release!:()=>void,entered!:()=>void,retries=0;const gate=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>entered=resolve);
  await page.route('**/api/tool',async route=>{const data=route.request().postDataJSON();if(data.name!=='reader_workspace_search')return route.continue();const query=data.arguments.query;if(query==='旧查询'){entered();await gate;}if(query==='错误查询'&&retries++===0)return route.fulfill({json:{isError:true,content:[{type:'text',text:'暂时无法读取搜索索引'}]}});return route.fulfill({json:{content:[],_meta:{reader:[{kind:'note',id:'fixture',title:query,text:'原创检索片段'}]}}});});
  await page.goto('/');await page.getByRole('button',{name:'搜索书库与笔记',exact:true}).filter({visible:true}).click();const input=page.getByLabel('搜索书籍、批注和笔记');
  await input.fill('旧查询');await started;await input.fill('新查询');await expect(page.locator('.study-search-hit')).toContainText('新查询');release();await expect(page.locator('.study-search-hit')).not.toContainText('旧查询');
  await input.fill('错误查询');await expect(page.getByRole('alert')).toContainText('暂时无法读取搜索索引');await page.getByRole('button',{name:'重试',exact:true}).click();await expect(page.locator('.study-search-hit')).toContainText('错误查询');await page.getByRole('button',{name:'清除搜索',exact:true}).click();await expect(input).toHaveValue('');
});

test('proxy settings are explicit, testable and survive reopening at narrow widths',async({page})=>{
  let network:{mode:'direct'|'proxy';url?:string}={mode:'direct'},tested=false;
  await page.route('**/api/tool',async route=>{const data=route.request().postDataJSON();if(!data.name.startsWith('reader_sync_'))return route.continue();if(data.name==='reader_sync_settings')network=data.arguments.network;const status={phase:'unconfigured',configured:false,connected:false,enabled:false,deviceName:'原创电脑',options:{books:true,preferences:false},network,pending:0,conflicts:[],downloadedBooks:0,cloudBooks:0};if(data.name==='reader_sync_network_test'){expect(data.arguments.network).toEqual({mode:'proxy',url:'http://127.0.0.1:7897'});tested=true;}await route.fulfill({json:{content:[],_meta:{reader:data.name==='reader_sync_network_test'?{ok:true,latencyMs:12}:status}}});});
  await page.setViewportSize({width:390,height:900});await page.goto('/');const settings=await openSettings(page,'同步');await settings.getByLabel('连接方式').selectOption('proxy');await settings.getByLabel('代理地址').fill('http://127.0.0.1:7897');await settings.getByRole('button',{name:'测试连接',exact:true}).click();await expect(settings).toContainText('Google Drive 可连接');expect(tested).toBe(true);expect(network.mode).toBe('direct');
  await settings.getByRole('button',{name:'应用',exact:true}).click();await expect(settings.getByRole('button',{name:'应用',exact:true})).toBeDisabled();expect(network).toEqual({mode:'proxy',url:'http://127.0.0.1:7897'});
  await page.setViewportSize({width:320,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);await settings.getByLabel('代理地址').scrollIntoViewIfNeeded();await page.screenshot({path:'artifacts/sync-proxy-320.png'});
  await page.getByRole('button',{name:'返回 Reader',exact:true}).click();await openSettings(page,'同步');await expect(settings.getByLabel('代理地址')).toHaveValue('http://127.0.0.1:7897');
});
