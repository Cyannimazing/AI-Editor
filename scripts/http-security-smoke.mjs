import assert from 'node:assert/strict';
const origin = 'http://localhost:3000';
const send = (path, options) => fetch(origin + path, { ...options, redirect: 'error' });
const rejected = async (path, options) => {
  const response = await send(path, options);
  assert.ok(response.status >= 400 && response.status < 500, `Expected client rejection: ${path}, got ${response.status}`);
};
await rejected('/api/helper', {});
await rejected('/api/session', { method: 'POST', headers: { origin: 'https://hostile.example', 'x-ai-editor': '1' } });
const response = await send('/api/session', { method: 'POST', headers: { origin, 'x-ai-editor': '1' } });
assert.equal(response.status, 200);
const cookie = response.headers.get('set-cookie').split(';')[0];
for (const headers of [{ origin: 'https://hostile.example' }, { 'sec-fetch-site': 'cross-site' }, { host: 'hostile.example' }]) {
  await rejected('/api/helper', { method: 'POST', headers: { cookie, origin, 'x-ai-editor': '1', 'content-type': 'application/json', ...headers }, body: '{}' });
}
await rejected('/api/helper', { headers: { cookie: cookie.slice(0, -1) + (cookie.endsWith('a') ? 'b' : 'a') } });
assert.equal((await send('/api/helper', { headers: { cookie } })).status, 200);
console.log(JSON.stringify({ passed: true, checked: ['anonymous read', 'cross-origin bootstrap', 'cross-origin mutation', 'cross-site fetch', 'forged host', 'forged cookie', 'authenticated read'], projectMutations: 0 }));
