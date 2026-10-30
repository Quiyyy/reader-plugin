import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite, type ReaderStore } from './store.js';
import { defaultNoteBots, noteBotSchema, noteBotsSchema, type NoteBot, type NoteBots } from '../shared/note-bots.js';

export class NoteBotStore {
  private readonly path: string;
  constructor(private readonly store: ReaderStore) { this.path = join(store.dataDir, 'study-v1', 'note-bots.json'); }
  async list(): Promise<NoteBots> {
    try { return noteBotsSchema.parse(JSON.parse(await fs.readFile(this.path, 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return structuredClone(defaultNoteBots); throw error; }
  }
  async resolve(id?: string): Promise<NoteBot> {
    const state = await this.list(), bot = state.bots.find(bot => bot.id === (id ?? state.defaultId));
    if (!bot) throw Error('Note Bot 已移除，请重新选择');
    return bot;
  }
  private async mutate(revision: number, edit: (state: NoteBots) => void) {
    return this.store.locked('note-bots', async () => {
      const state = await this.list();
      if (state.revision !== revision) throw Error('Note Bots 已在另一个窗口更新，请重新打开设置');
      edit(state); state.revision++;
      const checked = noteBotsSchema.parse(state);
      await fs.mkdir(join(this.store.dataDir, 'study-v1'), { recursive: true, mode: 0o700 });
      await atomicWrite(this.path, JSON.stringify(checked));
      return checked;
    });
  }
  async save(revision: number, input: NoteBot, makeDefault = false) {
    const bot = noteBotSchema.parse(input);
    return this.mutate(revision, state => {
      const at = state.bots.findIndex(item => item.id === bot.id);
      if (at < 0) state.bots.push(bot); else state.bots[at] = bot;
      if (makeDefault) state.defaultId = bot.id;
    });
  }
  remove(revision: number, id: string) {
    return this.mutate(revision, state => {
      if (!state.bots.some(bot => bot.id === id)) throw Error('Note Bot 已移除');
      if (state.bots.length === 1) throw Error('请至少保留一个 Note Bot');
      state.bots = state.bots.filter(bot => bot.id !== id);
      if (state.defaultId === id) state.defaultId = state.bots[0]!.id;
    });
  }
}
