import React, { useState } from 'react';
import { displayShortcut, eventShortcut, shortcutActions, shortcutError, shortcutLabels, type KeyboardSettings, type ShortcutAction } from '../shared/keyboard';

export function KeyboardEditor({ value, error, onSave, onReset, onCloseHost }: { value: KeyboardSettings; error: string; onSave(value: KeyboardSettings): Promise<void>; onReset(): Promise<void>; onCloseHost(): Promise<void> }) {
  const [recording, setRecording] = useState<ShortcutAction | null>(null), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const save = async (next: KeyboardSettings) => {
    setBusy(true);
    try { await onSave(next); setRecording(null); setMessage('快捷键已保存'); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : '保存失败'); }
    finally { setBusy(false); }
  };
  return <div className="keyboard-editor">
    <p>正文默认 ↑↓ 滚动 80px，←→ 切换章节。仅 Reader 内获得焦点时生效，输入和中文组词时不处理。</p>
    {shortcutActions.map(action => <div className="shortcut-setting" key={action}><span>{shortcutLabels[action]}</span><button type="button" className="secondary-button" disabled={busy} aria-label={`录制${shortcutLabels[action]}`} aria-pressed={recording === action} onClick={() => { setRecording(action); setMessage('按下新组合；Esc 取消。方向键可用于阅读，组合键可用 Ctrl + Shift + 数字或标点。'); }} onBlur={() => setRecording(null)} onKeyDown={event => {
      if (recording !== action || event.nativeEvent.isComposing || event.keyCode === 229 || event.getModifierState('AltGraph') || event.repeat) return;
      event.stopPropagation();
      if (event.key === 'Tab') { setRecording(null); return; }
      event.preventDefault();
      if (event.key === 'Escape') { setRecording(null); setMessage('已取消录制'); return; }
      if (/^(Control|Shift|Alt|Meta)$/.test(event.key)) return;
      const binding = eventShortcut(event.nativeEvent), issue = shortcutError(binding, action, value.bindings);
      if (issue) { setMessage(issue); return; }
      void save({ version: 1, bindings: { ...value.bindings, [action]: binding } });
    }}>{recording === action ? '请按组合…' : displayShortcut(value.bindings[action])}</button><button type="button" className="text-button" disabled={busy || !value.bindings[action]} aria-label={`清除${shortcutLabels[action]}`} onClick={() => void save({ version: 1, bindings: { ...value.bindings, [action]: '' } })}>清除</button></div>)}
    {(error || message) && <p role="status">{error || message}</p>}
    <div className="keyboard-buttons"><button className="text-button" disabled={busy} onClick={async () => { setBusy(true); try { await onReset(); setRecording(null); setMessage('已恢复默认快捷键'); } catch (reason) { setMessage(String(reason)); } finally { setBusy(false); } }}>恢复默认快捷键</button><button className="text-button" onClick={() => void onCloseHost()}>请求关闭宿主面板</button></div>
    <p className="shortcut-note">关闭默认未绑定。检查 Reader 重复及已知保留键；无法枚举宿主自定义键。关闭请求由宿主决定，未响应时请用宿主关闭按钮。</p>
  </div>;
}
