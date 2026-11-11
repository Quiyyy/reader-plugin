import {test,expect} from '@playwright/test';

test('hidden tab bars release their space, remain navigable and survive reload',async({page})=>{
  await page.goto('/');await expect(page.getByRole('tab',{name:'书库',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'打开页面',exact:true}).click();await page.getByRole('menuitem',{name:'笔记',exact:true}).click();
  await page.getByRole('button',{name:'分栏操作',exact:true}).click();await page.getByRole('menuitem',{name:'移到右侧分栏',exact:true}).click();
  const before=await page.locator('[data-visible=true]').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().y));
  await page.getByRole('button',{name:'分栏操作',exact:true}).last().click();await page.getByRole('menuitem',{name:'隐藏标签栏',exact:true}).click();
  await expect(page.getByRole('tablist')).toHaveCount(0);await expect(page.getByRole('button',{name:'页面菜单',exact:true})).toHaveCount(2);
  const after=await page.locator('[data-visible=true]').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().y));expect(after).toEqual(before.map(y=>y-36));
  await page.getByRole('button',{name:'页面菜单',exact:true}).first().click();await page.getByRole('menuitem',{name:'打开页面…',exact:true}).click();await page.getByRole('menuitem',{name:'搜索',exact:true}).click();
  await expect(page.getByRole('main',{name:'书库搜索'})).toBeVisible();await page.getByRole('button',{name:'页面菜单',exact:true}).first().click();await page.getByRole('menuitemradio',{name:'书库',exact:true}).click();await expect(page.getByRole('heading',{name:'书库',exact:true})).toBeVisible();
  await page.reload();await expect(page.getByRole('tablist')).toHaveCount(0);await expect(page.getByRole('button',{name:'页面菜单',exact:true})).toHaveCount(2);
  await page.screenshot({path:'artifacts/hidden-tabs-split.png'});
  await page.getByRole('button',{name:'页面菜单',exact:true}).first().click();await page.getByRole('menuitem',{name:'显示标签栏',exact:true}).click();await expect(page.getByRole('tablist')).toHaveCount(2);
});
