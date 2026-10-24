# 开发指南

## 环境与启动

使用 Node.js 24 和 npm；支持范围以 [package.json](../package.json) 的 `engines` 为准。获取目标源码分支后，在仓库根目录运行：

```sh
npm ci
npm run build
node scripts/preview-workspace.mjs --port 4187
```

该预览使用生产 UI／服务和原创样本，每次启动都新建独立书库。地址与数据目录记录在 `artifacts/workspace-preview/latest.json`。用 `--port 0` 可自动分配端口；Ctrl+C 停止。

重用上次预览数据（PowerShell）：

```powershell
$readerPreview = Get-Content artifacts/workspace-preview/latest.json | ConvertFrom-Json
$env:READER_DATA_DIR = $readerPreview.dataDir
$env:PORT = '4187'
npm run preview
```

也可以指定自己的开发目录，启动现有服务预览：

```sh
READER_DATA_DIR="$HOME/.reader-development" PORT=4173 npm run preview
```

`npm run dev` 构建 UI 后从 TypeScript 启动服务；它不是热更新服务器。改动后重新构建／启动。预览仅监听本机回环地址，不能直接代理到公网。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run check` | 脚本语法、类型、单元测试、构建、插件校验、原生平台测试 |
| `npm run typecheck` | TypeScript 检查 |
| `npm test` | Vitest 单元与协议测试 |
| `npm run build` | 构建服务和单文件 UI |
| `npm run test:e2e` | 构建测试宿主并运行 Playwright；先完成生产构建 |
| `npm run inspect:reader -- --surface bridge --scenario epub` | 真实 stdio MCP + 模拟 AppBridge 的隔离界面检查 |
| `npm start` | 启动 stdio MCP 服务；标准输出只用于协议 |
| `npm run package:runtime` | 构建需要系统 Node 的完整运行包 |

首次浏览器测试需要 `npx playwright install chromium`。也可指定已安装浏览器：

```powershell
$env:CHROMIUM_PATH = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
npm run test:e2e
```

## 项目结构

```text
src/
  server/          MCP、HTTP 预览、存储、格式适配、在线书源和 Codex 会话
  shared/          数据契约、参数校验与定位类型
  ui/              工作台、格式阅读器、笔记编辑和对话浮窗
tests/             单元、浏览器、协议、平台与分发测试
scripts/           构建、验收、预览和打包工具
distribution/      安装器、原生启动器、运行时固定版本和第三方声明
docs/              使用、架构、版本、设计与历史验收文档
tools/ui-lab/      可复用静态原型预览工具
experiments/epub/  原创样本与 EPUB 选型实验
```

数据流和信任边界见 [架构说明](ARCHITECTURE.md)。生产笔记与阅读状态由服务持久化；设计实验室使用演示数据，不与正式书库共享状态。

## 环境变量

| 名称 | 用途 |
| --- | --- |
| `READER_DATA_DIR` | 指定服务数据目录；测试使用绝对路径和独立书库 |
| `PORT` | HTTP 预览端口，默认 4173 |
| `READER_CODEX_PATH` | 官方 Codex 可执行文件或 `codex.js` 的绝对路径 |
| `CHROMIUM_PATH` | Playwright／界面验收使用的浏览器路径 |
| `READER_ACCEPTANCE_BOOKS_DIR` | 经授权的本地书籍验收目录，必须位于仓库外 |

不要提交 `.env`、书库、凭据或依赖本机绝对路径的安装配置。

## 本地插件接入

构建后，`.mcp.json` 声明 `dist/server/index.js` 的 stdio 服务。UI 为内联脚本、样式的 MCP Apps 资源，通过宿主 RPC 访问数据。所有工具均声明为 app-only；笔记与阅读助手通过独立的动态工具调用链操作当前对象。

需要本机绝对路径配置时，运行：

```sh
node scripts/local-mcp-config.mjs --data-dir "/absolute/path/to/development-library"
```

此命令只输出配置。生成本地 marketplace 和 Windows 接入步骤见 [Windows 源码接入](WINDOWS.md)；宿主能力限制见 [宿主调查记录](HOST_ROUTING.md)。

## 分层验证

使用原创最小样本和独立 `READER_DATA_DIR`，不要让测试访问个人书库。

1. 单元／协议测试覆盖参数、版本冲突、原文校验、模型范围、取消与持久化。
2. 浏览器测试覆盖实际导入、选择、导航、编辑、窄窗口和导出。
3. 原生 MCP／模拟 AppBridge 覆盖标准传输、资源与受限 iframe；**不等于实际 Codex 宿主验收**。
4. 真实模型、宿主与发行安装分别验证，结果不能互相替代。

笔记协作真实探针为 `node scripts/check-note-assistant.mjs --run`；阅读真实模型探针 `node scripts/check-reader-codex.mjs --run` 会创建测试话题、发送原创内容并使用账户模型额度；仅在需要验证连接链路时主动运行。它不属于默认测试。原型工具启动与验证见 [UI 实验室](../tools/ui-lab/README.md)。

界面证据和运行包写入被 Git 忽略的 `artifacts/`。公开报告或截图前检查其中是否包含个人内容。

## 打包与发行

`package:runtime` 生成 `artifacts/releases/reader-<版本>-runtime.zip`、校验清单、许可证及依赖清单。运行包烟雾检查可用 `node scripts/check-reader-runtime.mjs`；完整 `test:release` 还需要 CI 所述历史夹具。

平台 marketplace 打包需要干净提交、对应官方 Node 归档和固定 Go 工具链，见 [平台分发](MARKETPLACE.md)。实际 Windows 升级采用 [单包交付流程](WINDOWS_DELIVERY.md)，构建、验收和安装须使用同一份产物。

推送源码会按 [CI 配置](../.github/workflows/ci.yml) 运行检查；main 的分发门槛与功能分支不同。运行本地测试不代表远端 CI 或实际宿主已通过，不要用源码版本号推断当前已分发版本。
