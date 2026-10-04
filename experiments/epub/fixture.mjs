// Original sample prose and markup; safe to redistribute with the probe.
export const body = `<article lang="zh-CN">
  <p class="chapter-label">山河小记 · 第一章</p>
  <h1 id="river">沿着河流走</h1>
  <p class="lead">雨停的时候，山色一点一点清晰起来。我们收起地图，顺着河岸向东走。</p>
  <p>石桥就在村口。桥下的水流很缓，水面映着两岸的树影。老人说，这条小路绕过山脚，便能看见渡口。我们在桥边停了一会儿，听风穿过竹林。<a id="note-ref" href="#note" epub:type="noteref" role="doc-noteref">〔1〕</a></p>
  <figure><img id="illustration" src="__IMAGE__" alt="山间河流的示意插画" width="960" height="360"/><figcaption>河流从山谷穿过，在村前拐了一个弯。</figcaption></figure>
  <h2 id="bridge">一、桥边</h2>
  <p>旅行并不总要走得很远。一座桥、一条旧街、一间亮着灯的小店，也足够让人记住一个地方。我们把路上的见闻写在纸上，留出空白，等着下一次再来补全。</p>
  <table><caption>沿途记录</caption><thead><tr><th>地点</th><th>路程</th><th>所见</th></tr></thead><tbody><tr><td>石桥</td><td>起点</td><td>竹林与流水</td></tr><tr><td>渡口</td><td>二里</td><td>旧船与柳树</td></tr></tbody></table>
  <h2 id="ferry">二、渡口</h2>
  ${Array.from({length: 8}, (_, i) => `<p id="walk-${i}">走过田埂，远处的渡口渐渐近了。小船靠在岸边，绳子系在石柱上。我们坐下来歇脚，把地图展开在膝上。天空很亮，水面也很亮，四周的声音都慢了下来。</p>`).join('')}
  <aside id="note" epub:type="footnote" role="doc-footnote"><p>〔1〕这里的“小路”指沿河的步道。<a href="#note-ref">返回正文</a></p></aside>
  <p class="font-sample" aria-label="内嵌字体样本">AAA</p>
</article>`;
export const bookCss = `@font-face{font-family:ReaderProbe;src:url('__FONT__') format('truetype')}
html{color:#292c28;background:#fff}body{font-family:'Noto Serif CJK SC','SimSun',serif;font-size:20px;line-height:1.9;margin:0;padding:30px 0 60px}
article{max-width:680px;margin:auto}h1{font-size:1.8em;font-weight:500;line-height:1.4;margin:6px 0 25px}h2{font-size:1.15em;font-weight:500;margin:32px 0 16px}p{margin:0 0 20px;overflow-wrap:break-word}.chapter-label{font:12px/1.5 system-ui;color:#84877b;letter-spacing:2px}.lead{color:#535a4a}figure{margin:24px 0}img{max-width:100%;height:auto;border-radius:3px}figcaption,caption{font:12px/1.8 system-ui;color:#7a8072;margin:8px 0}a{color:#687954;text-decoration:none}table{width:100%;border-collapse:collapse;font-size:.8em;margin:24px 0}th,td{text-align:left;padding:10px;border-bottom:1px solid #e4e6dd}th{font-weight:500;background:#f6f7f2}aside{border-top:1px solid #e4e6dd;padding:18px 0;font-size:.8em}.font-sample{font-family:ReaderProbe,monospace}
`;
export const innerCsp = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline' blob: data:; img-src data: blob:; font-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
export function documentHtml(image, font, canary = false) {
  return `<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><meta charset="utf-8"/><title>山河小记</title><meta http-equiv="Content-Security-Policy" content="${innerCsp}"/><style>${bookCss.replace('__FONT__', font)}</style></head><body>${body.replace('__IMAGE__', image)}${canary ? '<script>globalThis.__readerBookScriptExecuted=true;</script>' : ''}</body></html>`;
}
