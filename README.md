# Reader

一个安静、私人的小说阅读插件。React + TypeScript 阅读界面，真实 MCP Apps 协议与 OpenAI MCP Extensions 接入，书籍和进度由 Reader 服务持久保存。

**Reader 0.1.10：目录第一页完成即可开读，邻章缓存加快切换。** 已知章节可读，剩余目录按需加载并持久保存续点；最多保留当前及相邻章节的有限内存正文，空闲时预取下一章，切章不等待进度写盘。详见 [0.1.10 说明](docs/RELEASE_0.1.10.md)。

本次按维护者明确授权，完成针对验证后手动发布，跳过远端 CI；平台分发仍使用 `reader-dist/<平台>`，以版本、来源提交和文件摘要为准。Windows/Linux 平台包自带官方 Node，见 [marketplace 指南](docs/MARKETPLACE.md)。本版保留有界规则、隔离 QuickJS 和 SafeHTTP 网络边界。

Mac 沿用 Node 支持的安装路线，签名/公证及自包含包限制不变。本次只升级已授权的 Mac；Windows 设备未升级。真实 ChatGPT 侧栏关闭仍遵循公开宿主能力，见 [宿主验收边界](docs/HOST_ROUTING.md)。

## 已实现

- TXT / 无 DRM EPUB 导入、重复文件去重、书架搜索、卡片/列表与可恢复回收站
- 中文/英文章节识别、EPUB spine 和导航目录、全文搜索
- 中文硬换行适度合并，保留空行、缩进、章头、短诗行和对话边界；支持跨原始换行搜索
- 段落级阅读位置、跨进程持久化、书签、字体/字号/行距/宽度/主题
- 响应式中文界面，浅色/深色宿主主题与纸色阅读模式
- 真实 global、thread、file MCP UI 入口声明
- 宿主文件入口通过官方资源 API 读取文件，不把资源 URI 当作系统路径
- 书籍内容走 app-only 操作，不调用 LLM，也不主动写入对话上下文

### 清楚的边界

EPUB 当前是**小说正文模式**：保留原文与段落，以每个可读 spine 资源作为一章；不显示图片、音视频、自定义字体和原书分页/复杂版式，目录里的同一文件内锚点会合并到该章节。适合文字小说，不适合漫画或图文教材。

MOBI/AZW3、CBZ/漫画、原版 EPUB 排版、CFI、跨设备云同步、永久删除/重解码尚未实现。不会移除 DRM。改变已导入 TXT 的编码会明确报错并保留原数据；首次导入前可选 UTF-8、GB18030/GBK、Big5、UTF-16LE/BE。自动检测可能有误。

## 免编译安装

下载 `reader-0.1.3-runtime.zip` 并核对配套 SHA-256，解压后运行 `node setup.mjs`。setup 将完整运行内容安装到稳定程序目录，书库另存；再用官方客户端显式注册输出的本地 marketplace 并安装 Reader。保留原有书库时，首次 setup 传入 `--data-dir "旧书库绝对路径"`。完整路径、重复执行、回退及宿主边界见 [安装指南](docs/INSTALL.md)。源码 ZIP 不包含运行依赖。

## 开发与本地预览

推荐 Node.js 24 LTS 和 npm；支持范围为 Node 22.12+（22 系列）、24 或 26+，不支持 Node 25。依赖锁定在 package-lock.json。

```sh
npm ci
npm run check
npm run validate:plugin
npm run preview
```

打开 http://127.0.0.1:4173。这是开发预览，不会安装插件，不会公开部署。只监听 IPv4 loopback；Host、Origin、Content-Type 和客户端标识校验阻止跨站调用。不要把这个无认证服务代理到公网。

```sh
# 指定服务数据目录（请放在代码仓库之外）
READER_DATA_DIR="$HOME/.reader-test" PORT=4173 npm run preview
```

默认数据目录：
- macOS：~/Library/Application Support/Reader
- Linux：${XDG_DATA_HOME:-~/.local/share}/reader-plugin
- Windows：%LOCALAPPDATA%/Reader

备份整个数据目录即可保留原始书籍、书签、进度和设置。数据没有额外加密，请使用系统磁盘加密。不要提交或分享这个目录。

## 开发者 MCP 插件接入

插件包采用官方仍支持的 .codex-plugin/plugin.json 兼容格式；.mcp.json 声明本地 stdio 服务。构建后：

```sh
npm start
```

它在 stdin/stdout 上运行 MCP，诊断只写 stderr。**不要直接把标准输出当日志。** 本地宿主负责启动它并读取 ui://reader/v0.1.10/bookshelf.html。UI HTML 内联全部脚本和样式，不依赖 CDN；iframe 通过 App.callServerTool 与宿主通信，不假设能 fetch localhost，也不依赖 localStorage/IndexedDB 的持久性。发行平台包使用根目录 portable `plugin.json`/`mcp.json`；这里的兼容 wrapper 仅用于开发。

不同客户端对本地插件和 ${PLUGIN_ROOT} 的支持需要实际检查。若不支持占位符，运行以下命令得到此机器上真实的绝对路径配置，再按该客户端的本地 MCP 配置流程接入：

```sh
node scripts/local-mcp-config.mjs
```

该脚本只打印配置，不修改宿主设置。可传 `--data-dir` 固定绝对书库路径。`npm run prepare:local` 可生成带本机 Node/服务绝对路径的全新本地 marketplace wrapper，再由用户显式注册安装；完整 PowerShell 步骤见 [Windows 指南](docs/WINDOWS.md)。**本仓库不会自动注册市场、安装插件、创建令牌或打开公网隧道。** ChatGPT 开发者模式远程连接与本地 stdio 是不同接入方式；远程部署需要经过授权的认证、TLS 和独立账户隔离方案，不能直接暴露当前预览端口。

### 入口与能力协商

- reader_open：global 书架 / thread 侧面板；模型只能打开界面
- reader_open_file：.txt / .epub file 入口，使用 OpenAIFileEntrypointInputSchema
- 前端在连接前注册输入事件，通过 extensions.resources.read({ uri, representation: 'blob' }) 读宿主文件
- 资源能力缺失时显示手动导入提示，不猜测附件路径
- 私有操作 visibility: ["app"]，书籍正文返回于 tool result 的 _meta.reader
- 32 MiB 文件以 192 KiB 块传输到本地服务；最多两个待完成上传，15 分钟过期
- close/teardown 尝试等待进度保存；强制杀进程/断网前未确认的最后位置仍可能丢失

真实目标客户端必须通过 docs/ACCEPTANCE.md，才能宣称原生入口可用。CLI 本身不渲染阅读 UI。

## 测试

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run validate:plugin
npm run test:platform
# 浏览器验收：首次安装 Playwright 官方浏览器
npx playwright install chromium
npm run test:e2e
# 或使用已经安装的 Chromium/Chrome
CHROMIUM_PATH=/path/to/chrome npm run test:e2e
# 可选真实小说验收：目录必须位于仓库之外，先完成 build
READER_ACCEPTANCE_BOOKS_DIR=/path/outside/repo/books npm run test:books
```

单元/协议测试生成原创极小 TXT/EPUB，不含用户书籍或受版权保护的作品。浏览器测试包括导入、进度恢复、书签、主题、窄屏、无远程资源、真实 AppBridge 的 opaque iframe 文件资源通信。tests/host 是测试宿主，不是 ChatGPT 兼容性证明，不打包进插件 UI。

此前 0.1.1 的 Mac 验收已通过 37 项单元/协议测试、5 项浏览器测试，以及 5 份公版样本的导入、搜索、书签、主题和真实服务进程重启恢复。测试语料、个人数据和截图均不包含在源码发布中。精确环境及剩余宿主检查见 [验收记录](docs/ACCEPTANCE.md)，语料来源和格式限制见 [真实小说记录](docs/CORPUS.md)。

## 发行构建

维护者执行 `npm ci`、`npm run check`、`npm run package:runtime`。产物位于 `artifacts/releases`。发行 CI 只打包一次，Windows Node 22/24、macOS/Linux Node 24 均下载同一运行 ZIP，使用中文/空格解压路径执行 `npm run test:release`。历史升级夹具来自准确的 0.1.2 提交，只用于测试，不是用户安装包。

运行包包含完整生产 `node_modules`、编译服务、内联 UI、完整文件校验清单及第三方许可证；没有 Node 本体、开发依赖、源码 checkout 或用户书籍。安装器使用 Node 内置模块，保留旧版本和 catalog 备份，不修改宿主设置、认证或书库。第三方声明缺失会阻止打包，补充许可证及固定上游来源位于 `distribution/licenses`。

## 架构

- src/server/formats/zip.ts：ZIP 中央目录预检、路径与 CRC 检查、有界解压
- src/server/importers.ts：TXT 编码/章节，EPUB 元数据/目录/纯文本提取
- src/server/store.ts：原始文件与不可变 document.json，小型原子 record.json，跨进程锁
- src/server/service.ts：严格参数校验、分块上传、动作分派
- src/server/mcp.ts：真实 SDK 资源和工具注册
- src/ui/api.ts：MCP Apps / OpenAI 扩展桥与独立预览适配
- src/ui/App.tsx：书架、阅读器、进度/书签/设置交互

安全设计与富格式路线见 docs/ARCHITECTURE.md。

## 依据

- [OpenAI Plugin Extensions](https://developers.openai.com/plugins/build/extensions)
- [官方 TypeScript 扩展 SDK](https://github.com/openai/mcp-extensions/tree/main/typescript)
- [MCP Apps SDK](https://github.com/modelcontextprotocol/ext-apps)
- [插件打包文档](https://developers.openai.com/plugins/build/plugins)
- [foliate-js 安全与接口说明](https://github.com/johnfactotum/foliate-js)
