# Reader 书源导入样例

`reader-demo.json` 是一个可直接导入的 Legado 无脚本子集书源；`reader-demo-array.json` 是同一书源的数组形式。文本由本项目为验收原创，不来自第三方书库，无账号、密钥、脚本或付费内容。

1. 在 Reader 书架打开“在线书源”，选择“导入书源 JSON”。
2. 选择本地 JSON 文件，或把下面的 URL 粘到“书源 JSON URL”并点击“预览 URL 导入”。
3. 核对预览和字段诊断，确认导入，再启用“Reader 原创公开示例”。
4. 选择该书源，输入“河岸”并搜索，打开详情后加入书架并阅读。
5. 目录有两章。第一章的第二页应自动接到正文中；下一章为“灯下回信”。可以保存书签，返回书架后重新打开。

单源 URL：<https://raw.githubusercontent.com/Quiyyy/reader-plugin/refs/heads/main/examples/online/reader-demo.json>

数组 URL：<https://raw.githubusercontent.com/Quiyyy/reader-plugin/refs/heads/main/examples/online/reader-demo-array.json>

如果当前网络无法访问 GitHub 原始文件域名，可直接导入固定提交的 CDN 版本：[单源 JSON](https://cdn.jsdelivr.net/gh/Quiyyy/reader-plugin@5097d546292063e3787fd46aada636031e73caf9/reader-demo-cdn.json)、[数组 JSON](https://cdn.jsdelivr.net/gh/Quiyyy/reader-plugin@5097d546292063e3787fd46aada636031e73caf9/reader-demo-cdn-array.json)、[使用说明](https://github.com/Quiyyy/reader-plugin/blob/5097d546292063e3787fd46aada636031e73caf9/README.md)。它们使用同一份原创正文，源名为“Reader 原创公开示例 CDN”。网络超时仍会明确报错，可以稍后重试，不需要修改代理、证书或安全策略。

这是固定示例目录，任意关键词都会返回同一本书，下一页为空，用于验证导入与阅读链路，不是通用搜索服务。首次读取需要能访问 GitHub 原始文件域名；只读过的章节有离线缓存。停用或移除书源后缓存仍可读，未读章节需要重新启用可用书源才能联网获取。在线正文搜索只覆盖当前章节。

示例对本项目的有限解释器进行了验证，不代表所有 Legado 书源都兼容。不支持 JS、登录、WebView、访问控制绕过、付费 DRM 或复杂未知规则。测试宿主的本地网络例外只存在于测试脚本内，正式 Reader 不接受 localhost/私网书源。
