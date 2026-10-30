import { z } from 'zod';
import { entityIdSchema } from './workspace.js';

export const noteBotSchema = z.object({
  id: entityIdSchema,
  name: z.string().trim().min(1).max(32).regex(/^[^@\r\n]+$/, '名称不能包含 @ 或换行'),
  description: z.string().trim().max(120),
  instructions: z.string().trim().min(1).max(8000),
  model: z.string().trim().min(1).max(200).nullable().default(null),
}).strict();
export type NoteBot = z.infer<typeof noteBotSchema>;
export const noteBotsSchema = z.object({
  version: z.literal(1), revision: z.number().int().nonnegative(),
  defaultId: entityIdSchema, bots: z.array(noteBotSchema).min(1).max(24),
}).strict().refine(value => value.bots.some(bot => bot.id === value.defaultId), '默认 Bot 不存在')
  .refine(value => new Set(value.bots.map(bot => bot.id)).size === value.bots.length, 'Bot 标识重复')
  .refine(value => new Set(value.bots.map(bot => bot.name.toLocaleLowerCase())).size === value.bots.length, 'Bot 名称重复');
export type NoteBots = z.infer<typeof noteBotsSchema>;
export const defaultNoteBots: NoteBots = {
  version: 1, revision: 0, defaultId: '4d4d2a30-4db9-43d5-8049-992abedc1a01',
  bots: [{ id: '4d4d2a30-4db9-43d5-8049-992abedc1a01', name: '笔记助手', description: '整理思路、润色表达、提炼重点',
    instructions: '帮助用户把零散想法整理为清晰、准确的笔记。保留原意，不编造事实。按用户要求润色、解释、总结或续写；默认使用中文。', model: null }],
};
