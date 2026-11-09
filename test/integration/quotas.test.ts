import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { beforeEach, afterEach, describe, it } from 'node:test';
import { CouchDbService } from '../../src/common/couchdb.service';
import { UsersService } from '../../src/users/users.service';
import { UserRole } from '../../src/common/roles';
import { browser, dependencyUrl, formToken, launchApplication, within } from './support';
const nano=require('nano');
const empty={type:'portal-settings',schemaVersion:1,maxActiveUsers:{mode:'not-configured'},defaultUserQuota:{mode:'not-configured'},globalStorageQuota:{mode:'not-configured'}};

describe('real CouchDB/Redis capacity and quota policy',{concurrency:false,timeout:90000},()=>{
  let app:Awaited<ReturnType<typeof launchApplication>>,couch:CouchDbService,db:any,original:any,admin:any,name:string;
  const password='QuotaIntegration123';
  async function rawSettings(){try{return await db.use('portal_users').get('portal-settings');}catch(e:any){if(e.statusCode===404)return null;throw e;}}
  async function fixturePolicy(value:any){const current=await rawSettings();return db.use('portal_users').insert({...value,_id:'portal-settings',_rev:current?._rev});}
  beforeEach(async()=>{
    db=nano(dependencyUrl('COUCHDB_URL'));couch=new CouchDbService();await couch.initialize({allowMemoryFallback:false});original=await rawSettings();await fixturePolicy(empty);
    name=`quota-${randomUUID()}`;admin=await new UsersService(couch).createUser({username:name,email:`${name}@example.test`,password,role:UserRole.ADMIN});
    app=await launchApplication();await within(app.ready,15000,'Quota production app startup');
  });
  afterEach(async()=>{await app?.close();if(db)await fixturePolicy(original??empty);});
  async function actor(){const http=browser(app.url),csrf=formToken((await http.request('/login')).body);assert.equal((await http.request('/login',{username:name,password,_csrf:csrf})).headers.get('location'),'/');return{http,csrf:formToken((await http.request('/')).body)};}
  const body=(count='unlimited',per='not-configured',global='unlimited')=>({maxActiveUsers:count,defaultUserQuotaGb:per,globalStorageGb:global});
  async function save(a:Awaited<ReturnType<typeof actor>>,count='unlimited',per='not-configured',global='unlimited'){return a.http.request('/admin/settings',{...body(count,per,global),_csrf:a.csrf});}
  function active(u:any){return u.type==='user'&&u.isActive&&!u.closedAt&&(!u.registration||u.registration.status==='approved');}
  it('persists exact settings and actor audits and retrieves them after a fresh production application starts',async()=>{
    const a=await actor();assert.equal((await save(a,'unlimited','1.000000001','10')).status,303);
    let stored=await rawSettings();assert.equal(stored.defaultUserQuota.bytes,'1000000001');assert.equal(stored.globalStorageQuota.bytes,'10000000000');
    await app.close();app=await launchApplication();await within(app.ready,15000,'Restarted quota app');const fresh=await actor();const page=await fresh.http.request('/admin/settings');assert.equal(page.status,200);assert.match(page.body,/1\.000000001/);
    const records=(await db.use('portal_audit').list({include_docs:true})).rows.map((r:any)=>r.doc).filter((d:any)=>d.event==='portal.settings_changed'&&d.userId===admin._id);
    assert.equal(records.length,1);assert.equal(records[0].username,name);assert.equal(records[0].details.next.defaultUserQuota.bytes,'1000000001');assert.ok(records[0].createdAt);
  });
  it('allows only one approval/reactivation at the final real database capacity slot',async()=>{
    const pending=await couch.createUser({type:'user',username:`pending-${randomUUID()}`,email:'quota-pending@example.test',passwordHash:admin.passwordHash,role:UserRole.MEMBER,isActive:false,registration:{status:'pending',requestedAt:new Date().toISOString()}});
    const disabled=await couch.createUser({type:'user',username:`disabled-${randomUUID()}`,email:'quota-disabled@example.test',passwordHash:admin.passwordHash,role:UserRole.MEMBER,isActive:false});
    const count=(await couch.listUsers()).filter(active).length,a=await actor();assert.equal((await save(a,String(count+1))).status,303);
    const r=await Promise.all([a.http.request(`/admin/users/${pending._id}/registration/approve`,{_csrf:a.csrf}),a.http.request(`/admin/users/${disabled._id}/enable`,{_csrf:a.csrf})]);assert.equal(r.filter(x=>[302,303].includes(x.status)).length,1);assert.equal(r.filter(x=>x.status===409).length,1);
    assert.equal((await couch.listUsers()).filter(active).length,count+1);
    const create=await a.http.request('/admin/users',{username:`overflow-${randomUUID()}`,email:'overflow@example.test',password,role:UserRole.MEMBER,_csrf:a.csrf});assert.equal(create.status,409);
  });
  it('persists override assignment and removal with effective defaults and no account-data loss',async()=>{
    const a=await actor(),originalUser=await couch.findUserById(admin._id);await save(a,'unlimited','2','10');
    assert.equal((await a.http.request(`/admin/settings/users/${admin._id}/quota`,{quotaGb:'0.5',_csrf:a.csrf})).status,303);
    let user:any=await db.use('portal_users').get(admin._id);assert.equal(user.storageQuotaOverride.bytes,'500000000');
    assert.equal((await a.http.request(`/admin/settings/users/${admin._id}/quota`,{quotaGb:'inherit',_csrf:a.csrf})).status,303);
    user=await db.use('portal_users').get(admin._id);assert.equal(user.storageQuotaOverride??null,null);assert.equal(user.passwordHash,originalUser!.passwordHash);assert.equal(user.role,UserRole.ADMIN);assert.equal(user.isActive,true);
    const fresh=new CouchDbService();await fresh.initialize({allowMemoryFallback:false});assert.equal(((await fresh.findUserById(admin._id)) as any).storageQuotaOverride??null,null);
  });
  it('reports only explicitly managed file metadata and never counts legacy NAS metadata as managed usage',async()=>{
    const base={type:'file',title:`quota-${randomUUID()}`,description:'test metadata only',storedFilename:'not-created.dat',originalFilename:'not-created.dat',mimeType:'application/octet-stream',sha256:'fixture',category:'test',visibility:'private',allowedRoles:[UserRole.ADMIN],uploadedByUserId:admin._id};
    await couch.createFile({...base,sizeBytes:101,storageScope:'portal-managed'} as any);await couch.createFile({...base,sizeBytes:202,storageScope:'portal-managed'} as any);await couch.createFile({...base,sizeBytes:999999999} as any);
    const a=await actor(),page=await a.http.request('/admin/settings');assert.equal(page.status,200);assert.match(page.body,/Global known managed bytes: 303/);assert.match(page.body,/Known bytes: 303/);assert.match(page.body,/SMB/);
  });
  it('refuses invalid settings without altering the persisted policy',async()=>{
    const a=await actor(),before=await rawSettings();const r=await a.http.request('/admin/settings',{...body('unlimited','-1'),_csrf:a.csrf});assert.equal(r.status,400);assert.deepEqual(await rawSettings(),before);
    const invalid=new URL(dependencyUrl('COUCHDB_URL'));invalid.password='wrong-test-only-password';const previous=process.env.COUCHDB_URL;process.env.COUCHDB_URL=invalid.toString();
    try {await assert.rejects((new CouchDbService() as any).getPortalSettings(),(e:any)=>e.statusCode===401);}finally{process.env.COUCHDB_URL=previous;}
  });
  it('preserves explicit production CLI bootstrap at capacity and reports the resulting over-capacity state',async()=>{
    const a=await actor(),count=(await couch.listUsers()).filter(active).length;
    assert.equal((await save(a,String(count))).status,303);
    const bootstrapName=`bootstrap-${randomUUID()}`;
    const result=await promisify(execFile)(process.execPath,['dist/seed-admin.js'],{timeout:15000,env:{...process.env,NODE_ENV:'production',ADMIN_USERNAME:bootstrapName,ADMIN_EMAIL:`${bootstrapName}@example.test`,ADMIN_PASSWORD:password}});
    assert.match(result.stdout,/Admin user created:/);const created=await couch.findUserByUsername(bootstrapName);assert.ok(created);assert.equal(created.isActive,true);assert.equal(created.role,UserRole.ADMIN);
    assert.equal((await couch.listUsers()).filter(active).length,count+1);assert.match((await a.http.request('/admin/settings')).body,/over capacity/i);
    const repeat=await promisify(execFile)(process.execPath,['dist/seed-admin.js'],{timeout:15000,env:{...process.env,NODE_ENV:'production',ADMIN_USERNAME:bootstrapName,ADMIN_EMAIL:'different@example.test',ADMIN_PASSWORD:'DifferentPassword123'}});
    assert.match(repeat.stdout,/Admin user already present:/);assert.equal((await couch.findUserById(created._id!))!.passwordHash,created.passwordHash);
  });
});
