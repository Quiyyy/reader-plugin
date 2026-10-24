# Reader 0.2.3 · 笔记协作与按需上下文

2026-10-24。平台包以 manifest 和来源提交为准。

## 笔记工作区

笔记顶部提供折叠／展开列表按钮。正文填满标题和工具栏下的可用高度，窗口变化或长内容输入时自动调整；文本不再局限于固定 300px 输入框，长内容使用编辑区外层滚动。图片占用的空间也参与高度计算。

笔记支持粘贴、拖入或选择截图。点击“Codex 辅助编写”启动绑定当前笔记的独立话题，先保存当前草稿，再让 Codex 读取最新 revision。可以要求补写正文、将对话附图插入笔记，或标注截图。图片支持矩形、箭头、高亮和文字，原图不改写；导出 ZIP 同时保留原图与带标注的图片。

后台修改仍采用 revision 冲突检测。用户继续输入时不会被模型的新版本静默覆盖；截图在发送期间加入下一条草稿也会保留。

## 工具暴露与交接

- 所有 Reader MCP 工具（包括 UI 入口）声明 `_meta.ui.visibility: ["app"]`，普通宿主模型默认不可见。插件通过原有全局、聊天和文件 UI 入口打开。
- MCP UI 调用结果保留在 `_meta.reader`，不再自动把业务数据复制进模型文本／结构化输出。
- 内部聊天启动时通过文档化 `dynamicTools` 注入当前操作集。笔记协作只允许当前笔记、已提供的图片与引用；没有书库搜索、其他笔记修改或文件夹操作能力。
- 不使用全局 `tools/list_changed` 临时放开工具，避免一个窗口打开插件后影响其他普通对话。
- 主动“在 Codex 中继续”或“整理到 Space”才把选定正文和附图交接给原生对话，不要求原生对话调用隐藏的 Reader 工具，也不自动写回 Page 链接。

依据：[OpenAI 工具可见性定义](https://developers.openai.com/plugins/reference#_meta-fields-on-tool-descriptor)、[Codex App Server](https://learn.chatgpt.com/docs/app-server)。可见性是宿主的工具发现约定，不替代服务端权限；内部对话另有对象与图片范围检查。已存在对话的历史上下文不能被追溯删除，新配置需由宿主重新加载。

## 验证

- 323 项单元／协议测试通过，覆盖 app-only、UI 私有结果、笔记对象范围、图像传输、插图、标注和 revision 冲突。
- 全量 60 项浏览器测试通过；最终编辑区／图片排版与新增的附图并发场景经过 7 项针对性回归，包含 1280／390／320px。
- `scripts/check-note-assistant.mjs --run` 使用独立书库与原创图形完成真实 Codex 验证：保留原文并补写、插图、标出左侧节点，其他笔记与原图不变。测试话题已归档。该命令会使用登录账户的模型额度，不属于默认测试。
- 原始证据位于 `artifacts/note-assistant-live/report.json`、`artifacts/note-full-editor-*.png`、`artifacts/note-collaboration-*.png`。

最终交付继续采用[同一安装包验收与升级流程](WINDOWS_DELIVERY.md)。模拟 AppBridge 与原生 MCP 验证不等于真实 Codex 窗口验收；关闭旧 Reader 页面后重新打开以载入新 UI 与工具可见性。
