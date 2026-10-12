# 安装指南

Reader 提供平台 marketplace、需要系统 Node 的运行包，以及源码接入三种方式。请选择与你取得的版本相符的方式；0.2.0 当前为源码开发预览，不能据此假定 marketplace 已更新到同一版本。

## 选择安装方式

| 方式 | 适用场景 | 要求 |
| --- | --- | --- |
| 平台 marketplace | 安装已经分发的 Windows／Linux 平台包 | 支持 portable 插件的宿主、Git 与 GitHub 连接；Node 随包提供 |
| `reader-<版本>-runtime.zip` | 使用维护者提供的免编译运行包 | 系统 Node；不需要 npm 或源码目录 |
| 源码接入 | 开发或体验当前源码分支 | Node、npm、安装依赖和构建 |

平台包及 macOS 当前限制见 [marketplace 说明](https://github.com/Quiyyy/reader-plugin/blob/main/docs/MARKETPLACE.md)。源码接入步骤见 [Windows 指南](https://github.com/Quiyyy/reader-plugin/blob/main/docs/WINDOWS.md)。以下内容用于独立运行 ZIP。

## 准备运行包

1. 取得维护者明确提供的 `reader-<版本>-runtime.zip` 及配套 `.sha256`，核对摘要。GitHub 的源码 ZIP 不等于运行包；没有对应附件时不要使用猜测的下载地址。
2. 安装 Node.js 24，或使用兼容版本：22.13+（22 系列）、24、26+。不依赖桌面内置 Node。
3. 将 ZIP 解压到新的普通目录，进入解压后的 `reader-<版本>-runtime` 文件夹。目录名可包含中文和空格。

校验 SHA-256：

```powershell
# Windows：将文件名替换为实际版本
Get-FileHash -Algorithm SHA256 -LiteralPath '.\reader-<版本>-runtime.zip'
```

```sh
# macOS
shasum -a 256 reader-<version>-runtime.zip
# Linux
sha256sum reader-<version>-runtime.zip
```

## 安装运行文件

在解压目录执行：

```sh
node --version
node setup.mjs
```

| 系统 | 默认程序目录 | 默认书库 |
| --- | --- | --- |
| Windows | `%LOCALAPPDATA%/ReaderPlugin` | `%LOCALAPPDATA%/Reader` |
| macOS | `~/Library/Application Support/ReaderPlugin` | `~/Library/Application Support/Reader` |
| Linux | `${XDG_DATA_HOME:-~/.local/share}/reader-plugin-install` | `${XDG_DATA_HOME:-~/.local/share}/reader-plugin` |

已有书库在其他位置时，首次安装明确指定其绝对路径：

```powershell
node .\setup.mjs --install-dir 'D:\Reader 程序' --data-dir 'D:\我的书库'
```

程序和书库路径必须互不包含，不要将程序安装到解压目录内。已有同名目录但没有 Reader 安装标记时，安装器会拒绝覆盖。setup 不创建、迁移、覆盖或删除书库，不写宿主认证配置，不自动注册插件。

## 注册插件

setup 会输出实际安装路径及本地 marketplace 路径。通过支持该流程的官方客户端注册输出路径，例如：

```text
codex plugin marketplace add "<setup 输出的 marketplace 路径>"
codex plugin add reader-plugin@reader-local
```

也可以使用桌面的本地 marketplace 管理入口，在 **Reader Local** 中安装或刷新 **Reader**。CLI 本身不渲染阅读 UI，具体界面入口仍需宿主支持。

Windows 若 `codex.ps1` 被执行策略拦截，可使用官方 npm 安装随附的 `codex.cmd`；无需修改执行策略。不要把运行 ZIP 的下载 URL 当作本地 marketplace 路径，也不要覆盖整个 `~/.codex/config.toml`。

确认安装成功后可以移走解压包，但需保留稳定安装目录和 Node 可执行文件。若 Node 路径变动，应重新生成安装配置。

## 升级与回退

升级前等待“已保存”、关闭 Reader，并备份整个书库。使用新包运行 setup，保持原来的书库路径。新版本位于 `versions/<版本>`；完整校验成功后才切换 catalog，旧版本和 catalog 备份保留。

同一版本、相同内容及 Node 路径的重复安装是幂等操作。手工改动的配置、同版本不同内容、未知文件或书库路径变化会被拒绝覆盖。不要删除旧目录来强行绕过这些检查。

回退到该安装目录中保留的版本：

```text
node setup.mjs --install-dir "稳定安装目录" --rollback <已保留的版本号>
```

回退只切换程序和 catalog，不恢复书库快照。旧版本可能无法显示新版笔记或 PDF；降级前保留完整备份。

从早期源码 wrapper 迁移时，先记录旧 `.mcp.json` 中的 `READER_DATA_DIR`，再将同一路径传给新 setup。同名 marketplace 若不允许改变来源，先记录旧注册路径，通过客户端的官方管理流程移除 Reader 的旧注册并添加新路径；失败时可重新注册旧路径。不删除其他插件或书库。

安装中断后可重跑。遗留锁仅在确认原安装进程已退出后使用 `--recover-lock`；不清空未知目录。网络盘、同步盘竞争和特殊长路径策略不在本地验收范围内。

## 验证安装

检查实际安装版本，然后验证导入、阅读、保存与桌面重启恢复。原生 global/thread/file 入口、下载和原生消息交接须分别检查，手动导入成功不等于宿主文件分派成功。

运行包附有项目 LICENSE、`THIRD_PARTY_NOTICES.md`、`DEPENDENCIES.json` 及文件摘要清单。摘要验证内容完整性，不代替系统信任判断或发布者签名。平台与宿主记录见 [项目文档](https://github.com/Quiyyy/reader-plugin/tree/main/docs)；问题反馈见 [Issues](https://github.com/Quiyyy/reader-plugin/issues)。
