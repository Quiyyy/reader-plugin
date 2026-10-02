# 0.1.5：把空间留给书架和正文

移除 Reader 自绘的「书本图标 / Reader / 你的私人书架」整条品牌栏及分隔线。键盘帮助移到书架搜索与书籍数量所在行，导入按钮和搜索保留。正文操作栏缩为 44px，仍提供返回书架、目录、搜索、书签和阅读样式；不改变书库格式、保存逻辑或阅读功能。

ChatGPT 顶部应用标题及插件内容上方的独立入口标题由宿主绘制，不属于 Reader HTML。公开 [MCP Extensions 规范](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#titles) 要求入口呈现标题和图标，标题会依次回退到工具 title、annotations.title 或 name；当前 SDK 没有隐藏该宿主栏的公开字段。`ui.prefersBorder: false` 已存在，它是边框提示，并非标题开关。本次不清空入口名称、不修改宿主二进制或越过 iframe 边界。插件内容截图不能证明宿主标题已消失。

## 已有 Node 安装的升级

Mac 自包含包继续在正常目录中保持 `NOT_AVAILABLE`。已有 0.1.3 的本地 Node 安装使用同一路径升级，无需启用自包含 Mac 包：

1. 等待当前阅读位置显示已保存，备份完整书库和 Reader 当前 marketplace/wrapper 配置。
2. 核验与最终通过 CI 的提交对应的 `reader-0.1.5-runtime.zip` 及配套 SHA-256，解压到新的目录。
3. 使用原 wrapper 的同一个 Node 可执行文件运行新包的 `setup.mjs --install-dir "原程序目录" --data-dir "原书库绝对路径"`。setup 将新版本写入 `versions/0.1.5`，保留旧版本，并原子切换本地目录；不会写书库。
4. 通过官方 CLI 或客户端刷新 `reader-plugin@reader-local`。重新打开 Reader 才会使用新的服务和 UI；不强制终止有待保存进度的旧进程。

若需回退，用新包的 setup 指向同一程序目录并显式 `--rollback 0.1.3`，随后通过官方插件管理刷新。仅回退程序，不以旧书库快照覆盖继续阅读后的数据。版本、源提交与文件清单都保留在运行包的 `package-manifest.json` 中。

## 验证边界

浏览器回归覆盖 1280px 宽视图、390px 窄侧栏及 320px 小视图的导入、帮助、返回、目录、样式、搜索和重新打开，并保存书架/正文截图。协议测试仍使用公开 MCP Apps AppBridge。原始用户截图仅供本次比对，不加入仓库、CI 资产或发行包；所有自动截图使用原创测试文字。

主分支自包含包沿用既有六平台构建、真实 GitHub 安装、升级回退验证与发布门槛，保留 Mac 签名禁装限制。原生桌面是否刷新到新 UI 必须单独确认，不能以浏览器预览代替。
