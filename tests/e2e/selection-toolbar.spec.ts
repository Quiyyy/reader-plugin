import { expect, test, type Locator, type Page } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';
import { pdfFixture } from '../pdf-fixture';

const passage = '选择这段原创文字后，可以高亮，也可以取消选择继续阅读。';
const epub = Buffer.from(zipSync(Object.fromEntries(Object.entries({
  mimetype: 'application/epub+zip',
  'META-INF/container.xml': '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>',
  'book.opf': '<package><metadata><title>选区交互测试</title></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/></spine></package>',
  'one.xhtml': `<html><body><h1>第一章 选区</h1><p id="passage">${passage}</p><p>点击这里，回到阅读。</p></body></html>`,
}).map(([name, value]) => [name, strToU8(value)]))));

async function selectPassage(target: Locator) {
  await target.evaluate(el => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, composed: true }));
  });
}

async function openBook(page: Page, format: 'txt' | 'epub' | 'pdf') {
  await page.goto('/');
  await page.getByLabel('选择 TXT、EPUB 或 PDF 书籍').setInputFiles({
    name: `选区交互测试.${format}`,
    mimeType: format === 'txt' ? 'text/plain' : format === 'epub' ? 'application/epub+zip' : 'application/pdf',
    buffer: format === 'txt' ? Buffer.from(`第一章 选区\n\n${passage}\n\n点击这里，回到阅读。`) : format === 'epub' ? epub : pdfFixture(),
  });
  const target = format === 'txt' ? page.locator('[data-reader-paragraph]').filter({ hasText: passage }).first()
    : format === 'epub' ? page.locator('.epub-document #passage')
    : page.locator('.textLayer span').filter({ hasText: 'Recall a concept' }).first();
  // PDF imports start a real parser worker before the text layer can render.
  // Match the bounded loading allowance used by the other PDF UI scenarios.
  await expect(target).toBeVisible({timeout:format==='pdf'?30000:5000});
  // EPUB content appears before asset/layout restoration and its initial focus.
  if (format === 'epub') await expect(page.locator('.epub-loading')).toHaveCount(0);
  return target;
}

for (const format of ['txt', 'epub', 'pdf'] as const) {
  test(`${format}: selection toolbar follows deselection and preserves actions`, async ({ page }) => {
    const target = await openBook(page, format);
    const toolbar = page.getByRole('toolbar', { name: '选区操作' });
    await selectPassage(target);
    await expect(toolbar).toBeVisible();
    await target.click();
    await expect(toolbar).toHaveCount(0);

    await selectPassage(target);
    await expect(toolbar).toBeVisible();
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await expect(toolbar).toHaveCount(0);

    await selectPassage(target);
    await expect(toolbar).toBeVisible();
    await toolbar.getByRole('button', { name: '批注', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '批注', exact: true })).toContainText(format === 'pdf' ? 'Recall a concept' : passage);
  });

  test(`${format}: reading focus has no outer frame while controls keep focus feedback`, async ({ page }) => {
    await openBook(page, format);
    const reading = page.locator(format === 'txt' ? '.reading-scroll' : format === 'epub' ? '.epub-document' : '.pdf-scroll');
    await page.keyboard.press('Tab');
    await reading.focus();
    await expect(reading).toBeFocused();
    await expect(reading).toHaveCSS('outline-style', 'none');
    const back = page.getByRole('button', { name: '返回书架', exact: true });
    await back.focus();
    await expect(back).toBeFocused();
    await expect(back).toHaveCSS('outline-style', 'none');
    await expect(back).not.toHaveCSS('box-shadow', 'none');
  });
}
