# 第三方声明

Reader 的项目原创代码和文档采用 [MIT License](LICENSE)。该许可证不替代第三方代码、运行时或素材的原有条款。

| 内容 | 来源与声明 |
| --- | --- |
| JavaScript 依赖 | 精确版本见 `package-lock.json`；各包保留原有 LICENSE／NOTICE |
| 补充依赖声明 | [distribution/licenses](distribution/licenses)，固定来源与摘要见 [sources.json](distribution/licenses/sources.json) |
| Foliate 实验代码 | [experiments/epub/vendor/foliate/LICENSE](experiments/epub/vendor/foliate/LICENSE)，用途与固定版本见 [实验说明](experiments/epub/README.md) |
| 自包含平台运行时 | 官方 Node.js 和 Go runtime 的许可证随对应平台包保存 |

运行包构建会生成 `DEPENDENCIES.json` 和包内 `THIRD_PARTY_NOTICES.md`，并复制所需的项目及依赖许可证。许可证缺失或来源摘要不一致会使构建失败。运行包不包含用户书籍、笔记或测试书库。

仓库中的原创测试材料与界面截图用于说明和回归测试；截图清单见 [docs/images](docs/images/README.md)，设计原型素材见 [产品交互实验室](docs/design/reader-workspace/README.md)。
