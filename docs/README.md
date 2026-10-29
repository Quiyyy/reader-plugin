# 文档

源码版本以 [package.json](../package.json) 为准。使用说明描述当前实现；标注日期、版本的验收与设计记录只代表当时的范围，不代表所有发行包或宿主均已支持。

## 使用 Reader

| 文档 | 内容 |
| --- | --- |
| [安装指南](INSTALL.md) | 安装方式选择、运行包、升级与回退 |
| [使用指南](USAGE.md) | 阅读、笔记、Codex、Space、数据与备份 |
| [Windows 源码接入](WINDOWS.md) | Windows 原生 Node 与本地 marketplace |
| [平台 marketplace](MARKETPLACE.md) | 自包含平台包、平台限制和分发机制 |
| [在线书源](online-sources.md) | 导入、配置和规则范围 |
| [EPUB 格式范围](EPUB_CANDIDATE.md) | 排版、资源、定位及尚不支持的特性 |
| [TXT 兼容规则](TXT_COMPATIBILITY.md) | 编码后的格式字符处理 |

## 参与开发

| 文档 | 内容 |
| --- | --- |
| [贡献指南](../CONTRIBUTING.md) | Issue、Pull Request、测试材料与提交约定 |
| [开发指南](DEVELOPMENT.md) | 本地运行、环境变量、命令、目录结构与验证 |
| [架构说明](ARCHITECTURE.md) | UI、MCP、持久化、格式适配和安全边界 |
| [安全政策](../SECURITY.md) | 安全问题报告渠道与测试边界 |
| [第三方声明](../THIRD_PARTY_NOTICES.md) | 依赖、实验代码与分发许可证 |
| [Windows 单包交付](WINDOWS_DELIVERY.md) | 构建、打包、验收、安装与恢复 |
| [本地更新方案](LOCAL_UPDATES.md) | 无需重启 Codex 的交付流程、Windows 限制与后续替代方案 |
| [UI 原型工具](../tools/ui-lab/README.md) | 静态交互原型和图文文档预览 |

## 版本与设计

- [更新记录](../CHANGELOG.md)：面向使用者的变更摘要与版本说明入口。
- [0.2.13 整理与阅读体验](RELEASE_0.2.13.md)：递归搜索、回收与恢复、Markdown、窄屏阅读和交互细节。
- [0.2.5 笔记主导航收起](RELEASE_0.2.5.md)：编辑页默认隐藏主导航，菜单按需展开。
- [0.2.4 当前笔记目录](RELEASE_0.2.4.md)：默认收起、阅读页同款入口与当前笔记标题导航。
- [0.2.3 笔记协作与按需上下文](RELEASE_0.2.3.md)：列表折叠、全高编辑、截图标注及 app-only 工具。
- [0.2.2 精简界面与模型选择](RELEASE_0.2.2.md)：默认当前书籍范围、模型切换、精简元数据与文件夹界面。
- [0.2.0 范围与本地验收](RELEASE_0.2.0.md)：工作台、PDF、笔记、阅读浮窗及验证边界。
- [产品设计](design/reader-workspace/PRODUCT_DESIGN.md) 与 [交互实验室](design/reader-workspace/README.md)：设计依据和可运行原型；原型使用模拟回复。
- [0.2.0 实施记录](IMPLEMENTATION_0.2.md)：设计到实现的简要对应记录。
- [公开截图](images/README.md)：正式界面截图及原创样本来源。

## 历史与专题记录

这些资料保留原有文件路径，便于追溯已有链接和问题讨论。涉及“当前”“已通过”的描述应结合文档所写版本、日期与对应提交理解。

- 验收与宿主：[历史验收](ACCEPTANCE.md)、[宿主路由调查](HOST_ROUTING.md)、[样本语料](CORPUS.md)、[在线书源实测](LIVE_SOURCE_ACCEPTANCE.md)。
- 阅读交互：[紧凑 UI](UI_COMPACT.md)、[书库与快捷键](LIBRARY_KEYBOARD_CANDIDATE.md)、[找书设计](DISCOVERY_DESIGN.md)。
- 规则兼容：[声明式规则](DECLARATIVE_COMPATIBILITY.md)、[隔离脚本](ISOLATED_COMPATIBILITY.md)、[0.1.9 规则限额审查](RULE_LIMITS_AUDIT_0.1.9.md)。
- EPUB 实验：[实验与选型](../experiments/epub/README.md)。

原始测试输出默认放在被 Git 忽略的 `artifacts/`，文档里的本地证据路径不是仓库附件。请按开发指南重新生成；发布截图和报告前先确认没有个人内容。
