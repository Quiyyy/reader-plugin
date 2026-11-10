import type { Page,FrameLocator } from '@playwright/test';
export async function openDiscovery(page:Page|FrameLocator){
  await page.locator('.reader-tabs-workspace, .reader-app').first().waitFor();
  const tab=page.getByRole('tab',{name:'在线找书',exact:true});
  if(await tab.count()){await tab.click();await page.getByRole('main',{name:'找书与书源'}).waitFor();await page.getByRole('button',{name:'找书',exact:true}).click();return;}
  const search=page.getByRole('button',{name:'找书',exact:true});
  if(await search.count()&&await search.first().isVisible()){await search.first().click();return;}
  await page.getByRole('button',{name:'添加选项',exact:true}).click();await page.getByRole('button',{name:'在线找书',exact:true}).click();
}
