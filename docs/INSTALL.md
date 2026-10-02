# Reader 免编译运行版

此运行包包含已构建服务、完整生产依赖、内联阅读 UI、第三方许可证和显式 setup。运行时只需要兼容 Node.js；无需源码 checkout、npm、编译或保留开发目录。

## 准备

1. 从本项目发布附件或对应 Library 运行包取得 `reader-0.1.3-runtime.zip`，与同时提供的 SHA-256 比较。源码 ZIP 不等于运行包。
2. 安装官方 Node.js 24 LTS，或使用已安装的兼容版本：22.12+（22 系列）、24、26+。自动化验证覆盖 Windows Node 22/24、macOS/Linux Node 24；26+、Windows ARM64 尚未验证。
3. 将 ZIP 解压到临时普通目录，可包含中文和空格。不要修改解压内容。系统 Node 由用户预装，不假设 Codex 内置 Node。

没有自动安装钩子、开机服务、后台授权或公开端口。无需关闭沙箱、修改 PowerShell 执行策略、管理员权限或防火墙设置。

## Windows 原生安装

在解压后的 `reader-0.1.3-runtime` 文件夹打开 PowerShell：

```powershell
node --version
node .\setup.mjs
```

默认安装目录 `%LOCALAPPDATA%\ReaderPlugin`；默认书库 `%LOCALAPPDATA%\Reader`。setup 输出实际安装路径与 marketplace 路径。

如原书库在别处，首次安装时明确指定：

```powershell
node .\setup.mjs --install-dir 'D:\Reader 程序' --data-dir 'D:\我的书库'
```

两个路径必须绝对且互不包含。已有同名目录但没有 Reader 安装标记时会拒绝覆盖，请选择全新程序目录；不要清空未知目录。setup 不创建、迁移、覆盖或删除书库文件。

## macOS / Linux

```sh
node --version
node ./setup.mjs
```

- macOS 安装目录：`~/Library/Application Support/ReaderPlugin`；书库：`~/Library/Application Support/Reader`。
- Linux 安装目录：`${XDG_DATA_HOME:-~/.local/share}/reader-plugin-install`；书库：`${XDG_DATA_HOME:-~/.local/share}/reader-plugin`。

`--install-dir` / `--data-dir` 可使用加引号的绝对路径。不要将安装目录放进解压包或书库。

## 在官方客户端注册

setup 只生成本地 marketplace，不修改 Codex 用户配置，也不自动安装插件。使用它输出的 **marketplace** 完整路径：

```text
codex plugin marketplace add "<setup 输出的 marketplace 路径>"
```

此路径内有真实 `.agents/plugins/marketplace.json`，指向其内部已安装的版本及插件 wrapper。wrapper 使用本机 Node 绝对路径、独立参数数组和持久书库路径。打开桌面插件目录，在 **Reader Local** 中安装/刷新 **Reader**。支持相应公开命令的 CLI 也可执行 `codex plugin add reader-plugin@reader-local`；CLI 本身不渲染阅读 UI。

Windows 中若 npm 安装的 `codex.ps1` 被策略拦截，可使用随附的 `codex.cmd`，不修改执行策略。若 CLI 不在 PATH，使用桌面支持的本地 marketplace 添加入口或官方 CLI 的实际可执行路径。

不要把 GitHub 源码仓库 URL 或 ZIP URL 当作这个本地 marketplace 的安装来源；源码仓库不包含生产依赖。也不要手工覆盖整个 `~/.codex/config.toml`。本包不依赖未声明的安装钩子。

安装并验证后可移走解压包。稳定安装目录及 Node 必须保留，运行时不再引用下载目录或开发目录。

## 从 0.1.2 升级

0.1.2 的 wrapper 指向源码目录。先查看其现有 `.mcp.json` 中 `READER_DATA_DIR`，确认真实书库位置。等待界面显示“已保存”并关闭旧 Reader 后，按日常方式备份整个书库。

1. 解压新运行包；运行 `node setup.mjs --data-dir "旧书库的绝对路径"`，必要时指定新的稳定安装目录。
2. setup 不修改旧 wrapper、旧源码或用户书库。记录旧 marketplace 路径作为恢复入口。
3. 使用官方流程将 `reader-local` 注册源更新为新安装目录，并安装/刷新 Reader。若客户端报告已存在的 marketplace，先查看现有来源，仅通过客户端支持的 marketplace 管理流程切换；不要编辑或覆盖未知配置。
4. 重新打开 Reader，确认书架、进度、书签和设置，再考虑归档旧开发目录。旧 Reader 进程不会被 setup 强制停止。

公开 CLI 0.159.2 已在隔离配置目录实测：同一路径重复添加是幂等操作；同名市场换路径会报错，要求先移除旧注册。先用 `codex plugin marketplace list --json` 记录并确认 Reader 的旧来源，再执行：

```text
codex plugin marketplace remove reader-local
codex plugin marketplace add "新 setup 输出的 marketplace 路径"
codex plugin add reader-plugin@reader-local
```

这里移除的是 Reader 的 marketplace 注册；不删除旧源码、运行安装目录或书库。若新来源添加失败，使用刚记录的旧路径重新添加。其它客户端版本以其公开管理流程为准，不移除其它市场或插件。

版本 0.1.3 保持既有数据格式，不重新导入、不重置阅读记录。若需退回未托管的 0.1.2，保留书库，按官方流程重新注册旧 marketplace；旧开发目录仍需完整存在。

## 后续升级、重复运行与恢复

每个版本存放在 `versions/<版本>`，旧版本保留。升级先校验完整文件清单和校验和，完成新版本写入后，才原子切换 catalog；旧 catalog 存入 `backups`。同版本、同 Node 路径、同包重复 setup 返回 `unchanged`。手工改动的插件配置、同版本不同内容、未知文件或不同书库路径会明确报错并保留原状。

回退到本安装目录中已保留的版本：

```text
node setup.mjs --install-dir "稳定安装目录" --rollback 0.1.3
```

只回退程序/catalog，不恢复或覆盖书库；然后刷新客户端插件，保存阅读后重启。未保留的版本不会自动下载。旧安装包不能无提示降级较新版本。

中断后重跑 setup。若留下锁，确认先前 setup 已退出后加 `--recover-lock`；脚本只在原 PID 已不存在时将锁归档，不会强制终止进程。若安装目录没有完整所有权标记，不会自动修复或删除它；先保留该目录供检查，再选择新安装目录。已完成的旧 catalog 始终引用完整版本，未激活的 staging 目录保留供检查。

Node 可执行文件搬家时，不覆盖旧同版本 wrapper；选择新安装目录并明确使用原书库，重新注册。活动书库建议在普通本地磁盘；网络盘、同步盘竞争与额外长路径策略尚未实测。

## 已测与未测

发行 CI 从干净 ZIP 解压目录（包含中文、空格）直接运行 setup 和真实 MCP：无需在解压包执行 npm install/build；覆盖 TXT/EPUB 导入、读取、实际子进程重启恢复、重复 setup、旧 0.1.2 数据保留、托管版本升级/回退及未知配置拒绝覆盖。历史 0.1.2 测试载荷来自准确提交 `f398d0ddffc158e6f5282e77abac9cb11f1bb37a`；为测试托管升级而套用当前 installer，不表示曾发布 0.1.2 免编译包。

实际 Windows 用户电脑仍未连接验收：安装/信任提示、global/thread/TXT/EPUB 文件入口、桌面重启恢复待实测。Mac 的宿主路由问题 [#50152](https://github.com/openai/codex/issues/50152) 仍未修复；本版本不 patch 宿主、不恢复远程探针、不增加权限。

完整生产依赖及其上游许可证随包保留，见 `THIRD_PARTY_NOTICES.md`、`DEPENDENCIES.json` 和 `runtime/node_modules`。不包含 Node 本体或原生系统组件。校验和用于确认传输/安装内容，并非代码签名或软件信任批准。

依据：[官方本地 marketplace 与插件机制](https://developers.openai.com/plugins/build/plugins)。
