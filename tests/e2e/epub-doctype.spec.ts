import { test, expect } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';

test('standard NCX and XHTML doctypes import and open both chapters without external requests', async ({ page }) => {
  const external: string[] = [];
  page.on('request', request => {
    if (!request.url().startsWith('http://127.0.0.1:4178') && !request.url().startsWith('data:')) external.push(request.url());
  });
  const files = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>',
    'book.opf': '<package><metadata><title>原创目录兼容测试</title></metadata><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/></manifest><spine toc="ncx"><itemref idref="one"/><itemref idref="two"/></spine></package>',
    'toc.ncx': '<?xml version="1.0"?>\n<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN"\n "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd"><ncx><navMap><navPoint><navLabel><text>河岸</text></navLabel><content src="one.xhtml"/><navPoint><navLabel><text>灯火</text></navLabel><content src="two.xhtml#light"/></navPoint></navPoint></navMap></ncx>',
    'one.xhtml': '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd"><html><body><p>旅人沿着河岸慢慢走来。</p></body></html>',
    'two.xhtml': '<!DOCTYPE html><html><body><p id="light">远处亮起了一盏灯。</p></body></html>',
  };
  const buffer = Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)]))));
  await page.goto('/');
  const finished = page.waitForResponse(response => response.url().endsWith('/api/tool') && response.request().postDataJSON()?.name === 'reader_import_finish');
  await page.getByLabel('选择 TXT 或 EPUB 书籍').setInputFiles({ name: '原创目录兼容测试.epub', mimeType: 'application/epub+zip', buffer });
  const response = await finished;
  expect(response.ok()).toBe(true);
  expect((await response.json())._meta.reader.summary.chapterCount).toBe(2);
  await expect(page.locator('.reading-title')).toHaveText('原创目录兼容测试');
  await expect(page.locator('.chapter-heading h1')).toHaveText('河岸');
  await expect(page.locator('.reading-paragraphs')).toContainText('旅人沿着河岸慢慢走来。');
  await page.getByRole('button', { name: '目录（T）', exact: true }).click();
  await expect(page.locator('.chapter-item')).toHaveCount(2);
  await page.locator('.chapter-item').nth(1).click();
  await expect(page.locator('.chapter-heading h1')).toHaveText('灯火');
  await expect(page.locator('.reading-paragraphs')).toContainText('远处亮起了一盏灯。');
  await page.getByRole('button', { name: '返回书架', exact: true }).click();
  await expect(page.getByRole('heading', { name: '书架', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /^打开 原创目录兼容测试，/ }).click();
  await expect(page.locator('.chapter-heading h1')).toHaveText('灯火');
  expect(external).toEqual([]);
});
