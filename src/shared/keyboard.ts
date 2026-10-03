import { z } from 'zod';

export const shortcutActions = ['scrollUp', 'scrollDown', 'previousChapter', 'nextChapter', 'closeHost'] as const;
export type ShortcutAction = typeof shortcutActions[number];
export const shortcutLabels: Record<ShortcutAction, string> = { scrollUp: '向上滚动', scrollDown: '向下滚动', previousChapter: '上一章', nextChapter: '下一章', closeHost: '请求关闭宿主面板' };
export const defaultKeyboard = { version: 1 as const, bindings: { scrollUp: 'ArrowUp', scrollDown: 'ArrowDown', previousChapter: 'ArrowLeft', nextChapter: 'ArrowRight', closeHost: '' } };
export type KeyboardSettings = typeof defaultKeyboard;
const reservedKeys = new Set(['Escape', 'Tab', 'Enter', 'Space', 'Backspace', 'Delete', 'Home', 'End', 'PageUp', 'PageDown']);
export function shortcutError(value: string, action: ShortcutAction, bindings: KeyboardSettings['bindings']): string | undefined {
  if (!value) return;
  const parts = value.split('+'), key = parts.at(-1)!;
  if (reservedKeys.has(key) || /^F\d+$/.test(key)) return '该按键保留给系统、宿主或界面导航';
  if (!/^Arrow(Up|Down|Left|Right)$/.test(value)) {
    // Conservative cross-platform subset: avoid Alt/AltGr, Meta/Win and common
    // browser/host commands, including modified variants of the same command.
    if (key.startsWith('Key')) return '为避免系统或宿主冲突，字母组合暂不开放';
    if (!/^Ctrl\+Shift\+(Digit[0-9]|Period|Comma|Semicolon)$/.test(value)) return '请选择方向键，或 Ctrl + Shift + 数字、句号、逗号、分号';
  }
  if (action === 'closeHost' && !value.startsWith('Ctrl+Shift+')) return '关闭宿主需要组合键';
  if (shortcutActions.some(other => other !== action && bindings[other] === value)) return '与 Reader 的另一动作重复';
}
const bindingsSchema = z.object({ scrollUp: z.string().max(60), scrollDown: z.string().max(60), previousChapter: z.string().max(60), nextChapter: z.string().max(60), closeHost: z.string().max(60) }).strict();
export const keyboardSchema = z.object({ version: z.literal(1), bindings: bindingsSchema }).strict().superRefine((value, ctx) => {
  for (const action of shortcutActions) { const error = shortcutError(value.bindings[action], action, value.bindings); if (error) ctx.addIssue({ code: 'custom', message: error, path: ['bindings', action] }); }
});
export function eventShortcut(event: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>): string {
  return [event.ctrlKey && 'Ctrl', event.shiftKey && 'Shift', event.altKey && 'Alt', event.metaKey && 'Meta', event.code].filter(Boolean).join('+');
}
export function editableTarget(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="slider"]');
}
export const displayShortcut = (value: string) => value ? value.replace('Key', '').replace('Digit', '').replace('Period', '.').replace('Comma', ',').replace('Semicolon', ';').replace('ArrowUp', '↑').replace('ArrowDown', '↓').replace('ArrowLeft', '←').replace('ArrowRight', '→').replaceAll('+', ' + ') : '未设置';
