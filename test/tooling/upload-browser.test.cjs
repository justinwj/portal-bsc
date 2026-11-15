const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { it } = require('node:test');
const vm = require('node:vm');
function browser(fetch) {
  let submit, sequence = 0;
  const status = { textContent: '' }, button = { disabled: false }, navigations = [];
  const form = { elements: { file: { files: [{ name: 'a.txt', size: 3, lastModified: 1 }] }, title: { value: 'Title' }, description: { value: '' }, _csrf: { value: 'csrf' } }, querySelector: () => button, addEventListener: (_event, handler) => { submit = handler; } };
  vm.runInNewContext(readFileSync('public/js/uploads.js', 'utf8'), { document: { getElementById: id => id === 'upload-form' ? form : status }, crypto: { randomUUID: () => `key-${++sequence}` }, fetch, location: { assign: url => navigations.push(url) }, Error });
  return { submit: () => submit({ preventDefault() {} }), form, status, navigations };
}
const response = body => ({ ok: true, status: 200, json: async () => body });
it('browser explains a plain-text 429 without showing a JSON parser error or retrying automatically', async () => {
  let requests=0;const client=browser(async()=>{requests++;return{ok:false,status:429,json:async()=>{throw new SyntaxError('Unexpected token in private server text');}};});
  await client.submit();assert.match(client.status.textContent,/too many requests.*wait/i);assert.doesNotMatch(client.status.textContent,/Unexpected token|private server/);assert.equal(requests,1);assert.equal(client.navigations.length,0);
});
it('browser handles a non-JSON service failure without exposing its response body', async () => {
  const client=browser(async()=>({ok:false,status:502,json:async()=>{throw new SyntaxError('private proxy paths');}}));
  await client.submit();assert.match(client.status.textContent,/unexpected response.*status/i);assert.doesNotMatch(client.status.textContent,/private proxy/);
});
it('browser retries a lost intent acknowledgement with the same idempotency key', async () => {
  const keys = []; let first = true;
  const client = browser(async (url, options) => {
    if (url === '/uploads/intents') { keys.push(JSON.parse(options.body).idempotencyKey); if (first) { first = false; throw Error('lost intent acknowledgement'); } return response({ id: 'upload-known', state: 'reserved' }); }
    return response({ id: 'upload-known', state: 'committed' });
  });
  await client.submit(); await client.submit(); assert.equal(keys.length, 2); assert.equal(keys[0], keys[1]);
});
it('browser checks durable status after a lost body response instead of creating or uploading another file', async () => {
  let intents = 0, bodies = 0, statuses = 0;
  const client = browser(async (url, options) => {
    if (url === '/uploads/intents') { intents++; return response({ id: 'upload-known', state: 'reserved' }); }
    if (options?.method === 'PUT') { bodies++; throw Error('server committed but response was lost'); }
    statuses++; return response({ id: 'upload-known', state: 'committed' });
  });
  await client.submit(); await client.submit(); assert.equal(intents, 1); assert.equal(bodies, 1); assert.equal(statuses, 1); assert.equal(client.navigations.at(-1), '/files/upload-known');
});
it('browser prevents overlapping submissions while an intent is outstanding', async () => {
  let release; const pending = new Promise(resolve => { release = resolve; }); let intents = 0;
  const client = browser(async url => { if (url === '/uploads/intents') { intents++; await pending; return response({ id: 'upload-known', state: 'reserved' }); } return response({ id: 'upload-known', state: 'committed' }); });
  const first = client.submit(), second = client.submit(); release(); await Promise.all([first, second]); assert.equal(intents, 1);
});
it('upload form does not fall back to a GET exposing filenames or metadata in the URL', () => {
  const html = readFileSync('views/uploads.hbs', 'utf8'); assert.match(html, /<form[^>]*method="POST"/i);
});
