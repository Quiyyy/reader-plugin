# Windows 原生安装与验证

**普通用户使用 0.1.3 [免编译运行包](INSTALL.md)。该流程只要求 Node，无需 Git、npm 或构建。本文以下源码流程供开发者使用。**

Reader 0.1.3 使用 Windows 原生 Node.js 和本地 stdio，不要求 WSL。Windows Codex 支持插件，不代表所有 global/thread/file 界面入口均已验收。本次开发没有连接用户的 Windows 电脑。

## 前置条件

- 官方 ChatGPT/Codex Windows 客户端，选择 **Windows native**。
- 官方 Node.js 24 LTS（或 22.12+ 的 22 系列）和 Git；新终端中 `node --version`、`npm.cmd --version`、`git --version` 可用。
- 注册示例使用公开 `codex plugin marketplace add`；本文核对的 CLI 为 0.159.2。也可使用桌面提供的本地 marketplace 添加流程。
- 不需要管理员、修改 PowerShell ExecutionPolicy、关闭沙箱或添加防火墙规则。若系统策略阻止程序运行，按本机正常批准流程处理。

PowerShell 使用 `npm.cmd` / `npx.cmd` 直接运行 Node 随附的命令文件，无需修改 `.ps1` 执行策略。下例是 PowerShell 语法。

## 获取并构建

```powershell
$readerRoot = Join-Path $env:USERPROFILE 'source\Reader 小说'
git clone https://github.com/Quiyyy/reader-plugin.git "$readerRoot"
Set-Location -LiteralPath "$readerRoot"
npm.cmd ci
npm.cmd run check
```

确认 `package.json` 是 0.1.3 或所需更新版本。`check` 运行脚本语法检查、TypeScript、单元/协议测试、构建、插件校验及真实子进程持久化测试。测试仅使用原创小样本与临时书库。

## 生成本机安装材料

```powershell
$marketplace = Join-Path $env:LOCALAPPDATA 'Reader Plugin\marketplace-0.1.3'
$library = Join-Path $env:LOCALAPPDATA 'Reader'
node .\scripts\prepare-local-plugin.mjs --output "$marketplace" --data-dir "$library"
```

脚本只创建新的 marketplace 目录，不写 Codex 用户设置，不安装插件、不联网、不创建凭据。目标已存在时拒绝覆盖；`--data-dir` 必须是绝对路径，建议放在仓库外。

生成的 `.mcp.json` 使用当前 `node.exe` 的绝对路径和独立参数数组，保留空格、中文和反斜杠；不拼接 shell 命令，不依赖桌面 PATH 或 `${PLUGIN_ROOT}` 展开。wrapper 指向当前源码目录的 `dist/server/index.js`，该目录的 `node_modules` 必须保留。它不是独立 Windows 安装包，不能复制到另一台机器直接使用。

## 在 Codex 注册与安装

在已安装 Codex CLI 的终端执行：

```powershell
codex plugin marketplace add "$marketplace"
```

若 npm 安装的 `codex.ps1` 被策略拦截，改用随同安装的 `codex.cmd plugin marketplace add "$marketplace"`，不要修改执行策略。若 `codex` 不在 PATH，可用桌面支持的 marketplace 添加入口，或官方 CLI 的实际可执行路径，不猜测桌面私有路径。

这会注册 `reader-local` marketplace。打开/重启桌面插件目录，在 **Reader Local** 中安装 **Reader**，保留其它插件和设置。支持 `plugin add` 的 CLI 也可执行 `codex plugin add reader-plugin@reader-local`。CLI 不渲染阅读器 UI。

保存当前阅读后，打开新本地任务或 Reader 主导航入口，检查版本和书库。若出现 `thread not found` 或 `unsupported app-server method`，按 [宿主限制](HOST_ROUTING.md) 记录；不要重装书库或关闭安全限制。

若客户端仅提供 MCP 配置，运行：

```powershell
node .\scripts\local-mcp-config.mjs --data-dir "$library"
```

按该客户端官方流程合并输出，不覆盖整个现有配置。仅配置 MCP 工具不保证插件导航入口出现。

## 数据、升级和备份

- 默认书库：`%LOCALAPPDATA%\Reader`；显式 `READER_DATA_DIR` 优先。库内保留源文件、文档、进度、书签和设置。
- PowerShell 的 `$env:READER_DATA_DIR` 不一定传给已运行的桌面进程；生成器 `--data-dir` 可固定插件启动配置。
- 升级保留同一书库路径。构建新版后，用新的 marketplace 目录重新生成，按官方流程刷新注册/插件，保存阅读后重启旧进程。0.1.2 不改变存储格式，不要求重新导入。
- Node 或源码目录移动后需重新生成 wrapper，不要通过移动书库修复启动路径。
- 等待“已保存”并关闭 Reader 后，备份整个书库。不要上传书库到 GitHub。Windows ACL 由账户和系统管理，Unix mode 参数不是 Windows 访问控制承诺。
- 活动书库建议放本机普通磁盘；未验证网络共享盘、OneDrive 同步竞争、超长路径策略或 ARM64 Windows。

## 可选浏览器回归与预览

```powershell
npx.cmd playwright install chromium
npm.cmd run test:e2e
```

测试使用 Playwright 官方 Chromium、临时书库和官方 MCP Apps AppBridge 测试宿主；不是实际 Codex 桌面验收。

仅预览可运行 `npm.cmd run preview`，只监听 `127.0.0.1:4173`，不要将其发布到公网。指定预览目录使用：

```powershell
$env:READER_DATA_DIR = Join-Path $env:LOCALAPPDATA 'Reader Preview'
$env:PORT = '4173'
npm.cmd run preview
```

## 自动化与待验收边界

CI 在含空格、中文的 checkout 中运行 Windows Node 22/24、macOS Node 24、Linux Node 24。各任务执行相同核心与浏览器测试；Windows 还实际验证 `%LOCALAPPDATA%\Reader` 默认路径。

协议测试通过真实 Node stdio 子进程与 SDK 初始化、读取 UI、分块导入 TXT/EPUB、保存进度/书签/设置，启动新进程恢复并比对原文件；也验证生成的 marketplace wrapper。结果以对应提交的 [GitHub Actions](https://github.com/Quiyyy/reader-plugin/actions) 为准。

Windows 电脑在线且获授权后，仍需逐项验收：

1. 记录 Windows、桌面与内置 Codex 版本，通过正常插件安装/信任流程。
2. 分别在主导航、本地任务侧栏打开 Reader，确认真实工具调用成功。
3. 导入中文/空格文件名的 TXT、无 DRM EPUB，滚动并等待保存，添加书签、修改主题。
4. 关闭并重启桌面，确认书库、位置、书签和设置恢复。
5. 分别从宿主 TXT、EPUB 文件入口打开，确认资源 API、格式和去重。手动导入成功不代表 file handler 通过。
6. 单独检查云端/dot 任务。Mac 的 [openai/codex#50152](https://github.com/openai/codex/issues/50152) 宿主路由问题仍未修复，0.1.2 不作绕过或修复承诺。

官方依据：[Windows 原生客户端](https://developers.openai.com/codex/windows)、[插件打包与 marketplace](https://developers.openai.com/plugins/build/plugins)、[global/thread/file 扩展](https://developers.openai.com/plugins/build/extensions)。
