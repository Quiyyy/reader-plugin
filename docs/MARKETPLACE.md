# GitHub marketplace 自包含发行（0.1.5 预览）

Reader 的平台运行包自带官方 Node 24.21.0；用户无需安装 Node、npm、Go，也无需运行 setup。源码仓库中的 npm/Go 命令只用于维护者构建。插件不执行 npm lifecycle、postinstall 或隐藏安装脚本，首次启动不访问网络。

## 安装入口和当前限制

在支持 portable Agent Plugins 的官方客户端添加 GitHub marketplace `Quiyyy/reader-plugin`，选择与设备匹配的一个 Reader。不要同时启用多个平台包。CLI 对应公开操作为：

所有平台的界面名称均为 **Reader**。系统和架构保留在插件描述以及下方安装表中；内部插件 ID 和分发目标仍彼此独立，安装时须按描述选择本机平台。

```sh
codex plugin marketplace add Quiyyy/reader-plugin
# 示例：Windows x64。只能选择本机对应的平台。
codex plugin add reader-win32-x64@reader-marketplace
```

CLI 基线为 0.159.2。该 Git 来源传输需要宿主可用的 Git 和 GitHub 网络连接；私有仓库还需要用户已有的 GitHub 访问权限。没有自动架构选择，也没有发布到通用插件目录。桌面入口、组织策略和系统信任提示可能要求用户操作，因此不能称为全平台无提示一键安装。

| 系统 | 插件 ID | 分发状态 |
| --- | --- | --- |
| Windows x64 | `reader-win32-x64` | 功能预览；启动器无 Authenticode 发布者签名 |
| Windows arm64 | `reader-win32-arm64` | 功能预览；启动器无 Authenticode 发布者签名 |
| Linux x64 | `reader-linux-x64` | glibc 功能预览 |
| Linux arm64 | `reader-linux-arm64` | glibc 功能预览 |
| macOS Apple Silicon | `reader-darwin-arm64` | 正常目录禁止安装，等待发行信任验证 |
| macOS Intel | `reader-darwin-x64` | 正常目录禁止安装，等待发行信任验证 |

macOS 的官方 Node 归档 SHA-256 与 Node 官方发布值一致，解压后二进制字节未改动；GitHub macOS CI 和本机执行器沙盒外的只读 `codesign --verify --strict` 均通过。早先受限执行器内的失败已保留为环境差异证据，不据此认定上游二进制损坏。本机 `spctl --assess` 对 Node 返回“代码有效但不像应用”，对 Reader 启动器返回拒绝。Reader 启动器只有编译器生成的本地代码签名，没有 Developer ID 签名和公证。**本机可执行、代码签名字节有效均不等于 Gatekeeper 或发行信任通过。** CI 保存每个平台的签名检查原始结果；预览验收市场允许在隔离环境验证功能，正常目录将 macOS 标为 `NOT_AVAILABLE`。不会移除 quarantine、重签上游 Node、关闭安全检查或自动确认信任提示。

Node 上游基线：macOS 13.5+；Linux kernel 4.18+、glibc 2.28+、libstdc++ 6.0.25+；Windows 受 Node 24 支持的 x64/arm64 系统。未承诺 musl/Alpine、32 位或所有旧版系统。实际 CI 系统与证据随具体提交记录，不能推断未测设备。

## 启动、缓存和书库

根目录 `plugin.json` 与 `mcp.json` 使用 portable 格式。MCP command 为包内相对路径 `./reader-launcher`（Windows 为 `.exe`）；官方宿主将其解析成安装缓存内的绝对路径，并注入 `PLUGIN_ROOT`、`PLUGIN_DATA`。没有开发机绝对路径，也不依赖当前工作目录。

原生启动器先校验编译绑定的运行清单和应用文件，随后将包内压缩的官方 Node 原始字节校验解压至 `PLUGIN_DATA/reader-node-cache`。这一步只写可重建的运行缓存，使用有界解压、临时文件、原子激活和并发验证。已存在但损坏的运行缓存会明确拒绝启动并保留原文件，不会静默覆盖未知内容。进程 stderr 用于诊断，stdout 只承载 MCP。

书库沿用 0.1.3 的位置，与插件版本/源码目录/运行缓存分离：

- macOS：`~/Library/Application Support/Reader`
- Windows：`%LOCALAPPDATA%/Reader`
- Linux：`${XDG_DATA_HOME:-~/.local/share}/reader-plugin`
- 显式 `READER_DATA_DIR`：继续使用指定的绝对路径。

卸载插件或清理 `PLUGIN_DATA` 不应清除上述书库。备份应覆盖整个书库；原始 TXT/EPUB、解析结果、进度、书签和阅读设置均在其中。

**旧安装若指定了自定义书库路径，切换插件 ID 不会自动迁移旧 wrapper 中的环境变量。** 先记录并保留该路径，通过受支持的本地配置继续提供相同 `READER_DATA_DIR`，并停用旧实例后再切换。不要将空默认书库误判为数据丢失，不要复制旧快照覆盖正在使用的书库。自包含包不会自动迁移旧安装；已有依赖 Node 的本地安装可通过显式 setup 单独升级，见 [界面更新说明](UI_COMPACT.md)。

## 来源、许可证与供应链

`distribution/node-runtime.json` 固定六个官方归档和 SHA-256，来源为 [Node 24.21.0 校验清单](https://nodejs.org/download/release/v24.21.0/SHASUMS256.txt)。维护者从官方 HTTPS 下载并校验；运行包只保存未经修改的 Node 二进制的 gzip 数据和上游许可证，单文件低于 GitHub 100 MiB 限制，无 Git LFS。

启动器使用 Go 1.27.1 标准库，没有第三方 Go 依赖。服务由锁定的生产依赖打成单一 ESM，所有非 Node 内置依赖必须被打包；UI 是无 CDN 的内联 HTML。EPUB 文本路径保留 linkedom 自带的非 canvas 回退，不引入原生 canvas。

包内 `runtime-manifest.json` 记录源提交、依赖锁哈希、目标平台、上游归档/二进制哈希；`PACKAGE-SHA256.json` 提供全部文件清单。包内 `.gitattributes` 禁止 Git 换行转换，远程安装 CI 逐文件比对宿主缓存和原始构建产物。Node、Go、JavaScript 依赖和补充声明保留于 `licenses/`、`DEPENDENCIES.json`、`THIRD_PARTY_NOTICES.md`。哈希用于完整性验证，不是发布者签名的替代品。

## 维护和验证

```sh
npm ci
npm run check
# 另行使用官方 Go 1.27.1；这是维护者构建命令。
npm run package:marketplace -- --target darwin-arm64
node scripts/download-test-codex.mjs
# 指定上一步输出的官方原生 CLI 路径，并先构建 CI 所述 0.1.3 fixture。
READER_TEST_CODEX=/absolute/path/to/codex npm run test:marketplace
```

CI 对六个平台分别构建、运行 Go 测试、原有协议/平台/浏览器测试，以及官方 CLI 安装缓存验收。历史夹具使用准确的 0.1.3 源提交 `81a87e9d7bb38db31cc1f755021af5b809e79169` 和当前测试启动器，只用于数据兼容性验收，不冒充已发布的旧安装包。原有 0.1.2 → 当前版本的免编译 ZIP 升级测试仍保留。

隔离测试使用中文/空格路径和原创 TXT/EPUB。安装子进程的 PATH 只有 Git/系统工具，明确验证找不到 Node/npm；Reader 子进程的 PATH 为空。检查真实 CLI 缓存路径与执行位、原始文件、非零进度、书签、设置、重复安装、版本回退和新进程恢复。移走本地源目录后再检查公开 `app-server` 工具发现。GitHub 分发阶段对未经修改的远程 wrapper 重复测试，并把默认 OS 书库指向临时用户目录，绝不使用真实书库。

所有本地与原有 CI 门槛通过后，CI 才向本仓库独立 `reader-preview/<源提交>/…` 分支发布候选包和固定 SHA 目录；随后六个平台通过 GitHub marketplace 再验收。只有最终 main CI 的这些门槛全部通过，才推进 `reader-dist/<平台>` 和 `reader-dist/catalog`。源码 main 保持小体积；平台二进制不加入 main，不改 0.1.3 标签或资产。最终目录保留 macOS 的信任限制。

公开协议/API 依据：[插件打包](https://developers.openai.com/plugins/build/plugins)、[OpenAI Extensions](https://developers.openai.com/plugins/build/extensions)、[公开 app-server](https://learn.chatgpt.com/docs/app-server)。CLI 不渲染 UI；这些测试不证明 ChatGPT global/thread/file 原生入口或 Windows 桌面体验已通过，仍需相应客户端人工验收。
