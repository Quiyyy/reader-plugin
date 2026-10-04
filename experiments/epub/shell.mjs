const paths = {
  back:'M19 12H5m6-6-6 6 6 6', list:'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  appearance:'M4 19 10 5l6 14M6 14h8M17 8h5m-2.5 0v11', bookmark:'M6 3h12v18l-6-4-6 4V3',
  more:'M5 12h.01M12 12h.01M19 12h.01', close:'m6 6 12 12M6 18 18 6', minus:'M5 12h14', plus:'M5 12h14M12 5v14',
  left:'m15 5-7 7 7 7', right:'m9 5 7 7-7 7',
};
export const icon = (name, label, id, extra='') => `<button class="icon" type="button" id="${id}" title="${label}" aria-label="${label}" ${extra}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name]}"/></svg></button>`;
export const shell = `<main class="reader">
<header class="toolbar">${icon('back','返回书架','shelf','disabled')}<span class="book-title">山河小记</span>${icon('list','目录','toc-toggle','aria-expanded="false" aria-controls="toc"')}${icon('appearance','阅读外观','appearance-toggle','aria-expanded="false" aria-controls="appearance"')}${icon('bookmark','收藏当前位置','bookmark')}${icon('more','更多','menu-toggle','aria-expanded="false" aria-controls="menu"')}</header>
<section class="stage"><div id="canvas" class="canvas" aria-label="正文" tabindex="0"></div>
<aside id="toc" class="drawer" aria-label="目录" hidden><div class="panel-heading"><strong>目录</strong>${icon('close','关闭目录','toc-close')}</div><ul class="toc"><li><button class="current" data-anchor="river">第一章　沿着河流走</button><ul><li><button data-anchor="bridge">一、桥边</button></li><li><button data-anchor="ferry">二、渡口</button></li></ul></li></ul></aside>
<aside id="appearance" class="popover" aria-label="阅读外观" hidden><div class="panel-heading"><strong>阅读外观</strong>${icon('close','关闭外观','appearance-close')}</div><p class="mode-label">样式</p><div class="segmented"><button data-style="original" aria-pressed="true">原书</button><button data-style="comfort" aria-pressed="false">舒适</button></div><div class="row"><span>字号</span><div class="stepper">${icon('minus','缩小字号','smaller')}<output id="size">20</output>${icon('plus','放大字号','larger')}</div></div><div class="row"><span>阅读</span><div class="segmented"><button data-flow="scrolled" aria-pressed="true">滚动</button><button data-flow="paginated" aria-pressed="false">翻页</button></div></div></aside>
<aside id="menu" class="popover" aria-label="更多" hidden><div class="panel-heading"><strong>更多</strong>${icon('close','关闭菜单','menu-close')}</div><button id="go-bookmark" class="menu-item">回到书签</button><button id="reload" class="menu-item">重新打开样章</button><button id="diagnostics-toggle" class="menu-item">兼容检查</button><pre id="diagnostics" class="diagnostics" hidden></pre><button id="copy" class="menu-item">复制检查结果</button></aside>
<button id="return" class="return" hidden>返回正文</button><div id="notice" class="notice"><p id="message">正在打开…</p><button id="notice-details" hidden>查看兼容检查</button></div></section>
<footer class="footer"><span id="chapter">第一章 · 沿着河流走</span><span id="position">0%</span></footer>
</main><dialog id="image-dialog" aria-label="插图">${icon('close','关闭插图','image-close')}<img id="large-image" alt="山间河流的示意插画"/></dialog>`;
