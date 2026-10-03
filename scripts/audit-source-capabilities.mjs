// Supply the user's existing JSON file. Never download/publish the collection.
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { importSources, stageKeys } from '../dist/server/online/import.js';
const bytes = await fs.readFile(process.argv[2]);
const sha256 = createHash('sha256').update(bytes).digest('hex');
if (sha256 !== '00644eda44f0fcabcfc015a024480376638d5e7a381a2010aeedfca5aa797845') throw Error('Input does not match the fixed 22-source baseline');
const sources = importSources(bytes.toString()).map(({raw,report}) => ({
  name: report.name, url: report.url, syntax: report.syntax,
  stages: Object.fromEntries(Object.entries(report.stages).map(([stage, value]) => [stage, { ...value,
    canAttempt: ['supported','partial'].includes(value.syntax),
    browserMentioned: /startBrowserAwait|webView/.test(JSON.stringify([raw[stageKeys[stage]], stage==='search'?raw.searchUrl:''])),
    ajaxMentioned: /java\.ajax/.test(JSON.stringify([raw[stageKeys[stage]], stage==='search'?raw.searchUrl:''])),
  }])), diagnostics: report.diagnostics,
}));
console.log(JSON.stringify({ baseline: 'XIU2/Yuedu@426b24f59aa763ee0f2d9cc094612d2ef42c8293/shuyuan', sha256, sourceCount:sources.length,
  networkRequests:0, executableSearch:sources.filter(s=>s.stages.search.canAttempt).length,
  executableAllStages:sources.filter(s=>Object.values(s.stages).every(v=>v.canAttempt)).length,
  note:'Static acceptance is not website availability; scripts, hosts, login/challenges, and quotas still checked at runtime.', sources }, null, 2));
