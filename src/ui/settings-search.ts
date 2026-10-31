import {shortcutActions,shortcutLabels} from '../shared/keyboard';
import type {SettingsSection} from './settings-types';

export interface SettingEntry {section:SettingsSection;label:string;selector:string;keywords?:string;scope?:'text'|'epub';vault?:boolean;disclosure?:string;}
const row=(title:string)=>`[data-setting="${title}"]`;
export const settingEntries:SettingEntry[]=[
  {section:'general',label:'默认书库视图',selector:row('默认视图'),keywords:'网格 列表'},
  {section:'general',label:'默认书库排序',selector:row('默认排序'),keywords:'最近访问 名称'},
  {section:'appearance',label:'界面模式',selector:row('模式'),keywords:'主题 浅色 深色 跟随系统'},
  {section:'appearance',label:'强调色',selector:row('强调色'),keywords:'颜色 自定义'},
  {section:'appearance',label:'阅读纸色',selector:row('阅读纸色'),keywords:'白纸 暖纸'},
  {section:'reading',label:'阅读字体',selector:row('字体'),scope:'text',keywords:'宋体 黑体 衬线'},
  {section:'reading',label:'阅读字号',selector:row('字号'),scope:'text',keywords:'字体 大小'},
  {section:'reading',label:'行间距',selector:row('行间距'),scope:'text',keywords:'行距'},
  {section:'reading',label:'正文宽度',selector:row('正文宽度'),scope:'text',keywords:'行宽'},
  {section:'reading',label:'EPUB 排版',selector:row('排版'),scope:'epub',keywords:'EPUB 舒适 原书'},
  {section:'reading',label:'EPUB 阅读方式',selector:row('阅读方式'),scope:'epub',keywords:'EPUB 翻页 滚动'},
  {section:'notes',label:'笔记字号',selector:row('默认字号'),keywords:'默认 字体 大小'},
  {section:'notes',label:'默认编辑模式',selector:row('默认编辑模式'),keywords:'源码 排版'},
  {section:'notes',label:'格式工具栏',selector:row('格式工具栏'),keywords:'显示 编辑'},
  {section:'bots',label:'Bot 名称',selector:'[aria-label="Bot 名称"]',keywords:'AI 助手'},
  {section:'bots',label:'Bot 用途',selector:'[aria-label="Bot 用途"]',keywords:'描述'},
  {section:'bots',label:'Bot 指令',selector:'[aria-label="Bot 指令"]',keywords:'职责 表达 偏好'},
  {section:'bots',label:'Bot 模型',selector:'.note-bot-page-options .study-model-trigger',keywords:'默认 AI'},
  {section:'bots',label:'默认 Bot',selector:'.note-bot-page-options input',keywords:'助手'},
  {section:'sync',label:'Google Drive 连接',selector:'.sync-account-row',keywords:'账户 授权 同步 暂停'},
  {section:'sync',label:'代理连接方式',selector:'#sync-proxy-mode',keywords:'Clash 网络 HTTP HTTPS 直连'},
  {section:'sync',label:'代理地址',selector:'#sync-proxy-url, #sync-proxy-mode',keywords:'Clash 端口 网络'},
  {section:'sync',label:'同步设备名称',selector:'#sync-device-name',vault:true,keywords:'此电脑'},
  {section:'sync',label:'同步书籍原文件',selector:'[aria-label="同步书籍原文件"]',vault:true,keywords:'原书 下载'},
  {section:'sync',label:'同步外观与快捷键',selector:'[aria-label="同步外观与快捷键"]',vault:true,keywords:'偏好 设置'},
  {section:'sync',label:'恢复密钥',selector:'[data-setting="恢复密钥"]',vault:true,disclosure:'sync-management',keywords:'其他电脑 连接 加密'},
  {section:'sync',label:'其他设备的阅读位置',selector:'[aria-label="查看同步阅读位置的书籍"]',vault:true,disclosure:'sync-management',keywords:'书签 进度'},
  ...shortcutActions.map(action=>({section:'keyboard' as const,label:'快捷键：'+shortcutLabels[action],selector:`[aria-label="录制${shortcutLabels[action]}"]`,keywords:'键盘 按键 组合键'})),
  {section:'sources',label:'导入书源',selector:'.settings-sources .discovery-heading button',keywords:'在线 来源 JSON'},
  {section:'sources',label:'搜索与管理书源',selector:'[aria-label="搜索书源名称或域名"], .settings-sources .discovery-heading button',keywords:'启用 停用 规则'},
  {section:'data',label:'书库位置',selector:row('书库位置'),keywords:'本地 目录 路径 存储'},
  {section:'data',label:'Reader 版本',selector:row('版本'),keywords:'数据 关于'},
];
