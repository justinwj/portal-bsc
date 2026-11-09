import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import * as bcrypt from 'bcrypt';
import { CouchDbService } from '../common/couchdb.service';
import { UserRole } from '../common/roles';
import { attachCsrfToken, csrfMiddleware } from '../common/csrf';
import { configureViews } from '../common/views';
import { UsersService } from './users.service';

class QuotaStore {
  users=new Map<string,any>();files:any[]=[];audits:any[]=[];settings:any=null;
  failRead=false;failWrite=false;failAudit=false;
  async listUsers(){return structuredClone([...this.users.values()]);}
  async findUserById(id:string){return structuredClone(this.users.get(id)??null);}
  async findUserByUsername(name:string){return (await this.listUsers()).find(u=>u.username===name)??null;}
  async saveUser(user:any){if(this.failWrite)throw Error('private-write');await new Promise(r=>setImmediate(r));this.users.set(user._id,structuredClone(user));return structuredClone(user);}
  async createUser(user:any){return this.saveUser({...user,_id:randomUUID(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});}
  async listFiles(){return structuredClone(this.files);}
  async getPortalSettings(){if(this.failRead)throw Error('private-read');return structuredClone(this.settings);}
  async savePortalSettings(settings:any){if(this.failWrite)throw Error('private-write');await new Promise(r=>setImmediate(r));this.settings=structuredClone(settings);return structuredClone(settings);}
  async logAudit(event:string,details:any,userId?:string,username?:string,ip?:string){if(this.failAudit)throw Error('private-audit');const doc={event,details,userId,username,ip,createdAt:new Date().toISOString()};this.audits.push(doc);return doc;}
}
const unconfigured={mode:'not-configured'};
function policy(count?:number){return{type:'portal-settings',schemaVersion:1,maxActiveUsers:count===undefined?unconfigured:{mode:'limited',count},defaultUserQuota:unconfigured,globalStorageQuota:unconfigured};}

describe('administrator capacity and storage policy HTTP',{concurrency:false},()=>{
  let store:QuotaStore,app:NestExpressApplication,url:string,users:UsersService,AppModule:any;
  const password='QuotaPassword123',hash=bcrypt.hashSync(password,4);
  const prior={NODE_ENV:process.env.NODE_ENV,ALLOW_IN_MEMORY_SESSION_STORE:process.env.ALLOW_IN_MEMORY_SESSION_STORE};
  before(async()=>{process.env.NODE_ENV='test';process.env.ALLOW_IN_MEMORY_SESSION_STORE='true';AppModule=(await import('../app.module')).AppModule;});
  beforeEach(async()=>{
    store=new QuotaStore();for(const [id,role] of [['admin',UserRole.ADMIN],['other-admin',UserRole.ADMIN],['member',UserRole.MEMBER]])store.users.set(id,{_id:id,type:'user',username:id,email:`${id}@example.test`,passwordHash:hash,role,isActive:true,createdAt:'2026-01-01',updatedAt:'2026-01-01'});
    app=await NestFactory.create<NestExpressApplication>({module:AppModule,providers:[{provide:CouchDbService,useValue:store}]},{logger:false,abortOnError:false});
    app.use(helmet());app.use(session({secret:randomUUID(),resave:false,saveUninitialized:false,store:new session.MemoryStore()}));app.use(express.urlencoded({extended:false}));app.use(attachCsrfToken);app.use(csrfMiddleware);configureViews(app);
    app.useGlobalPipes(new ValidationPipe({whitelist:true,transform:true,forbidNonWhitelisted:true}));await app.listen(0,'127.0.0.1');url=await app.getUrl();users=app.get(UsersService);
  });
  afterEach(async()=>{await app?.close();});after(()=>{for(const[k,v]of Object.entries(prior))if(v===undefined)delete process.env[k];else process.env[k]=v;});
  function browser(){let cookie='';return{async request(path:string,body?:Record<string,string>){const r=await fetch(url+path,{method:body?'POST':'GET',headers:{cookie,'user-agent':'quota-test'},body:body?new URLSearchParams(body):undefined,redirect:'manual'});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie')!.split(';')[0];return{status:r.status,body:await r.text(),headers:r.headers};}};}
  function token(body:string){const t=/name="_csrf" value="([a-f0-9]{64})"/.exec(body)?.[1];assert.ok(t,body);return t;}
  async function actor(name='admin'){const client=browser(),csrf=token((await client.request('/login')).body);assert.equal((await client.request('/login',{username:name,password,_csrf:csrf})).headers.get('location'),'/');return{client,csrf:token((await client.request('/')).body)};}
  const form=(max='unlimited',per='not-configured',global='unlimited')=>({maxActiveUsers:max,defaultUserQuotaGb:per,globalStorageGb:global});
  async function post(a:Awaited<ReturnType<typeof actor>>,path:string,body:Record<string,string>){return a.client.request(path,{...body,_csrf:a.csrf});}
  async function settings(a:Awaited<ReturnType<typeof actor>>,max='unlimited',per='not-configured',global='unlimited'){return post(a,'/admin/settings',form(max,per,global));}
  function pending(id='pending'){store.users.set(id,{...store.users.get('member'),_id:id,username:id,email:`${id}@example.test`,isActive:false,registration:{status:'pending',requestedAt:'2026-01-01'}});return id;}
  function disabled(id='disabled'){store.users.set(id,{...store.users.get('member'),_id:id,username:id,isActive:false});return id;}
  const approve=(id:string)=>`/admin/users/${id}/registration/approve`;
  const managed=(id:string,size:any,owner:any='member')=>({_id:id,type:'file',storageScope:'portal-managed',sizeBytes:size,uploadedByUserId:owner});

  it('renders Not configured for legacy settings and explicitly describes metadata-only Portal-managed reporting',async()=>{
    const a=await actor(),page=await a.client.request('/admin/settings');assert.equal(page.status,200);assert.match(page.body,/Not configured/);
    assert.match(page.body,/1 GB = 1,000,000,000 bytes/);assert.match(page.body,/SMB/);assert.match(page.body,/Session 7G|not enforced/i);assert.equal(store.settings,null);
  });
  it('stores explicit Unlimited and exact decimal-GB integer bytes, with actor-attributed previous/new audit values',async()=>{
    const a=await actor();assert.equal((await settings(a,'unlimited','1.000000001','0')).status,303);
    assert.deepEqual(store.settings.maxActiveUsers,{mode:'unlimited'});assert.deepEqual(store.settings.defaultUserQuota,{mode:'limited',bytes:'1000000001'});assert.deepEqual(store.settings.globalStorageQuota,{mode:'limited',bytes:'0'});
    const event=store.audits.find(e=>e.event==='portal.settings_changed');assert.ok(event);assert.equal(event.userId,'admin');assert.equal(event.username,'admin');assert.ok(event.createdAt);assert.ok(event.ip);
    assert.equal(event.details.previous.defaultUserQuota.mode,'not-configured');assert.equal(event.details.next.defaultUserQuota.bytes,'1000000001');assert.doesNotMatch(JSON.stringify(event),/QuotaPassword123|passwordHash|csrf|connect\.sid/);
    const page=await a.client.request('/admin/settings');assert.match(page.body,/Unlimited/);assert.match(page.body,/1\.000000001/);
  });
  for(const [field,value]of [['maxActiveUsers','-1'],['maxActiveUsers','3.5'],['maxActiveUsers','1e3'],['maxActiveUsers','9007199254740992'],['defaultUserQuotaGb','-1'],['defaultUserQuotaGb','NaN'],['defaultUserQuotaGb','1e3'],['defaultUserQuotaGb','0.0000000001'],['globalStorageGb','9007199.254740992'],['globalStorageGb','Infinity'],['defaultUserQuotaGb',''],['maxActiveUsers','03']])
    it(`rejects malformed ${field}=${value} without settings writes or successful audits`,async()=>{const a=await actor();assert.equal((await post(a,'/admin/settings',{...form(),[field]:value})).status,400);assert.equal(store.settings,null);assert.equal(store.audits.filter(e=>e.event==='portal.settings_changed').length,0);});
  it('accepts the exact supported upper byte boundary and never rounds it',async()=>{
    const a=await actor();assert.equal((await settings(a,'3','9007199.254740991','0.000000001')).status,303);
    assert.equal(store.settings.defaultUserQuota.bytes,'9007199254740991');assert.equal(store.settings.globalStorageQuota.bytes,'1');
  });
  for(const role of ['anonymous','member','disabled-admin'])it(`rejects ${role} settings reads and writes`,async()=>{
    const a=role==='anonymous'?{client:browser(),csrf:''}:await actor(role==='member'?'member':'admin');
    if(role==='anonymous')a.csrf=token((await a.client.request('/login')).body);if(role==='disabled-admin')store.users.get('admin').isActive=false;
    const code=role==='member'?403:401;assert.equal((await a.client.request('/admin/settings')).status,code);
    if(role==='disabled-admin')a.csrf=token((await a.client.request('/login')).body);
    assert.equal((await settings(a)).status,code);assert.equal(store.settings,null);
  });
  for(const csrf of ['','wrong'])it(`requires ${csrf?'valid':'nonempty'} CSRF for policy changes`,async()=>{const a=await actor();assert.equal((await a.client.request('/admin/settings',{...form(),_csrf:csrf})).status,403);assert.equal(store.settings,null);});
  it('rejects unwhitelisted settings metadata and user-role injection',async()=>{const a=await actor();assert.equal((await post(a,'/admin/settings',{...form(),updatedBy:'forged'})).status,400);assert.equal(store.settings,null);});
  it('rejects a maximum below active approved accounts including administrators and never disables users',async()=>{
    const a=await actor();assert.equal((await settings(a,'2')).status,409);assert.equal(store.settings,null);assert.equal([...store.users.values()].filter(u=>u.isActive).length,3);
  });
  it('excludes pending, rejected, closed and disabled accounts and shows the exact active count',async()=>{
    pending();disabled();pending('rejected');store.users.get('rejected').registration.status='rejected';store.users.set('closed',{...store.users.get('member'),_id:'closed',username:'closed',closedAt:'2026-01-01'});
    const a=await actor();assert.equal((await settings(a,'3')).status,303);assert.match((await a.client.request('/admin/settings')).body,/Active approved accounts: 3/);
  });
  for(const operation of ['create','approve','enable'])it(`enforces a full capacity for ${operation}`,async()=>{
    store.settings=policy(3);pending();disabled();const a=await actor();const result=operation==='create'?await post(a,'/admin/users',{username:'new-account',email:'new@example.test',password,role:UserRole.MEMBER}):await post(a,operation==='approve'?approve('pending'):'/admin/users/disabled/enable',{});
    assert.equal(result.status,409);assert.equal([...store.users.values()].filter(u=>u.isActive&&!u.closedAt&&!u.registration).length,3);
  });
  it('keeps registration intake available at full capacity and permits approval only after capacity is freed',async()=>{
    store.settings=policy(3);const c=browser(),csrf=token((await c.request('/login')).body);assert.equal((await c.request('/register',{username:'capacity-person',email:'capacity@example.test',password,_csrf:csrf})).status,303);
    const user=await store.findUserByUsername('capacity-person'),a=await actor();assert.equal((await post(a,approve(user._id),{})).status,409);
    assert.equal((await post(a,'/admin/users/member/disable',{confirmed:'yes'})).status,302);assert.equal((await post(a,approve(user._id),{})).status,303);
  });
  it('allows only one concurrent approval/reactivation at the final slot',async()=>{
    store.settings=policy(4);pending();disabled();const a=await actor();const r=await Promise.all([post(a,approve('pending'),{}),post(a,'/admin/users/disabled/enable',{})]);assert.equal(r.filter(x=>[302,303].includes(x.status)).length,1);assert.equal(r.filter(x=>x.status===409).length,1);
    assert.equal([...store.users.values()].filter(u=>u.isActive&&(!u.registration||u.registration.status==='approved')).length,4);
  });
  it('serializes a capacity reduction with active-account creation without committing an invalid maximum',async()=>{
    const a=await actor();const r=await Promise.all([settings(a,'3'),post(a,'/admin/users',{username:'racing-user',email:'race@example.test',password,role:UserRole.MEMBER})]);
    assert.ok(r.some(x=>x.status===409));const count=[...store.users.values()].filter(u=>u.isActive).length;if(store.settings?.maxActiveUsers.mode==='limited')assert.ok(count<=store.settings.maxActiveUsers.count);
  });
  it('does not charge capacity for idempotent activation of an already active account',async()=>{
    store.settings=policy(3);const a=await actor();assert.equal((await post(a,'/admin/users/member/enable',{})).status,302);
  });
  it('preserves explicit bootstrap creation, existing-password, collision and disabled-admin recovery rules at capacity',async()=>{
    store.settings=policy(3);const created=await users.seedAdmin('bootstrap-admin','bootstrap@example.test',password);assert.equal(created.message,'admin-created');assert.equal(store.users.size,4);
    const original=structuredClone(store.users.get('admin'));assert.equal((await users.seedAdmin('admin','changed@example.test','ChangedPassword123')).message,'admin-already-present');assert.deepEqual(store.users.get('admin'),original);
    await assert.rejects(users.seedAdmin('member','member@example.test',password),/collision|not an administrator/i);
    const a=await actor();assert.match((await a.client.request('/admin/settings')).body,/over capacity/i);
    store.users.get('other-admin').isActive=false;await assert.rejects(users.seedAdmin('other-admin','other-admin@example.test',password),/disabled/);
  });
  it('assigns, removes and audits overrides without altering account identity, status or session version',async()=>{
    const a=await actor();await settings(a,'unlimited','2','10');const original=structuredClone(store.users.get('member'));
    assert.equal((await post(a,'/admin/settings/users/member/quota',{quotaGb:'unlimited'})).status,303);assert.deepEqual(store.users.get('member').storageQuotaOverride,{mode:'unlimited'});
    assert.equal((await post(a,'/admin/settings/users/member/quota',{quotaGb:'0.5'})).status,303);assert.equal(store.users.get('member').storageQuotaOverride.bytes,'500000000');
    assert.equal((await post(a,'/admin/settings/users/member/quota',{quotaGb:'inherit'})).status,303);assert.equal(store.users.get('member').storageQuotaOverride??null,null);
    const {storageQuotaOverride,updatedAt,...preserved}=store.users.get('member');const {updatedAt:previousUpdated,...identity}=original;assert.deepEqual(preserved,identity);
    assert.equal(store.audits.filter(e=>e.event==='user.quota_changed'&&e.details.targetUserId==='member').length,3);
    assert.match((await a.client.request('/admin/settings')).body,/Default quota/);
  });
  it('distinguishes explicit Not configured overrides from inherited defaults',async()=>{
    const a=await actor();await settings(a,'unlimited','2');await post(a,'/admin/settings/users/member/quota',{quotaGb:'not-configured'});
    assert.deepEqual(store.users.get('member').storageQuotaOverride,{mode:'not-configured'});assert.match((await a.client.request('/admin/settings')).body,/Individual override/);
  });
  it('renders a working CSRF token in each individual override form',async()=>{
    const a=await actor(),page=await a.client.request('/admin/settings');
    const form=/<form method="POST" action="\/admin\/settings\/users\/member\/quota">([\s\S]*?)<\/form>/.exec(page.body)?.[1];assert.ok(form);
    const csrf=token(form);assert.equal(csrf,a.csrf);
    assert.equal((await a.client.request('/admin/settings/users/member/quota',{quotaGb:'0.5',_csrf:csrf})).status,303);
    assert.equal(store.users.get('member').storageQuotaOverride.bytes,'500000000');
  });
  it('rejects invalid overrides, absent accounts and non-user policy documents',async()=>{
    const a=await actor();assert.equal((await post(a,'/admin/settings/users/member/quota',{quotaGb:'-1'})).status,400);
    assert.equal((await post(a,'/admin/settings/users/missing/quota',{quotaGb:'1'})).status,404);
    store.users.set('portal-settings',{_id:'portal-settings',...policy()});assert.equal((await post(a,'/admin/settings/users/portal-settings/quota',{quotaGb:'1'})).status,404);
    assert.equal((await post(a,'/admin/users/portal-settings/enable',{})).status,404);
  });
  it('protects override authorization, CSRF and whitelist validation',async()=>{
    const member=await actor('member'),a=await actor();assert.equal((await post(member,'/admin/settings/users/admin/quota',{quotaGb:'1'})).status,403);
    assert.equal((await a.client.request('/admin/settings/users/member/quota',{quotaGb:'1'})).status,403);
    assert.equal((await post(a,'/admin/settings/users/member/quota',{quotaGb:'1',role:'admin'})).status,400);assert.equal(store.users.get('member').storageQuotaOverride,undefined);
  });
  it('counts distinct managed files once globally and attributes only their metadata ownership',async()=>{
    store.files=[managed('a',600000000),managed('a',600000000),managed('b',400000001,'other-admin'),{_id:'nas',type:'file',sizeBytes:999999999999,uploadedByUserId:'member'}, {_id:'external',type:'file',storageScope:'external-nas',sizeBytes:99999}];
    const a=await actor();await settings(a,'unlimited','0.5','1');const page=await a.client.request('/admin/settings');assert.equal(page.status,200);
    assert.match(page.body,/Global known managed bytes: 1000000001/);assert.match(page.body,/Known bytes: 600000000/);assert.match(page.body,/Over limit/);assert.match(page.body,/Legacy or external metadata excluded: 2/);
  });
  it('includes preserved disabled/closed users files in global and owner usage',async()=>{
    store.users.get('member').isActive=false;store.users.get('member').closedAt='2026-01-01';store.files=[managed('kept',500)];
    const page=await(await actor()).client.request('/admin/settings');assert.match(page.body,/Global known managed bytes: 500/);assert.match(page.body,/Known bytes: 500/);
  });
  it('reports unowned files and unknown owners explicitly rather than assigning them to an administrator',async()=>{
    store.files=[managed('a',100,undefined),managed('b',200,'missing-owner')];delete store.files[0].uploadedByUserId;
    const page=await(await actor()).client.request('/admin/settings');assert.match(page.body,/Global known managed bytes: 300/);assert.match(page.body,/Unattributed known bytes: 300/);assert.match(page.body,/Incomplete attribution/);
  });
  it('reports invalid sizes and conflicting duplicate records as incomplete lower bounds',async()=>{
    store.files=[managed('a',-1),managed('b','100'),managed('c',10),managed('c',20),managed('d',25),managed('',30)];
    const page=await(await actor()).client.request('/admin/settings');assert.equal(page.status,200);assert.match(page.body,/Global known managed bytes: 25/);assert.match(page.body,/Incomplete metadata/);assert.match(page.body,/Unknown/);
  });
  it('sums usage above Number.MAX_SAFE_INTEGER exactly without floating-point rounding',async()=>{
    store.files=[managed('a',Number.MAX_SAFE_INTEGER),managed('b',Number.MAX_SAFE_INTEGER)];const page=await(await actor()).client.request('/admin/settings');assert.match(page.body,/Global known managed bytes: 18014398509481982/);
  });
  it('allows storage policy below known usage as reporting only and never modifies files',async()=>{
    store.files=[managed('a',2000000000)];const original=structuredClone(store.files),a=await actor();assert.equal((await settings(a,'unlimited','0','0')).status,303);assert.deepEqual(store.files,original);assert.match((await a.client.request('/admin/settings')).body,/Over limit/);
  });
  it('does not rewrite or audit idempotent policy and override submissions',async()=>{
    const a=await actor();await settings(a);await settings(a);await post(a,'/admin/settings/users/member/quota',{quotaGb:'1'});await post(a,'/admin/settings/users/member/quota',{quotaGb:'1'});
    assert.equal(store.audits.filter(e=>e.event==='portal.settings_changed').length,1);assert.equal(store.audits.filter(e=>e.event==='user.quota_changed').length,1);
  });
  it('treats semantically equal stored override JSON as unchanged regardless of key order',async()=>{
    store.users.get('member').storageQuotaOverride={bytes:'1000000000',mode:'limited'};const original=structuredClone(store.users.get('member')),a=await actor();
    assert.equal((await post(a,'/admin/settings/users/member/quota',{quotaGb:'1'})).status,303);assert.deepEqual(store.users.get('member'),original);
    assert.equal(store.audits.filter(e=>e.event==='user.quota_changed').length,0);
  });
  it('fails policy reads and activation closed on CouchDB errors, without treating errors as Not configured',async()=>{
    const a=await actor();pending();store.failRead=true;assert.equal((await a.client.request('/admin/settings')).status,503);assert.equal((await post(a,approve('pending'),{})).status,503);assert.equal(store.users.get('pending').isActive,false);
  });
  it('rejects malformed persisted policy rather than silently using unlimited defaults',async()=>{
    store.settings={...policy(),maxActiveUsers:{mode:'limited',count:-1}};const a=await actor();assert.equal((await a.client.request('/admin/settings')).status,503);
  });
  it('reports a failed settings write safely without changing policy or success audits',async()=>{
    const a=await actor();store.failWrite=true;const r=await settings(a);assert.equal(r.status,503);assert.equal(store.settings,null);assert.doesNotMatch(r.body,/private-write/);
  });
  it('reports settings/audit partial commits honestly and preserves saved settings',async()=>{
    const a=await actor();store.failAudit=true;const r=await settings(a,'3','1','2');assert.equal(r.status,503);assert.equal(store.settings.maxActiveUsers.count,3);assert.doesNotMatch(r.body,/private-audit|Settings not changed/);
  });
});
