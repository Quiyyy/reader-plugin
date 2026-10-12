# 插件 UI 设计预览工具

本目录为静态交互原型提供可复用的本机预览服务和图文设计稿阅读器。当前示例是 `docs/design/reader-workspace`，也可以用 `--root` 指向另一个包含 `lab.html` 的原型目录。

```powershell
node tools/ui-lab/serve.mjs --root docs/design/reader-workspace --port 4186
```

服务器仅依赖 Node 内置模块，不需要运行 Reader 业务服务。它只读取指定静态目录，监听 `127.0.0.1`，不提供文件写入、Shell 执行或 MCP 控制端点。可选的 `/design.html` 将该目录的 `PRODUCT_DESIGN.md` 渲染为可浏览文档。

`document.mjs` 仅支持设计稿实际使用的 Markdown 子集：标题、段落、列表、表格、图片和链接。它不执行原文 HTML；通用文档转换应使用专门的 Markdown 工具。

Reader 场景切换、阅读浮窗演示、外观配置、消息校验和演示数据位于示例目录。这里没有实现通用 MCP Apps 宿主；生产协议检查继续使用仓库的 `scripts/inspect-reader.mjs` 和 `tests/host`。

`check-reader-design.mjs` 是此示例的浏览器流程验证，使用仓库现有 Playwright 开发依赖和本机 Edge。它会更新截图和静态 `design.html`，并将报告写入 `artifacts/reader-design-checks`。完整准备与复现步骤见示例目录的 README。
