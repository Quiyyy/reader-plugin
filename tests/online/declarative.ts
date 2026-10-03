// Original, minimal grammar fixtures. No third-party source collection or text.
export const declarativeSource = {
  bookSourceName: '原创语法样例', bookSourceUrl: 'https://reader.example.com/grammar', bookSourceType: 0,
  enabledCookieJar: true,
  exploreUrl: '@js:throw new Error("unused explore must never run")',
  ruleExplore: { bookList: '@js:throw new Error("unused explore must never run")' },
  searchUrl: "/grammar/search,{'method':'post','body':'keyword={{key}}&page={{page}}'}",
  ruleSearch: { bookList: '#matches@tbody@tr!0', name: '.title.0@text##《|》', author: '.writer@text##作者：', bookUrl: 'a.0@href', checkKeyWord: 'unused', intro: '@js:throw new Error("unused search summary")' },
  ruleBookInfo: { name: "//meta[@property='reader:title']/@content", author: '[property$=author]@content', intro: '.about@html', tocUrl: 'text.章节入口@href', wordCount: '@js:throw new Error("unused display field")', downloadUrls: '@js:throw new Error("unused downloader")' },
  ruleToc: { chapterList: 'class.contents@children[0]@tag.a', chapterName: 'text', chapterUrl: 'href', nextTocUrl: "@css:#pages .more:not([href='#'])@href" },
  ruleContent: { content: 'id.prose.0@html', nextContentUrl: "//div[@class='pager']/span/a[text()='下一页']/@href", replaceRegex: '##\\n?[（(]本章完[）)]$' },
};
export const declarativePages: Record<string, string> = {
  '/grammar/search': '<table id="matches"><tr><th>测试列表</th></tr><tr><td class="title"><a href="/grammar/book">《原创纸桥》</a></td><td class="writer">作者：样例作者</td></tr></table>',
  '/grammar/book': '<html><head><meta property="reader:title" content="原创纸桥"><meta property="reader:author" content="样例作者"></head><body><div class="about">原创的两章短文。<script>throw Error("never")</script></div><a href="/grammar/toc">章节入口</a></body></html>',
  '/grammar/toc': '<div class="contents"><section><a href="/grammar/one">第一章 纸桥</a></section><footer><a href="/not-a-chapter">忽略页脚</a></footer></div><div id="pages"><a class="more" href="/grammar/toc-2">下页</a></div>',
  '/grammar/toc-2': '<div class="contents"><section><a href="/grammar/two">第二章 灯笼</a></section></div><div id="pages"><a class="more" href="#">末页</a></div>',
  '/grammar/one': '<div id="prose"><p>折好的纸桥横跨浅浅的水洼。</p><p>（本章完）</p><script>window.GRAMMAR_EXECUTED=true</script><img src="http://127.0.0.1/secret" onerror="window.GRAMMAR_EXECUTED=true"></div><div class="pager"><span><a href="/grammar/one-2">下一页</a></span></div>',
  '/grammar/one-2': '<div id="prose"><p>纸桥的另一端留着一片叶子。</p><p>（本章完）</p></div>',
  '/grammar/two': '<div id="prose">灯笼照亮了窗台。<br>孩子收起写满故事的纸。<br>（本章完）</div>',
};
