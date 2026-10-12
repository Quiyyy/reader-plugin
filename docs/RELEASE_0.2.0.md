# Reader 0.2.0 · 阅读与学习工作台

状态：未发布。2026-10-12 完成本地开发与验收；提交或推送源码不等于发布平台包或替换已安装插件。设计依据为 [产品设计文档](design/reader-workspace/PRODUCT_DESIGN.md)。

## 可以实际使用的流程

- 导入 TXT、EPUB 或 PDF，按文件夹和标签管理，继续上次阅读。
- 划选原文，创建高亮、批注、笔记或打开阅读对话。PDF 还可框选图表，保留截图及所在页、旋转和区域坐标。
- 编辑独立 Markdown 笔记、添加图片和来源；从引用回到原文，再返回笔记。查看引用不覆盖正常阅读进度。
- 在浮窗连续追问，拖动、收起、切换话题、取消回复，把回答保存为有来源的笔记。阅读正文不因打开对话而缩窄。
- 自定义强调色、明暗和纸色；图标保留悬停提示及无障碍名称，减少常驻说明。
- 使用搜索、近期修改撤销、回收站、恢复和再次确认后的永久删除。纯文字笔记导出 Markdown，带图笔记导出 ZIP。

浮窗连接官方 Codex CLI 的 app-server stdio，使用已有登录与模型配置。它创建独立阅读会话，并不是原生聊天小窗的镜像。真实测试已验证选区提问、同话题追问、通过工具写入笔记和进程重连后的会话恢复。

## MCP 与 Space

原生 Codex 可以查找书籍、笔记、文件夹与批注，读取已授权正文、目录及摘录，按当前 revision 编辑笔记、标记和组织信息，并发更新会被拒绝覆盖。PDF 截图引用可作为真实图片内容返回给模型。整书许可只能从 Reader UI 修改；浮窗本轮关闭“允许读取本书”后，不会继承全局整书权限。

笔记保存在 Reader。Space 通过原生对话交接请求整理，成功后记录 Page 链接；没有自动双向同步。独立预览不具备原生消息接口时提供可复制交接内容，不显示虚假的发送成功。

## 本机体验

```powershell
npm ci
npm run build
node scripts/preview-workspace.mjs --port 4187
```

打开 http://127.0.0.1:4187。它运行生产 UI 和服务，每次启动生成独立书库及原创书籍、笔记示例，不读取个人书库。当前地址和数据目录记录在 `artifacts/workspace-preview/latest.json`；Ctrl+C 停止。希望下次接着使用这份预览数据时：

```powershell
$readerPreview = Get-Content artifacts/workspace-preview/latest.json | ConvertFrom-Json
$env:READER_DATA_DIR = $readerPreview.dataDir
$env:PORT = '4187'
npm run preview
```

设计文档与交互实验室继续保留在 `docs/design/reader-workspace` 和 `tools/ui-lab`。原型对话是演示，4187 的正式预览连接真实服务。

## 验证结果

| 范围 | 结果与证据 |
| --- | --- |
| 项目检查 | `npm run check`：脚本语法、TypeScript、304 项单元／协议测试、生产构建、插件 manifest 校验和 5 项原生平台测试通过 |
| 浏览器 | 全量 45/45，通过 TXT／EPUB／PDF 摘录、笔记、浮窗草稿、窄窗口和 opaque iframe PDF 场景 |
| 原生 MCP + 模拟 AppBridge | `artifacts/workspace-inspection-final/report.json`，宽屏／390／320、EPUB 图片／字体／脚注／目录／恢复通过；没有页面异常或资源请求失败，CSP 未放宽 |
| 真实 Codex | `artifacts/codex-reading/report.json`，真实选区推理、追问、创建笔记与重连恢复通过；仅使用新建测试话题和原创资料 |
| 运行依赖 | `artifacts/runtime-check/report.json`，运行包清空 PATH/NODE_PATH 后启动，未安装可选 native canvas，仍能解析 PDF、持久化笔记和重启恢复 |
| 运行包 | `artifacts/releases/reader-0.2.0-runtime.zip`，约 43.3 MiB，文件摘要及第三方许可证已生成；来源标记 `dirty: true`，仅为本地开发验收产物 |

UI 截图位于 `artifacts/workspace-*.png`，其中 `workspace-pdf-bridge.png` 展示受限 iframe 中的真实 PDF 高亮。模拟宿主和独立预览均不等于 Codex 原生插件安装验收。本地功能验收没有安装、发布或更新用户真实书库；正式发行仍需走现有单包交付流程，未执行六平台发行及历史安装器升级矩阵。

## 2026-10-13 合入前回归修复

分支 CI 的运行包、原生平台构建与安装测试通过，但浏览器检查暴露了空书库定位歧义，以及较慢环境中的设置加载、保存重试时序问题。原始记录见 [分支 CI](https://github.com/Quiyyy/reader-plugin/actions/runs/38254663867)。

阅读器现在以工作台已加载的设置初始化，迟到的设置响应不会覆盖本地编辑。样式保存失败时保留阅读器和草稿；返回书库后的失败进度由工作台接管，旧阅读器卸载时不重复写入。测试明确定位页头导入按钮，并为重复执行的超时场景使用独立书籍，避免上轮进度影响下一轮。

增加了人为延迟设置响应、保存失败后重试的回归覆盖。本机 `npm run check` 与全量 47 项浏览器场景通过；设置与重启相关场景分别重复 5 次通过，超时重试场景使用独立样本重复 5 次通过。该修复不放宽断言、全局超时或 CI 门槛；远端结果以修复提交对应运行记录为准。

## 保留的边界

PDF 64 MiB／10000 页；TXT、EPUB 32 MiB。扫描 PDF 可以阅读和截图，尚无 OCR；全文检索依赖已索引文字。加密 PDF 密码与解密页文字只留在服务会话内，用户主动保存的摘录和截图照常持久化。在线正文搜索只读取本地缓存，不为搜索下载全书。

笔记是本地 Markdown 编辑器，支持基础格式和预览；没有富文本实时协作、跨设备同步或自动合并。单篇笔记 50 万字符、工作台元数据 48 MiB、2000 篇笔记／文件夹，近期撤销最多保留 20 次。永久删除原书不自动清理独立摘录、导出副本和用户备份。

运行环境推荐 Node 24，最低 Node 22.13（22 系列）；浮窗需要官方 Codex CLI 可用并已登录。真实宿主的文件分派、下载、原生消息交接与 Space 写入仍需在安装后的使用体验中验证。
