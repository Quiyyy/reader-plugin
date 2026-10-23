# 界面截图

本目录图片来自 Reader 正式 UI 的自动化测试，只包含项目原创测试文字和图形，不包含用户书库、个人笔记或真实模型对话。

| 文件 | 内容 | 复现位置 |
| --- | --- | --- |
| `notes.png` | 0.2.2 简洁笔记编辑器 | `tests/e2e/refined-workspace.spec.ts` 的元数据保留与编辑流程 |
| `pdf-reading.png` | 0.2.0 模拟 AppBridge 中的真实 PDF 页面与高亮 | `tests/e2e/workspace.spec.ts` 的 opaque iframe PDF 场景 |

测试原始截图保存在忽略的 `artifacts/` 中。更新公开截图时，先检查内容，再将选定图片复制到本目录。设计原型的截图位于 `docs/design/reader-workspace/assets/`，不要将其标注为生产实现。
