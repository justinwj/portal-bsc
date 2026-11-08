import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, beforeEach, afterEach, describe, it } from 'node:test';
import { CouchDbService } from '../../src/common/couchdb.service';
import { UsersService } from '../../src/users/users.service';
import { UserRole } from '../../src/common/roles';
import { browser, dependencyUrl, formToken, launchApplication, within } from './support';
const nano=require('nano');

describe('real CouchDB/Redis registration and account-deletion lifecycle',{concurrency:false,timeout:60000},()=>{
  let app:Awaited<ReturnType<typeof launchApplication>>,couch:CouchDbService,db:any,adminId:string,adminName:string,name:string;
  const password='LifecycleIntegration123';
  before(()=>{db=nano(dependencyUrl('COUCHDB_URL'));});
  beforeEach(async()=>{
    couch=new CouchDbService();await couch.initialize({allowMemoryFallback:false});name=`reg-${randomUUID()}`;adminName=`admin-${randomUUID()}`;
    adminId=(await new UsersService(couch).createUser({username:adminName,email:`${adminName}@example.test`,password,role:UserRole.ADMIN}))._id!;
    app=await launchApplication();await within(app.ready,15000,'Lifecycle app startup');
  });
  afterEach(async()=>{await app?.close();});
  async function anonymous(){const http=browser(app.url);return{http,token:formToken((await http.request('/login')).body)};}
  async function login(username=adminName){const a=await anonymous();assert.equal((await a.http.request('/login',{username,password,_csrf:a.token})).headers.get('location'),'/');
    return{http:a.http,token:formToken((await a.http.request('/')).body)};}
  async function post(a:Awaited<ReturnType<typeof anonymous>>,path:string,body:Record<string,string>={}){return a.http.request(path,{confirmed:'yes',...body,_csrf:a.token});}
  async function register(){const a=await anonymous();const r=await a.http.request('/register',{username:name,email:`${name}@example.test`,password,_csrf:a.token});assert.equal(r.status,303,r.body);
    const user=await couch.findUserByUsername(name);assert.ok(user);return user as any;}
  const decide=(id:string,d:string)=>`/admin/users/${id}/registration/${d}`;
  const deletion=(id:string,r:string,d:string)=>`/admin/users/${id}/deletion/${r}/${d}`;
  async function audits(id:string){return(await db.use('portal_audit').list({include_docs:true})).rows.map((r:any)=>r.doc).filter((d:any)=>d.details?.targetUserId===id);}
  it('persists a pending registration, blocks login, then approves as member with attributable audit records',async()=>{
    const user=await register();assert.equal(user.isActive,false);assert.equal(user.registration.status,'pending');assert.equal(user.role,UserRole.MEMBER);
    const a=await anonymous();assert.equal((await a.http.request('/login',{username:name,password,_csrf:a.token})).headers.get('location'),'/login?error=invalid');
    const admin=await login();assert.equal((await post(admin,decide(user._id,'approve'))).status,303);
    const fresh=new CouchDbService();await fresh.initialize({allowMemoryFallback:false});const stored:any=await fresh.findUserById(user._id);
    assert.equal(stored.registration.status,'approved');assert.equal(stored.registration.decidedBy,adminId);assert.equal(stored.passwordHash,user.passwordHash);assert.equal(stored.role,UserRole.MEMBER);
    assert.equal((await(await login(name)).http.request('/files')).status,200);
    const events=await audits(user._id);assert.ok(events.some(e=>e.event==='registration.requested'));assert.ok(events.some(e=>e.event==='registration.approved'&&e.userId===adminId));
  });
  it('prevents duplicate public identities concurrently and rejects privilege injection',async()=>{
    const a=await anonymous(),body={username:name,email:`${name}@example.test`,password,_csrf:a.token};
    const replies=await Promise.all([a.http.request('/register',body),a.http.request('/register',{...body,username:name.toUpperCase()})]);assert.ok(replies.every(r=>r.status===303));
    assert.equal((await couch.listUsers()).filter(u=>u.username.toLowerCase()===name).length,1);
    assert.equal((await a.http.request('/register',{...body,role:'admin'})).status,400);
    assert.equal((await audits((await couch.findUserByUsername(name))!._id!)).filter(e=>e.event==='registration.requested').length,1);
  });
  it('rejects registration and prevents ordinary Enable from bypassing the decision',async()=>{
    const user=await register(),admin=await login();assert.equal((await post(admin,decide(user._id,'reject'))).status,303);
    assert.equal((await post(admin,`/admin/users/${user._id}/enable`)).status,409);
    assert.equal((await db.use('portal_users').get(user._id)).registration.status,'rejected');
  });
  it('closes an approved account on deletion approval, revokes its Redis session and retains records/files/audits',async()=>{
    const user=await register(),admin=await login();await post(admin,decide(user._id,'approve'));const member=await login(name),cookie=member.http.cookie;
    const file=await couch.createFile({type:'file',title:'Preserved metadata',description:'fixture',storedFilename:'never-created.txt',originalFilename:'fixture.txt',mimeType:'text/plain',sizeBytes:1,sha256:'fixture',category:'test',visibility:'private',allowedRoles:[UserRole.MEMBER],uploadedByUserId:user._id});
    const before=await db.use('portal_files').get(file._id);assert.equal((await post(member,'/account/deletion-request')).status,303);
    const request=(await db.use('portal_users').get(user._id)).deletionRequests.at(-1);
    assert.equal((await post(admin,deletion(user._id,request.id,'approve'))).status,303);
    const closed=await db.use('portal_users').get(user._id);assert.equal(closed.isActive,false);assert.ok(closed.closedAt);assert.equal(closed.passwordHash,user.passwordHash);
    assert.equal((await member.http.request('/files',undefined,cookie)).status,401);assert.equal((await post(admin,`/admin/users/${user._id}/enable`)).status,409);
    assert.deepEqual(await db.use('portal_files').get(file._id),before);assert.ok((await audits(user._id)).some(e=>e.event==='account.closed'));
    assert.equal((await admin.http.request(`/admin/users/${user._id}/history`)).status,200);
  });
  it('preserves rejected deletion requests and rejects stale approvals after a new request',async()=>{
    const user=await register(),admin=await login();await post(admin,decide(user._id,'approve'));const member=await login(name);
    await Promise.all([post(member,'/account/deletion-request'),post(member,'/account/deletion-request')]);let stored=await db.use('portal_users').get(user._id);assert.equal(stored.deletionRequests.length,1);
    const first=stored.deletionRequests[0].id;assert.equal((await post(admin,deletion(user._id,first,'reject'))).status,303);
    assert.equal((await post(admin,deletion(user._id,first,'reject'))).status,303);await post(member,'/account/deletion-request');stored=await db.use('portal_users').get(user._id);
    assert.equal(stored.deletionRequests.length,2);assert.equal((await post(admin,deletion(user._id,first,'approve'))).status,409);assert.equal(stored.isActive,true);
  });
  it('allows only one conflicting registration decision under real concurrent HTTP requests',async()=>{
    const user=await register(),admin=await login();const r=await Promise.all([post(admin,decide(user._id,'approve')),post(admin,decide(user._id,'reject'))]);
    assert.deepEqual(r.map(x=>x.status).sort(),[303,409]);assert.equal((await audits(user._id)).filter(e=>['registration.approved','registration.rejected'].includes(e.event)).length,1);
  });
  it('registers successfully when the user database contains real CouchDB index metadata',async()=>{
    const users=db.use('portal_users'),id=`_design/ci-lifecycle-${randomUUID()}`;
    const design=await users.insert({_id:id,language:'javascript',views:{}});
    try { assert.equal((await register()).registration.status,'pending'); }
    finally { await users.destroy(id,design.rev); } // Only this test-owned design fixture.
  });
});
