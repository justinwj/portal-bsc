import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import { CouchDbService } from '../../src/common/couchdb.service';
import { UserRole } from '../../src/common/roles';
import { UsersService } from '../../src/users/users.service';
import { browser, dependencyUrl, formToken, launchApplication, within } from './support';

const nano = require('nano');
describe('real CouchDB/Redis production account-management HTTP', { concurrency: false, timeout: 60000 }, () => {
  let app: Awaited<ReturnType<typeof launchApplication>>, couch: CouchDbService, client: any;
  let actorId: string, otherId: string, memberId: string, names: string[];
  const password = 'AccountIntegration123';
  before(async () => {
    client = nano(dependencyUrl('COUCHDB_URL'));
    couch = new CouchDbService(); await couch.initialize({ allowMemoryFallback: false });
    app = await launchApplication(); await within(app.ready, 15000, 'Production account test app startup failed');
  });
  after(async () => { await app?.close(); });
  beforeEach(async () => {
    names = ['actor', 'other', 'member'].map(n => `account-${n}-${randomUUID()}`);
    const users = new UsersService(couch);
    const created = [];
    for (let i=0; i<names.length; i++) created.push(await users.createUser({ username: names[i], email: `${i}@example.test`, password,
      role: i === 2 ? UserRole.MEMBER : UserRole.ADMIN }));
    [actorId, otherId, memberId] = created.map(u => u._id!);
  });
  async function login(index = 0) {
    const http = browser(app.url); const page = await http.request('/login');
    const result = await http.request('/login', { username: names[index], password, _csrf: formToken(page.body) });
    assert.equal(result.headers.get('location'), '/', result.body);
    return { http, token: formToken((await http.request('/')).body) };
  }
  async function change(actor: Awaited<ReturnType<typeof login>>, id: string, active: boolean) {
    return actor.http.request(`/admin/users/${id}/${active ? 'enable' : 'disable'}`, { _csrf: actor.token, confirmed: 'yes' });
  }
  it('rejects self-disable and preserves both the stored administrator and Redis session', async () => {
    const actor = await login(); assert.equal((await change(actor, actorId, false)).status, 403);
    assert.equal((await client.use('portal_users').get(actorId)).isActive, true);
    assert.equal((await actor.http.request('/admin/users')).status, 200);
  });
  it('persists status, revocation version, original account data and correctly attributed audit events', async () => {
    const actor = await login(); const original = await client.use('portal_users').get(memberId);
    assert.equal((await change(actor, memberId, false)).status, 302);
    const disabled = await client.use('portal_users').get(memberId); assert.equal(disabled.isActive, false);
    assert.equal(disabled.sessionVersion, (original.sessionVersion ?? 0) + 1);
    assert.equal((await change(actor, memberId, true)).status, 302);
    const fresh = new CouchDbService(); await fresh.initialize({ allowMemoryFallback: false });
    const enabled = await fresh.findUserById(memberId); assert.equal(enabled!.isActive, true);
    for (const key of ['username','email','role','passwordHash']) assert.equal(enabled![key], original[key]);
    const records = (await client.use('portal_audit').list({ include_docs: true })).rows.map((r: any) => r.doc)
      .filter((d: any) => d.details?.targetUserId === memberId);
    assert.deepEqual(records.map((d: any) => d.event).sort(), ['user.disabled','user.enabled']);
    for (const d of records) {
      assert.equal(d.userId, actorId); assert.equal(d.username, names[0]); assert.equal(d.details.targetUsername, names[2]);
      assert.ok(d.createdAt); assert.ok(d.ip); assert.notEqual(d.details.previousStatus, d.details.newStatus);
      assert.doesNotMatch(JSON.stringify(d), /passwordHash|AccountIntegration123|csrf|connect\.sid/);
    }
  });
  it('rejects old Redis sessions after disable/enable even when never used during the disabled interval', async () => {
    const actor = await login(), member = await login(2); const cookie = member.http.cookie;
    assert.equal((await change(actor, memberId, false)).status, 302);
    assert.equal((await change(actor, memberId, true)).status, 302);
    assert.equal((await member.http.request('/', undefined, cookie)).status, 401);
    assert.equal((await (await login(2)).http.request('/')).status, 200);
  });
  it('requires a fresh login when enabling a legacy disabled account without a session version', async () => {
    const actor = await login(), member = await login(2); const cookie = member.http.cookie;
    const legacy = await couch.findUserById(memberId);
    assert.equal(legacy!.sessionVersion, undefined);
    // Arrange only this new disposable record as if disabled by the old release.
    await couch.saveUser({ ...legacy!, isActive: false });
    assert.equal((await change(actor, memberId, true)).status, 302);
    assert.ok((await client.use('portal_users').get(memberId)).sessionVersion > 0);
    assert.equal((await member.http.request('/', undefined, cookie)).status, 401);
    assert.equal((await (await login(2)).http.request('/')).status, 200);
  });
  it('serializes conflicting production HTTP administrator operations and rechecks the losing actor', async () => {
    const actor = await login(), other = await login(1);
    const results = await Promise.all([change(actor, otherId, false), change(other, actorId, false)]);
    assert.equal(results.filter(r => r.status === 302).length, 1);
    assert.ok(results.some(r => [401,403].includes(r.status)));
    const states = await Promise.all([actorId, otherId].map(id => client.use('portal_users').get(id)));
    assert.equal(states.filter(s => s.isActive).length, 1);
  });
  it('reactivates an administrator with preserved credentials and idempotent repeat behavior', async () => {
    const actor = await login(); assert.equal((await change(actor, otherId, false)).status, 302);
    assert.equal((await change(actor, otherId, false)).status, 302);
    assert.equal((await change(actor, otherId, true)).status, 302);
    assert.equal((await change(actor, otherId, true)).status, 302);
    assert.equal((await (await login(1)).http.request('/admin/users')).status, 200);
    const events = (await client.use('portal_audit').list({include_docs:true})).rows.map((r: any) => r.doc)
      .filter((d: any) => d.details?.targetUserId === otherId);
    assert.equal(events.length, 2);
  });
  it('reports a real CouchDB audit rejection after the account commit without claiming atomicity', async () => {
    const actor = await login(); const audit = client.use('portal_audit');
    const id = `_design/ci-account-audit-denial-${randomUUID()}`;
    // Real CouchDB validation rejects only this test's unique target. No audit
    // records, user records, databases or volumes are removed for fault injection.
    const design = await audit.insert({ _id: id, language: 'javascript',
      validate_doc_update: `function(doc) { if (doc.event === 'user.disabled' && doc.details && doc.details.targetUserId === ${JSON.stringify(memberId)}) throw({forbidden: 'private-disposable-audit-denial'}); }` });
    try {
      const response = await change(actor, memberId, false);
      assert.equal(response.status, 503, response.body);
      assert.match(response.body, /status changed.*audit/s);
      assert.doesNotMatch(response.body, /private-disposable-audit-denial/);
      assert.equal((await client.use('portal_users').get(memberId)).isActive, false);
      const events = (await audit.list({include_docs:true})).rows.map((r: any) => r.doc)
        .filter((d: any) => d.details?.targetUserId === memberId);
      assert.equal(events.length, 0);
      assert.equal((await actor.http.request('/admin/users')).status, 200);
    } finally {
      // Remove only the test-owned validation fixture, not application data.
      await audit.destroy(id, design.rev);
    }
  });
});
