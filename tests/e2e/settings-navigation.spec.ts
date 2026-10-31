import {test,expect} from '@playwright/test';
import {openSettings} from './navigation';

test('setting search focuses a specific field and reveals management without reading a secret',async({page})=>{
  let keyReads=0;
  const state={phase:'ready',configured:true,connected:true,email:'fixture@example.invalid',enabled:true,vaultId:'0f7c2020-4391-4479-b1c4-a0f797f33f25',vaultName:'原创书库',deviceName:'学习电脑',options:{books:true,preferences:false},network:{mode:'proxy',url:'http://127.0.0.1:7897'},pending:0,conflicts:[],downloadedBooks:0,cloudBooks:0,lastSyncedAt:new Date().toISOString()};
  await page.route('**/api/tool',async route=>{const request=route.request().postDataJSON();if(!request.name.startsWith('reader_sync_'))return route.continue();if(request.name==='reader_sync_recovery_key')keyReads++;await route.fulfill({json:{content:[],_meta:{reader:state}}});});
  await page.goto('/');const settings=await openSettings(page,'同步');
  for(const width of [1280,800,390,320]){await page.setViewportSize({width,height:850});await expect(settings.getByLabel('代理地址')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);await page.screenshot({path:`artifacts/settings-compact-sync-${width}.png`});}
  const search=settings.getByLabel('搜索设置');await search.fill('代理地址');await settings.locator('.settings-results').getByRole('button',{name:/^代理地址/}).click();await expect(settings.getByLabel('代理地址')).toBeFocused();await expect(settings.getByLabel('代理地址')).toBeInViewport();
  await search.fill('恢复密钥');await settings.locator('.settings-results').getByRole('button',{name:/^恢复密钥/}).click();await expect(settings.locator('[data-settings-disclosure="sync-management"]')).toHaveAttribute('open','');await expect(settings.getByRole('button',{name:'恢复密钥',exact:true})).toBeFocused();expect(keyReads).toBe(0);await expect(settings.getByLabel('生成的恢复密钥')).toHaveCount(0);
  await search.fill('笔记 字号');await settings.locator('.settings-results').getByRole('button',{name:/^笔记字号/}).click();await expect(settings.getByLabel('笔记默认字号')).toBeFocused();
  await search.fill('Bot 指令');await settings.locator('.settings-results').getByRole('button',{name:/^Bot 指令/}).click();await expect(settings.getByLabel('Bot 指令')).toBeFocused();await expect(settings.getByLabel('Bot 指令')).toBeInViewport();
  const nav=settings.getByRole('navigation',{name:'设置分类'});
  for(const width of [1280,320]){
    await page.setViewportSize({width,height:850});
    for(const [label,name]of [['外观','appearance'],['阅读','reading'],['快捷键','keyboard'],['数据与关于','data']] as const){await nav.getByRole('button',{name:label,exact:true}).click();await expect(settings.getByRole('heading',{name:label,exact:true})).toBeVisible();await page.screenshot({path:`artifacts/settings-polished-${name}-${width}.png`});}
    await nav.getByRole('button',{name:'外观',exact:true}).click();await settings.getByRole('button',{name:'深色',exact:true}).click();await expect(page.locator('.study-workspace')).toHaveClass(/dark/);await page.screenshot({path:`artifacts/settings-polished-dark-${width}.png`});await settings.getByRole('button',{name:'浅色',exact:true}).click();await expect(page.locator('.study-workspace')).toHaveClass(/light/);
  }
});

test('compact Bot forms retain edits across category changes and become clean after saving',async({page})=>{
  await page.setViewportSize({width:390,height:750});await page.goto('/');const settings=await openSettings(page,'Note Bots'),nav=settings.getByRole('navigation',{name:'设置分类'}),save=settings.getByRole('button',{name:'保存 Bot',exact:true});
  await expect(save).toBeDisabled();await settings.getByRole('button',{name:'新建 Bot',exact:true}).click();await settings.getByLabel('Bot 名称').fill('精简配置验收');await settings.getByLabel('Bot 指令').fill('整理原创学习记录，保留作者的表达。');await expect(save).toBeEnabled();
  await nav.getByRole('button',{name:'外观',exact:true}).click();await nav.getByRole('button',{name:'Note Bots',exact:true}).click();await expect(settings.getByLabel('Bot 名称')).toHaveValue('精简配置验收');await expect(settings.getByLabel('Bot 指令')).toHaveValue('整理原创学习记录，保留作者的表达。');await save.click();await expect(settings.locator('.note-bot-save-status')).toContainText('已保存');await expect(save).toBeDisabled();
});
