import type { TextCompatibility } from '../shared/types.js';

/** Parse-only compatibility. Never change the upload Buffer or infer an encoding. */
export function compatibleTextControls(text: string, encoding: string): { text: string; compatibility?: TextCompatibility } {
  const compatibility: TextCompatibility = { version: 1, paddingCharacters: 0, paddingLines: 0, formFeeds: 0, verticalTabs: 0, terminalEof: 0 };
  // DOS EOF is accepted only at the last non-whitespace position, never as a
  // request to truncate the rest of a book. Multiple/interior SUBs still fail.
  const terminalEof = /\x1a[ \t\u3000\n]*$/.exec(text)?.index;
  let offset = 0, unknown = 0;
  const locations: string[] = [];
  const lines = text.split('\n').map((line, index) => {
    // Recognize this narrow, observed standalone padding shape on ORIGINAL
    // lines. Formatting controls must not create new eligible padding lines.
    const padding = /^([ \t\u3000]*)([\x01-\x08\x0e-\x10]+)([ \t\u3000]*)$/.exec(line);
    const run = padding?.[2];
    let result = line;
    if (run && run.length === run.charCodeAt(0) && run === run[0]!.repeat(run.length)) {
      compatibility.paddingCharacters += run.length;
      compatibility.paddingLines++;
      result = padding![1]! + padding![3]!;
    } else {
      result = line.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, (char: string, column: number) => {
        // VT and FF are format effectors (RFC 20). Preserve separation rather
        // than joining neighboring words; FF starts a new reading paragraph.
        if (char === '\x0b') { compatibility.verticalTabs++; return '\n'; }
        if (char === '\x0c') { compatibility.formFeeds++; return '\n\n'; }
        if (char === '\x1a' && offset + column === terminalEof) { compatibility.terminalEof++; return ''; }
        unknown++;
        if (locations.length < 3) locations.push(`U+${char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}（第 ${index + 1} 行第 ${Array.from(line.slice(0, column)).length + 1} 列）`);
        return char;
      });
    }
    offset += line.length + 1;
    return result;
  });
  if (unknown) throw new Error(`TXT 中有 ${unknown} 个无法安全处理的控制字符（编码 ${encoding}）：${locations.join('、')}${unknown > locations.length ? '等' : ''}。请确认原始编码；若编码正确，请检查这些位置或重新导出纯文本后重试。`);
  const normalized = lines.join('\n');
  // Keep the binary-control gate even after the narrow compatibility rules.
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(normalized)) throw new Error('TXT 仍含异常控制字符，请确认原始编码或重新导出纯文本后重试。');
  const count = compatibility.paddingCharacters + compatibility.formFeeds + compatibility.verticalTabs + compatibility.terminalEof;
  return { text: normalized, ...(count ? { compatibility } : {}) };
}
