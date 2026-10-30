import { z } from 'zod';

export const preferencesSchema=z.object({
  librarySort:z.enum(['visited','name']).optional(),
  noteMode:z.enum(['visual','source']).optional(),
  noteToolbar:z.boolean().optional(),
}).strict();
export type WorkspacePreferences=z.infer<typeof preferencesSchema>;
export const defaultPreferences:Required<WorkspacePreferences>={librarySort:'visited',noteMode:'visual',noteToolbar:false};
