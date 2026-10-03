import React, { useState } from 'react';
import { ChevronDown, RotateCcw, X } from 'lucide-react';
import { displayShortcut, eventShortcut, shortcutActions, shortcutError, shortcutLabels, type KeyboardSettings, type ShortcutAction } from '../shared/keyboard';

type Props = {
  value: KeyboardSettings;
  error: string;
  closeStatus: string;
  searchLabel: string;
  onSave(value: KeyboardSettings): Promise<void>;
  onReset(): Promise<void>;
  onCloseHost(): Promise<void>;
  onDismissCloseStatus(): void;
};

export function KeyboardEditor({ value, error, closeStatus, searchLabel, onSave, onReset, onCloseHost, onDismissCloseStatus }: Props) {
  const [recording, setRecording] = useState<ShortcutAction | null>(null), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const save = async (next: KeyboardSettings) => {
    setBusy(true);
    try { await onSave(next); setRecording(null); setMessage('快捷键已保存'); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : '保存失败'); }
    finally { setBusy(false); }
  };
  const bindingRow = (action: ShortcutAction) => <div className="shortcut-setting" key={action}>
    <span>{action === 'closeHost' ? '关闭 Reader 面板' : shortcutLabels[action]}</span>
    <button type="button" className="shortcut-binding" disabled={busy} aria-label={`录制${shortcutLabels[action]}`} aria-pressed={recording === action} onClick={() => { setRecording(action); setMessage('按下新组合，Esc 取消；也可展开「使用说明」。'); }} onBlur={() => setRecording(null)} onKeyDown={event => {
      if (recording !== action || event.nativeEvent.isComposing || event.keyCode === 229 || event.getModifierState('AltGraph') || event.repeat) return;
      event.stopPropagation();
      if (event.key === 'Tab') { setRecording(null); return; }
      event.preventDefault();
      if (event.key === 'Escape') { setRecording(null); setMessage('已取消录制'); return; }
      if (/^(Control|Shift|Alt|Meta)$/.test(event.key)) return;
      const binding = eventShortcut(event.nativeEvent), issue = shortcutError(binding, action, value.bindings);
      if (issue) { setMessage(issue); return; }
      void save({ version: 1, bindings: { ...value.bindings, [action]: binding } });
    }}>{recording === action ? '请按组合…' : displayShortcut(value.bindings[action])}</button>
    <button type="button" className="icon-button shortcut-clear" disabled={busy || !value.bindings[action]} aria-label={`清除${shortcutLabels[action]}`} title="清除快捷键" onClick={() => void save({ version: 1, bindings: { ...value.bindings, [action]: '' } })}><X size={14} /></button>
  </div>;
  return <div className="keyboard-editor">
    <p className="keyboard-intro">点击按键即可修改，仅在 Reader 内生效。</p>
    <section className="shortcut-group" aria-label="阅读快捷键"><h3>阅读</h3>{shortcutActions.filter(action => action !== 'closeHost').map(bindingRow)}</section>
    <section className="shortcut-group" aria-label="面板快捷键"><h3>面板</h3>{bindingRow('closeHost')}<div className="shortcut-host-note"><span>关闭由所在应用响应</span><button type="button" className="text-button" aria-label="请求关闭宿主面板" onClick={() => void onCloseHost()}>尝试关闭</button></div></section>
    {(error || message) && <p className="keyboard-feedback" role="status">{error || message}</p>}
    {closeStatus && <div className="host-close-message" role="status"><span>{closeStatus}</span><button type="button" className="text-button" onClick={onDismissCloseStatus}>知道了</button></div>}
    <details className="keyboard-details"><summary>其他按键<ChevronDown size={14} aria-hidden="true" /></summary><dl className="shortcut-list"><div><dt>上一章 / 下一章</dt><dd><kbd>[</kbd><kbd>]</kbd></dd></div><div><dt>打开 / 关闭目录</dt><dd><kbd>T</kbd></dd></div><div><dt>收藏 / 取消当前段落</dt><dd><kbd>B</kbd></dd></div><div><dt>{searchLabel}</dt><dd><kbd>F</kbd></dd></div><div><dt>返回 / 关闭 Reader 弹层</dt><dd><kbd>Esc</kbd></dd></div><div><dt>快捷键帮助</dt><dd><kbd>?</kbd></dd></div></dl><p>书架方向键移动焦点，Enter 打开；正文空格翻屏。Esc 不关闭宿主面板。</p></details>
    <details className="keyboard-details"><summary>使用说明<ChevronDown size={14} aria-hidden="true" /></summary><p>默认 ↑↓ 滚动 80px，←→ 切换章节。输入框、可编辑区域和中文组词时不触发。</p><p>阅读操作可用方向键；组合键可用 Ctrl + Shift + 数字或标点。会检查 Reader 内重复与已知保留键，无法枚举所在应用的自定义快捷键。</p><p>关闭面板默认未绑定，需要使用组合键。所在应用没有关闭接口或未响应时，请使用它的关闭按钮。</p></details>
    <footer className="keyboard-footer"><button type="button" className="text-button" aria-label="恢复默认快捷键" disabled={busy} onClick={async () => { setBusy(true); try { await onReset(); setRecording(null); setMessage('已恢复默认快捷键'); } catch (reason) { setMessage(String(reason)); } finally { setBusy(false); } }}><RotateCcw size={13} />恢复默认</button><span>修改后自动保存</span></footer>
  </div>;
}
