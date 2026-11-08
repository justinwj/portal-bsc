import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, beforeEach, afterEach, after, describe, it } from 'node:test';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import session from 'express-session';
import express from 'express';
import helmet from 'helmet';
import * as bcrypt from 'bcrypt';
import { CouchDbService } from '../common/couchdb.service';
import { UserRole } from '../common/roles';
import { configureViews } from '../common/views';
import { attachCsrfToken, csrfMiddleware } from '../common/csrf';
import { UsersService } from './users.service';

class LifecycleStore {
  users = new Map<string, any>(); audits: any[] = []; files = [{_id:'kept-file', uploadedByUserId:'member', title:'Retained file', visibility:'public'}];
  failAudit = false; failWrite = false;
  async listUsers() { return structuredClone([...this.users.values()]); }
  async findUserById(id: string) { return structuredClone(this.users.get(id) ?? null); }
  async findUserByUsername(name: string) { return (await this.listUsers()).find(u=>u.username===name) ?? null; }
  async createUser(user: any) { return this.saveUser({...user,_id:randomUUID(),createdAt:new Date().toISOString()}); }
  async saveUser(user: any) { if(this.failWrite) throw Error('private-db-secret'); await new Promise(r=>setImmediate(r));
    const saved={...structuredClone(user),updatedAt:new Date().toISOString()};this.users.set(saved._id,saved);return structuredClone(saved); }
  async listFiles() { return structuredClone(this.files); }
  async logAudit(event: string, details: any, userId?: string, username?: string, ip?: string) {
    if(this.failAudit) throw Error('private-audit-secret'); const doc={event,details,userId,username,ip,createdAt:new Date().toISOString()};this.audits.push(doc);return doc;
  }
  async listUserAudits(id: string) { return structuredClone(this.audits.filter(a=>a.details?.targetUserId===id)); }
}

describe('registration and deletion lifecycle over real Nest HTTP', {concurrency:false},()=>{
  let app: NestExpressApplication, store: LifecycleStore, url: string, service: UsersService, AppModule: any;
  const environment={NODE_ENV:process.env.NODE_ENV,ALLOW_IN_MEMORY_SESSION_STORE:process.env.ALLOW_IN_MEMORY_SESSION_STORE};
  const password='LifecyclePassword123', hash=bcrypt.hashSync(password,4);
  const registration={username:'new-person',email:'person@example.test',password};
  before(async()=>{process.env.NODE_ENV='test';process.env.ALLOW_IN_MEMORY_SESSION_STORE='true';AppModule=(await import('../app.module')).AppModule;});
  beforeEach(async()=>{
    store=new LifecycleStore();
    for(const [id,role] of [['admin',UserRole.ADMIN],['other-admin',UserRole.ADMIN],['member',UserRole.MEMBER]])
      store.users.set(id,{_id:id,type:'user',username:id,email:`${id}@example.test`,role,passwordHash:hash,isActive:true,createdAt:'2026-01-01',updatedAt:'2026-01-01'});
    app=await NestFactory.create<NestExpressApplication>({module:AppModule,providers:[{provide:CouchDbService,useValue:store}]},{logger:false,abortOnError:false});
    app.use(helmet());app.use(session({secret:randomUUID(),resave:false,saveUninitialized:false,store:new session.MemoryStore()}));
    app.use(express.urlencoded({extended:false}));app.use(attachCsrfToken);app.use(csrfMiddleware);configureViews(app);
    app.useGlobalPipes(new ValidationPipe({whitelist:true,transform:true,forbidNonWhitelisted:true}));
    await app.listen(0,'127.0.0.1');url=await app.getUrl();service=app.get(UsersService);
  });
  afterEach(async()=>{await app?.close();});
  after(()=>{for(const [k,v] of Object.entries(environment))if(v===undefined)delete process.env[k];else process.env[k]=v;});
  function browser(){let cookie='';return{get cookie(){return cookie;},async request(path:string,body?:Record<string,string>,replay?:string){
    const r=await fetch(url+path,{method:body?'POST':'GET',headers:{cookie:replay??cookie,'user-agent':'lifecycle-test'},body:body?new URLSearchParams(body):undefined,redirect:'manual'});
    if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie')!.split(';')[0];return{status:r.status,body:await r.text(),headers:r.headers};}};}
  function token(body:string){const t=/name="_csrf" value="([a-f0-9]{64})"/.exec(body)?.[1];assert.ok(t,body);return t;}
  async function anonymous(){const client=browser();return{client,csrf:token((await client.request('/login')).body)};}
  async function login(id='admin'){const actor=await anonymous();const r=await actor.client.request('/login',{username:id,password,_csrf:actor.csrf});assert.equal(r.headers.get('location'),'/',r.body);
    return{client:actor.client,csrf:token((await actor.client.request('/')).body)};}
  async function post(actor:Awaited<ReturnType<typeof anonymous>>,path:string,body:Record<string,string>={}){return actor.client.request(path,{confirmed:'yes',...body,_csrf:actor.csrf});}
  function pending(id='pending'){store.users.set(id,{...store.users.get('member'),_id:id,username:id,email:`${id}@example.test`,isActive:false,registration:{status:'pending',requestedAt:'2026-01-02T00:00:00.000Z'}});return id;}
  function requestId(id='member'){const req=store.users.get(id).deletionRequests?.at(-1);assert.ok(req);return req.id;}
  const decide=(id:string,kind:string,decision:string)=>`/admin/users/${id}/${kind}/${decision}`;
  const deletion=(id:string,request:string,decision:string)=>`/admin/users/${id}/deletion/${request}/${decision}`;

  it('offers public registration with a functional CSRF form and unchanged CSP',async()=>{
    const a=await anonymous();assert.match((await a.client.request('/login')).body,/href="\/register"/);
    const page=await a.client.request('/register');assert.equal(page.status,200);assert.equal(token(page.body),a.csrf);
    assert.match(page.body,/name="email"/);assert.doesNotMatch(page.body,/name="role"|onclick=|onsubmit=|<script/i);
    assert.match(page.headers.get('content-security-policy')??'',/script-src 'self'/);
  });
  it('creates a pending inactive member with a hash, dates and no login or protected-file access',async()=>{
    const a=await anonymous();const result=await a.client.request('/register',{...registration,_csrf:a.csrf});assert.equal(result.status,303);
    const user=await store.findUserByUsername(registration.username);assert.ok(user);assert.equal(user.isActive,false);assert.equal(user.role,UserRole.MEMBER);
    assert.equal(user.registration.status,'pending');assert.ok(user.registration.requestedAt);assert.ok(await bcrypt.compare(password,user.passwordHash));
    assert.doesNotMatch((await a.client.request(result.headers.get('location')!)).body,/\$2[aby]\$|person@example|already exists/);
    const denied=await a.client.request('/login',{username:registration.username,password,_csrf:a.csrf});assert.equal(denied.headers.get('location'),'/login?error=invalid');
    for(const path of ['/','/files','/files/kept-file/download'])assert.equal((await a.client.request(path)).status,401);
  });
  for(const field of ['role','isActive','registration','closedAt','sessionVersion'])it(`rejects public ${field} manipulation`,async()=>{
    const a=await anonymous();assert.equal((await a.client.request('/register',{...registration,[field]:'admin',_csrf:a.csrf})).status,400);
    assert.equal(store.users.size,3);
  });
  for(const change of [{password:'weak'},{email:'invalid'},{username:'../unsafe'},{password:'A1a'+'é'.repeat(40)}])it(`validates public registration ${Object.keys(change)[0]} ${JSON.stringify(change).length}`,async()=>{
    const a=await anonymous();assert.equal((await a.client.request('/register',{...registration,...change,_csrf:a.csrf})).status,400);assert.equal(store.users.size,3);
  });
  for(const csrf of ['', 'invalid'])it(`rejects ${csrf?'invalid':'missing'} registration CSRF`,async()=>{
    const a=await anonymous();assert.equal((await a.client.request('/register',{...registration,_csrf:csrf})).status,403);assert.equal(store.users.size,3);
  });
  it('normalizes public identifiers and serializes duplicate usernames/emails without disclosing existence',async()=>{
    const a=await anonymous();const replies=await Promise.all([
      a.client.request('/register',{...registration,username:'New-Person',email:'Person@Example.test',_csrf:a.csrf}),
      a.client.request('/register',{...registration,_csrf:a.csrf})]);
    assert.deepEqual(replies.map(r=>r.status),[303,303]);assert.equal(replies[0].headers.get('location'),replies[1].headers.get('location'));
    const duplicate=await a.client.request('/register',{...registration,username:'another-name',_csrf:a.csrf});assert.equal(duplicate.status,303);
    assert.equal(store.users.size,4);assert.equal(store.audits.filter(e=>e.event==='registration.requested').length,1);
  });
  it('limits public registration across fresh sessions without affecting login availability',async()=>{
    for(let i=0;i<5;i++){const a=await anonymous();assert.equal((await a.client.request('/register',{...registration,_csrf:a.csrf})).status,303);}
    const a=await anonymous();const limited=await a.client.request('/register',{...registration,_csrf:a.csrf});assert.equal(limited.status,429);assert.ok(limited.headers.get('retry-after'));
    assert.equal((await a.client.request('/login')).status,200);
  });
  it('shows pending registration dates and approves only as a member with a fresh login',async()=>{
    const id=pending();const admin=await login();const page=await admin.client.request('/admin/users');assert.match(page.body,/Pending Registrations/);assert.match(page.body,/2026-01-02/);
    const original=structuredClone(store.users.get(id));assert.equal((await post(admin,decide(id,'registration','approve'))).status,303);
    const user=store.users.get(id);assert.equal(user.isActive,true);assert.equal(user.role,UserRole.MEMBER);assert.equal(user.passwordHash,original.passwordHash);
    assert.equal(user.registration.status,'approved');assert.equal(user.registration.decidedBy,'admin');assert.ok(user.registration.decidedAt);
    assert.equal((await (await login(id)).client.request('/files')).status,200);
  });
  it('rejects registrations, prevents Enable bypass, and denies login for pending/rejected records even with an invalid active flag',async()=>{
    const id=pending();const admin=await login();assert.equal((await post(admin,`/admin/users/${id}/enable`)).status,409);
    assert.equal((await post(admin,decide(id,'registration','reject'))).status,303);assert.equal(store.users.get(id).registration.status,'rejected');
    assert.equal((await post(admin,`/admin/users/${id}/enable`)).status,409);
    store.users.get(id).isActive=true;const a=await anonymous();assert.equal((await a.client.request('/login',{username:id,password,_csrf:a.csrf})).headers.get('location'),'/login?error=invalid');
  });
  it('serializes conflicting registration decisions and makes repeated decisions idempotent',async()=>{
    const id=pending(),admin=await login();const r=await Promise.all([post(admin,decide(id,'registration','approve')),post(admin,decide(id,'registration','reject'))]);
    assert.deepEqual(r.map(x=>x.status).sort(),[303,409]);const chosen=store.users.get(id).registration.status==='approved'?'approve':'reject';
    assert.equal((await post(admin,decide(id,'registration',chosen))).status,303);
    assert.equal(store.audits.filter(a=>a.event==='registration.approved'||a.event==='registration.rejected').length,1);
  });
  for(const kind of ['registration','deletion'])for(const role of ['anonymous','member'])it(`denies ${role} ${kind} decisions`,async()=>{
    const id=pending();store.users.get('member').deletionRequests=[{id:'request',status:'pending',requestedAt:'2026-01-01'}];
    const actor=role==='anonymous'?await anonymous():await login('member');
    const path=kind==='registration'?decide(id,kind,'approve'):deletion('member','request','approve');assert.equal((await post(actor,path)).status,role==='anonymous'?401:403);
  });
  for(const kind of ['registration','deletion'])it(`requires CSRF for ${kind} decisions`,async()=>{
    const id=pending(),admin=await login();store.users.get('member').deletionRequests=[{id:'request',status:'pending',requestedAt:'2026-01-01'}];
    const path=kind==='registration'?decide(id,kind,'approve'):deletion('member','request','approve');assert.equal((await admin.client.request(path,{confirmed:'yes'})).status,403);
  });
  it('returns 404 for nonexistent registration/deletion targets and rejects role injection in a decision',async()=>{
    const admin=await login();assert.equal((await post(admin,decide('missing','registration','approve'))).status,404);
    assert.equal((await post(admin,deletion('missing','request','approve'))).status,404);
    assert.equal((await post(admin,decide(pending(),'registration','approve'),{role:'admin'})).status,400);
  });
  it('lets authenticated users request deletion, shows pending status/date and does not close or delete anything yet',async()=>{
    const actor=await login('member');assert.equal((await actor.client.request('/account')).status,200);
    assert.equal((await post(actor,'/account/deletion-request')).status,303);
    const page=await actor.client.request('/account');assert.match(page.body,/Pending/);assert.match(page.body,/\d{4}-\d{2}-\d{2}/);
    assert.equal(store.users.get('member').isActive,true);assert.equal((await actor.client.request('/files')).status,200);assert.equal(store.files.length,1);
  });
  it('requires authentication, CSRF and explicit confirmation for a deletion request and cannot target another account',async()=>{
    assert.equal((await post(await anonymous(),'/account/deletion-request')).status,401);
    const actor=await login('member');assert.equal((await actor.client.request('/account/deletion-request',{confirmed:'yes'})).status,403);
    assert.equal((await actor.client.request('/account/deletion-request',{_csrf:actor.csrf})).status,400);
    assert.equal((await post(actor,'/account/deletion-request',{userId:'admin'})).status,400);assert.equal(store.users.get('admin').deletionRequests,undefined);
  });
  it('coalesces concurrent duplicate deletion requests into one pending request and one audit',async()=>{
    const actor=await login('member');const r=await Promise.all([post(actor,'/account/deletion-request'),post(actor,'/account/deletion-request')]);assert.ok(r.every(x=>x.status===303));
    assert.equal(store.users.get('member').deletionRequests.length,1);assert.equal(store.audits.filter(a=>a.event==='account.deletion_requested').length,1);
  });
  it('approval closes the account and revokes old sessions while preserving records, hashes, files and audit history',async()=>{
    const actor=await login('member'),admin=await login();const cookie=actor.client.cookie,original=structuredClone(store.users.get('member')),files=structuredClone(store.files);
    await post(actor,'/account/deletion-request');assert.equal((await post(admin,deletion('member',requestId(),'approve'))).status,303);
    const closed=store.users.get('member');assert.equal(closed.isActive,false);assert.ok(closed.closedAt);assert.equal(closed.deletionRequests.at(-1).status,'approved');
    for(const k of ['username','email','role','passwordHash','createdAt'])assert.equal(closed[k],original[k]);assert.deepEqual(store.files,files);
    assert.equal((await actor.client.request('/files',undefined,cookie)).status,401);assert.equal((await post(admin,'/admin/users/member/enable')).status,409);
    assert.ok(store.audits.some(a=>a.event==='account.closed'));assert.equal(store.users.size,3);
  });
  it('rejects deletion requests without closing users and preserves old request history against stale decisions',async()=>{
    const actor=await login('member'),admin=await login();await post(actor,'/account/deletion-request');const first=requestId();
    assert.equal((await post(admin,deletion('member',first,'reject'))).status,303);assert.equal(store.users.get('member').isActive,true);
    assert.match((await actor.client.request('/account')).body,/Rejected/);assert.equal((await post(admin,deletion('member',first,'reject'))).status,303);
    await post(actor,'/account/deletion-request');assert.notEqual(requestId(),first);assert.equal(store.users.get('member').deletionRequests.length,2);
    assert.equal((await post(admin,deletion('member',first,'approve'))).status,409);assert.equal(store.users.get('member').isActive,true);
  });
  it('serializes conflicting deletion decisions and protects administrator self-closure',async()=>{
    const actor=await login('member'),admin=await login();await post(actor,'/account/deletion-request');const id=requestId();
    const results=await Promise.all([post(admin,deletion('member',id,'approve')),post(admin,deletion('member',id,'reject'))]);assert.deepEqual(results.map(r=>r.status).sort(),[303,409]);
    await post(admin,'/account/deletion-request');assert.equal((await post(admin,deletion('admin',requestId('admin'),'approve'))).status,403);assert.equal(store.users.get('admin').isActive,true);
  });
  it('retains one active administrator under conflicting account-closure approvals',async()=>{
    const a=await login(),b=await login('other-admin');await post(a,'/account/deletion-request');await post(b,'/account/deletion-request');
    const r=await Promise.all([post(a,deletion('other-admin',requestId('other-admin'),'approve')),post(b,deletion('admin',requestId('admin'),'approve'))]);
    assert.equal(r.filter(x=>x.status===303).length,1);assert.equal([...store.users.values()].filter(u=>u.role===UserRole.ADMIN&&u.isActive).length,1);
  });
  it('requires explicit closure confirmation and rejects an unknown or forged request ID',async()=>{
    const actor=await login('member'),admin=await login();await post(actor,'/account/deletion-request');
    assert.equal((await post(admin,deletion('member','wrong','approve'))).status,409);
    assert.equal((await admin.client.request(deletion('member',requestId(),'approve'),{_csrf:admin.csrf})).status,400);assert.equal(store.users.get('member').isActive,true);
  });
  it('allows admins to review attributable workflow audits without exposing credentials or allowing members to read them',async()=>{
    const id=pending(),admin=await login();await post(admin,decide(id,'registration','approve'));
    const actor=await login(id);await post(actor,'/account/deletion-request');await post(admin,deletion(id,requestId(id),'reject'));
    const page=await admin.client.request(`/admin/users/${id}/history`);assert.equal(page.status,200);assert.match(page.body,/registration.approved|Registration approved/);assert.match(page.body,/admin/);
    assert.doesNotMatch(page.body,/\$2[aby]\$|LifecyclePassword123/);assert.equal((await actor.client.request(`/admin/users/${id}/history`)).status,403);
    const events=store.audits.filter(a=>a.details?.targetUserId===id);assert.equal(events.length,3);
    assert.equal(events[0].userId,'admin');assert.equal(events[1].userId,id);assert.equal(events[2].details.requestId,requestId(id));
    assert.doesNotMatch(JSON.stringify(events),/passwordHash|LifecyclePassword123|csrf|connect\.sid/);
  });
  it('does not grant access on a forged active pending record or a closed legacy session',async()=>{
    const actor=await login('member');store.users.get('member').registration={status:'pending',requestedAt:'2026-01-01'};
    assert.equal((await actor.client.request('/')).status,401);
    delete store.users.get('member').registration;const fresh=await login('member');store.users.get('member').closedAt='2026-01-01';assert.equal((await fresh.client.request('/')).status,401);
  });
  it('reports a decision audit failure as a partial commit without exposing backend errors',async()=>{
    const id=pending(),admin=await login();store.failAudit=true;const result=await post(admin,decide(id,'registration','approve'));
    assert.equal(result.status,503);assert.equal(store.users.get(id).registration.status,'approved');assert.doesNotMatch(result.body,/private-audit-secret/);
  });
  it('keeps public duplicate and audit-failure responses generic and retains the pending record',async()=>{
    const a=await anonymous();store.failAudit=true;const r=await a.client.request('/register',{...registration,_csrf:a.csrf});assert.equal(r.status,303);
    assert.ok(await store.findUserByUsername(registration.username));assert.doesNotMatch((await a.client.request(r.headers.get('location')!)).body,/private-audit-secret|person@example/);
  });
  it('fails registration safely on storage outage without creating an in-memory account',async()=>{
    const a=await anonymous();store.failWrite=true;const r=await a.client.request('/register',{...registration,_csrf:a.csrf});assert.equal(r.status,503);assert.equal(store.users.size,3);assert.doesNotMatch(r.body,/private-db-secret/);
  });
});
