import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import * as fs from 'node:fs/promises';
import { tmpdir, devNull } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { httpAuthorizationEnvironment } from '../../distribution/git-http.mjs';
const run = promisify(execFile);

test('Git sends one scoped CI header even when checkout already supplied authorization', async () => {
  const headers = [], server = createServer((request, response) => {
    const actual = [];
    for (let i = 0; i < request.rawHeaders.length; i += 2) if (request.rawHeaders[i].toLowerCase() === 'authorization') actual.push(request.rawHeaders[i + 1]);
    headers.push(actual);
    response.writeHead(404); response.end('Synthetic local Git endpoint; no repository is published.');
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const cwd = await fs.mkdtemp(join(tmpdir(), 'reader-publish-auth-'));
  const base = { ...process.env, GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_COUNT: '0', NO_PROXY: '127.0.0.1', no_proxy: '127.0.0.1' };
  const origin = `http://127.0.0.1:${server.address().port}/`;
  try {
    await run('git', ['init', '--bare', '.'], { cwd, env: base });
    await run('git', ['config', `http.${origin}.extraheader`, 'AUTHORIZATION: synthetic-checkout-header'], { cwd, env: base });
    await assert.rejects(run('git', ['ls-remote', `${origin}reader-test.git`], { cwd, env: { ...base, ...httpAuthorizationEnvironment(origin, 'synthetic-ci-header') }, timeout: 10000 }));
    assert.ok(headers.length > 0, 'The real Git HTTP request did not reach the synthetic server.');
    for (const actual of headers) assert.deepEqual(actual, ['synthetic-ci-header']);
    assert.equal((await run('git', ['config', '--get', `http.${origin}.extraheader`], { cwd, env: base })).stdout.trim(), 'AUTHORIZATION: synthetic-checkout-header', 'Persistent Git configuration must remain unchanged.');
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await fs.rm(cwd, { recursive: true, force: true });
  }
});
