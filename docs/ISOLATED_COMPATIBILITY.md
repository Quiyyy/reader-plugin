# 隔离书源候选（0.1.7，尚未正式升级）

基于 `04736393fc5b7d2f0b9d52f4774be508a159a470`，保留其书源管理 UI、声明式规则增强和依赖清理。正式 0.1.6 / `2faa0b8` 的安装、用户书库和市场发布均不由本次开发修改。

## 固定基准与结果含义

基准是用户指定的 XIU2/Yuedu `426b24f59aa763ee0f2d9cc094612d2ef42c8293/shuyuan`，22 源；SHA-256 `00644eda44f0fcabcfc015a024480376638d5e7a381a2010aeedfca5aa797845`。集合保存在仓库外，不发布完整第三方规则。`npm run build` 后运行：

```
node scripts/audit-source-capabilities.mjs /path/to/user-provided/shuyuan.json
```

前一候选 7 源可进入搜索、5 源四阶段规则可尝试；隔离引擎候选 `1f1f799` 为 18 / 12，继续核查真实响应后的本候选为 **18 / 14**。这仅代表入口和所消费的规则结构可以尝试，不是在线可读率；源脚本的具体宿主调用、跨域、页面变化、登录/挑战和预算仍会在运行阶段失败。真实正文全链路仍未通过，整体补全及统一升级尚未完成。逐阶段证据见 [真实来源核验](LIVE_SOURCE_ACCEPTANCE.md)。

| 来源 | 搜索入口 | 四阶段结构 | 剩余主要边界 |
|---|---|---|---|
| 起点中文 | 可尝试 | 未完整 | 正则列表/捕获规则、VIP 标记；公开搜索实测 HTTP 202 |
| 番茄小说2 | 阻止 | 未完整 | 递归 JSONPath、动态 eval、专用宿主/登录代码、多域/API |
| 酷我小说 | 可尝试 | 可尝试 | 匿名搜索 HTTP 200、业务码 200、原始 data=[]；原生 JSON 与选择器结果一致；未证明详情正文可读 |
| 69书吧.com | 无效 | 未完整 | 固定集合内 searchUrl 的 JS 不是有效 ES2022；需要浏览器时停止 |
| 69书吧 | 可尝试 | 可尝试 | GBK、数值限速、倒序切片与正文标题模板已实现；固定源被跨域跳转拦截，仅加已观察 www.69shuba.com 的临时副本仍超时 |
| 速读谷、得奇小说网、独步小说网 | 可尝试 | 可尝试 | 分别为连接重置、搜索 HTTP 404、HTTP 200 提示信息页；未证明可读 |
| 快书网 | 可尝试 | 可尝试 | 限速不再阻止；匿名搜索连接失败 |
| 天天看小说 | 可尝试 | 可尝试 | 匿名搜索 HTTP 403；未绕过访问限制 |
| 手机小说 | 阻止 | 未完整 | 源内敏感 Cookie；不使用集合携带的身份信息 |
| 铅笔小说 | 可尝试 | 可尝试 | 未使用 loginUrl 不再阻止；公开搜索实测超时 |
| 来看文学 | 阻止 | 未完整 | 动态 eval、Cookie/验证码、XPath 轴 |
| 大文学无错小说网、思路客 | 可尝试 | 可尝试 | 所用 XPath last/following-sibling 已由原创夹具验证；mobile 域仍须明确策略，条件浏览器仍会停止；未联网验证 |
| 和图书 | 可尝试 | 未完整 | 卷标记、元素对象 API、HTTP get/cookie/token、条件浏览器 |
| 顶点小说 ddxs、八一中文 | 可尝试 | 可尝试 | 固定源的 mobile 域需明确策略；临时副本仅加规则声明的精确 mobile origin 后分别超时、HTTP 403 |
| 艾途小说 | 可尝试 | 未完整 | 正文对下载数据使用 eval；未把未知代码当 JSON 执行 |
| 阅友小说、就爱文学 | 可尝试 | 可尝试 | 搜索、详情与目录有真实响应证据（含离线重放修复），正文未验；已修复隐含 tbody、内嵌位图属性及目录工作量误计 |
| 武林中文网 | 可尝试 | 未完整 | 正文/章节 URL 要求真实 WebView，不能用 fetch 冒充 |

2026-10-03 首轮为 6 个第三方源、7 次搜索尝试；续查增加可响应页面的结构诊断、少量公版书名检索及两源详情/目录元数据验证。第三方正文请求仍为 0：已响应搜索暂未找到可确认的公版原著，不能将衍生作品按公版验收，也不能据此断言整个网站不可读。全文链路仅在原创 fixture 中通过；两源元数据通过不替代正文、进度和真实进程重启验收。

`partial` 也可表示忽略的展示字段或必须在运行时判断的 JS，不等于该阶段一定能完成。联网返回空列表只能证明搜索请求/列表提取完成，不证明逐条字段或后续阶段。

## 新增实现及可复验范围

- UTF-8、GBK、GB2312、GB18030 参数字节编码；表单中的原有 `%XX` 不重复编码，不可表示字符明确失败。请求编码和已有响应解码分别处理。
- 正毫秒数及 `a/b` 次数/毫秒限速，使用更保守的滚动窗口；请求、脚本 ajax、重定向及连接重试共用按源限速。超出等待期限会失败，不忽略限速。
- 有界静态 Accept、Accept-Language、User-Agent、Referer、Content-Type、X-Requested-With、Connection: close；拒绝 Cookie、Authorization、Host、代理头和任意身份头。
- `@js:` / `<js>…</js>` 规则链；字段/URL 模板，`result/baseUrl/key/page/book/chapter`，详情 `init`，受限 DOM/JSON 提取、组合与回退、倒序切片，RE2 有限重复/捕获替换。
- `java.get/put` 是变量接口，`getString/getStringList/getElement` 提取、`setContent`、URI/base64/hex 编码、无副作用日志，以及同步语义的受控 `java.ajax`。`getElement` 当前返回 HTML 字符串数组，不支持完整 Jsoup 元素方法；`java.get(url, headers)`、post 响应对象、cookie/header/token 等尚未实现。
- 变量按来源修订、书 URL、章 URL 分隔；搜索行和目录行独立，书变量不会被最后一章覆盖。只在阶段成功后保存。每作用域 32 KiB/128 项、每源 1 MiB/5000 作用域；不把内部变量塞入可由 UI 伪造的结果对象。

原创测试覆盖请求的实际字节、完整两页目录/两页正文、书签、非零进度、独立 Node 进程退出后离线缓存重开，以及跨源变量隔离。`examples/online/reader-script-cdn.json` 指向仓库已有公开原创页面；CDN 的已观察重定向目标仅在该样例的 `readerAllowedOrigins` 中明确列出。生产 HTTP 联网结果由 `scripts/probe-original-script.mjs` 单独记录，不与注入 transport 的 fixture 混计。

## 隔离与边界

引擎依赖均固定注册表版本/完整性：QuickJS Emscripten 0.32.0、iconv-lite 0.7.3、Acorn 8.15.0（MIT）。Node 只执行项目自己的宿主代码；第三方源程序在 Worker 内的 QuickJS WebAssembly 中编译运行，没有 `node:vm` 或 Node `eval`。

每个操作一个 Worker、全局最多 4 个并行 Worker，来宾无文件、process/env、require、fetch、模块加载或 WebAssembly 接口。来宾 eval、Function 及普通/生成器/异步函数构造链被不可逆封闭，静态检查也拒绝动态编译/下载代码。新 VM 对每段求值创建，跨段只通过明确变量存取传递数据，不承诺共享任意 JS 全局对象。

限制：32 Ki 字符脚本、16 MiB QuickJS 软堆、**32 MiB WASM 硬内存**、512 KiB 栈；500 ms 中断预算、2 s 脚本 Worker 强制终止、每阶段 500 段/约 5 s 累计脚本墙钟、60 s 阶段上限。受信任模块/WASM 冷启动单独限制 10 s，收到 ready 后才发送第三方代码和开始执行计时；取消在初始化期间也生效。2 MiB 脚本输出，单阶段最多 20 次实际连接/8 MiB 响应。HTTP 每次仍为 10 s/2 MiB、最多 3 次重定向；DNS 全地址检查、固定 IP、TLS 验证和取消保持。

当前上游 [#271](https://github.com/justjake/quickjs-emscripten/issues/271) 报告大块分配未累计到软堆限制，因此额外注入有限最大值的 WebAssembly.Memory，测试反复分配小于软上限的块也必须被硬上限拒绝。[#261](https://github.com/justjake/quickjs-emscripten/issues/261) 是 async runtime 销毁顺序问题，因此使用 module.newContext 管理 runtime 生命周期。测试覆盖多次 ajax/销毁、OOM、死循环、灾难正则、恶意 toJSON、输出超限、取消，以及失败后新操作仍正常。

默认仍只允许源 origin。可选 `readerAllowedOrigins` 是最多 8 个完整 origin 的**显式数据**，导入预览显示域集合并默认停用；不推断任意子域、不开放通配域、不接受 HTTPS 降级。敏感头无论域策略如何都拒绝。首轮生产测试没有 DNS/transport 注入、环境代理或关闭 TLS。

续查诊断使用只观察请求/响应摘要的 transport 包装，实际仍调用原生 HTTP(S) 并原样传递固定 DNS lookup、TLS、取消及请求选项；没有修改地址或 TLS 策略。报告明确标记 observerOnlyTransportHook。真实响应离线重放单独标记，不算新增联网通过。

## 浏览器与授权阻碍

`java.startBrowserAwait`、webView 与验证码接口目前提供统一的明确停止路径，连脚本 catch 也不能把它伪装成成功。未触发的条件浏览器声明不阻止先走公开 HTTP；实际遇到 HTTP 拒绝、已知挑战页、登录跳转则停止。

可维护的真实浏览器实现还需要由宿主提供独立会话及所有顶层/子资源/重定向/WebSocket 的同等网络约束，并有可见的登录、持久 Cookie、账户作用域和会话清除授权。当前插件没有这些宿主接口/权限，不能把普通 CUA 浏览器或任意第三方动态脚本接到服务中替代。本次没有下载浏览器登录资料、申请账户或要求 Apple 会员；Mac 正式版继续使用现有 Node 路径，自包含 Mac 发布策略未启用。

参考 [QuickJS](https://bellard.org/quickjs/)、[绑定项目](https://github.com/justjake/quickjs-emscripten)、[LegadoTeam/legado](https://github.com/LegadoTeam/legado) 只核对格式和行为。本实现独立编写，未复制 GPL 代码，项目许可未更改。旧 gedoor 仓库不作为活跃官方实现的依据。
