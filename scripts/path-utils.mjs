import path from 'node:path';
import { realpath } from 'node:fs/promises';

export function isWithin(root, candidate, paths = path) {
  const relative = paths.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${paths.sep}`) && !paths.isAbsolute(relative));
}

export async function externalDirectory(root, candidate) {
  const [realRoot, realCandidate] = await Promise.all([realpath(root), realpath(candidate)]);
  if (isWithin(realRoot, realCandidate)) throw new Error('Keep acceptance books outside the repository');
  return realCandidate;
}
