export const fixtureSource = {
  bookSourceName: '原创公开文本测试源', bookSourceUrl: 'https://reader.example.com/', bookSourceType: 0,
  searchUrl: '/search?q={{key}}&page={{page}}',
  ruleSearch: { bookList: '@css:.book', name: 'a@text', author: '.author@text', bookUrl: 'a@href' },
  ruleBookInfo: { name: 'h1@text', author: '.author@text', intro: '.intro@text', tocUrl: 'a.toc@href' },
  ruleToc: { chapterList: '.chapters a', chapterName: '@text', chapterUrl: '@href', nextTocUrl: 'a.next@href' },
  ruleContent: { content: '#content@text', nextContentUrl: 'a.next@href' },
};
