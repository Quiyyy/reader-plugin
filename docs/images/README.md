# 界面截图

本目录图片来自 Reader 正式 UI 的自动化测试，只包含项目原创测试文字和图形，不包含用户书库、个人笔记或真实模型对话。

| 文件 | 内容 | 复现位置 |
| --- | --- | --- |
| `library-0.2.14.png` | 0.2.14 混合书库、文件夹与紧凑封面；1280 × 860 | `tests/e2e/library-drag.spec.ts` 的 `refined library toolbar, menus, empty state and drag targets fit light, dark and narrow layouts` 场景；原始输出 `artifacts/refined-library-1280.png` |
| `notes.png` | 0.2.2 简洁笔记编辑器 | `tests/e2e/refined-workspace.spec.ts` 的元数据保留与编辑流程 |
| `pdf-reading.png` | 0.2.0 模拟 AppBridge 中的真实 PDF 页面与高亮 | `tests/e2e/workspace.spec.ts` 的 opaque iframe PDF 场景 |

书库截图取自 0.2.14 交付前的隔离浏览器测试，使用生产 UI 与独立测试服务，并非桌面宿主安装后的截图。其余图片保留所标注版本的历史界面。

测试原始截图保存在忽略的 `artifacts/` 中。更新公开截图时，先检查内容，再将选定图片复制到本目录。设计原型的截图位于 `docs/design/reader-workspace/assets/`，不要将其标注为生产实现。
