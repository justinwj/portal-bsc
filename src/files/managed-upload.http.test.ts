import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, link, symlink, stat } from 'node:fs/promises';
import { promises as filesystem } from 'node:fs';
import { mock } from 'node:test';
import { request as httpRequest } from 'node:http';
import { within } from '../../test/integration/support';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import session from 'express-session';
import bcrypt from 'bcrypt';
import { AppModule } from '../app.module';
import { CouchDbService } from '../common/couchdb.service';
import { FilesService } from './files.service';
import { attachCsrfToken, csrfMiddleware } from '../common/csrf';
import { configureViews } from '../common/views';
import { ManagedStorage } from './managed-storage.service';
import { UsersService } from '../users/users.service';

// Only the external database is replaced. Routes, guards, sessions, CSRF,
// validation, filesystem operations and streamed HTTP bodies are real.
class UploadStore {
  users = new Map<string, any>(); files = new Map<string, any>(); docs = new Map<string, any>(); audits: any[] = []; downloads:any[]=[];
  settings: any = { type:'portal-settings',schemaVersion:1,maxActiveUsers:{mode:'unlimited'},defaultUserQuota:{mode:'limited',bytes:'10000000000'},globalStorageQuota:{mode:'limited',bytes:'100000000000'} };
  failRead = false; failWrite = false; failAudit = false; failAuditWrite=false;
  afterWrite?: (database:string,document:any)=>void;
  completedDownload?:()=>void;
  async listUsers(){return structuredClone([...this.users.values()]);}
  async findUserById(id:string){return structuredClone(this.users.get(id)??null);}
  async findUserByUsername(name:string){return (await this.listUsers()).find(u=>u.username===name)??null;}
  async saveUser(u:any){this.users.set(u._id,structuredClone(u));return structuredClone(u);}
  async listFiles(){if(this.failRead)throw Error('private-db-read');return structuredClone([...this.files.values()]);}
  async findFileById(id:string){return structuredClone(this.files.get(id)??null);}
  async getPortalSettings(){if(this.failRead)throw Error('private-db-read');return structuredClone(this.settings);}
  async savePortalSettings(s:any){this.settings=structuredClone(s);return s;}
  async getDocument(database:string,id:string){if(this.failRead)throw Error('private-db-read');return structuredClone((database==='portal_files'?this.files:this.docs).get(id)??null);}
  async putDocument(database:string,doc:any){
    if(this.failWrite||(database==='portal_audit'&&this.failAuditWrite))throw Error('private-db-write');const map=database==='portal_files'?this.files:this.docs,current=map.get(doc._id);
    if(current?._rev!==doc._rev)throw Object.assign(Error('conflict'),{statusCode:409});
    const next={...structuredClone(doc),_rev:String(Number(current?._rev??0)+1)};map.set(doc._id,next);this.afterWrite?.(database,next);return structuredClone(next);
  }
  async logAudit(event:string,details:any,userId?:string,username?:string,ip?:string){if(this.failAudit)throw Error('private-audit');const e={event,details,userId,username,ip,createdAt:new Date().toISOString()};this.audits.push(e);if(event==='file.download')this.completedDownload?.();return e;}
  async logDownload(userId:string,fileId:string,fileTitle:string,ip:string){this.downloads.push({userId,fileId,fileTitle,ip});}
}
describe('managed upload admission and streaming HTTP',{concurrency:false},()=>{
  let app:NestExpressApplication,store:UploadStore,root:string,nas:string,url:string;
  const original={...process.env},password='UploadPassword123';
  beforeEach(async()=>{
    const temporary=await mkdtemp(join(tmpdir(),'portal-upload-test-'));
    root=await filesystem.realpath(temporary);
    if(root!==temporary)console.log('Canonicalized disposable temporary storage root',JSON.stringify({temporary,canonical:root}));
    nas=join(root,'legacy');await mkdir(nas);await writeFile(join(nas,'sentinel.txt'),'legacy unchanged');
    const managed=join(root,'managed');await mkdir(managed);for(const d of ['staging','objects','quarantine'])await mkdir(join(managed,d));
    Object.assign(process.env,{NODE_ENV:'test',ALLOW_IN_MEMORY_SESSION_STORE:'true',NAS_FILES_DIR:nas,NAS_FILES_HOST_PATH:nas,PORTAL_UPLOADS_ENABLED:'true',PORTAL_UPLOADS_DIR:managed,PORTAL_UPLOADS_HOST_PATH:managed,PORTAL_UPLOADS_STORAGE_ID:randomUUID(),PORTAL_UPLOAD_MIN_FREE_BYTES:'1'});
    await writeFile(join(managed,'.portal-storage.json'),JSON.stringify({schemaVersion:1,id:process.env.PORTAL_UPLOADS_STORAGE_ID}));
    store=new UploadStore();const hash=await bcrypt.hash(password,4);for(const role of ['owner','member','admin'])store.users.set(role,{_id:role,type:'user',username:role,email:`${role}@example.test`,role:role==='admin'?'admin':'member',isActive:true,passwordHash:hash,sessionVersion:0});
    app=await NestFactory.create<NestExpressApplication>({module:AppModule,providers:[{provide:CouchDbService,useValue:store}]},{logger:false,abortOnError:false});
    app.use(session({secret:randomUUID(),resave:false,saveUninitialized:false,cookie:{maxAge:3600000},store:new session.MemoryStore()}));app.use(express.urlencoded({extended:false}));app.use(attachCsrfToken);app.use(csrfMiddleware);configureViews(app);
    app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));
    await app.get(FilesService).initializeStorage();await app.listen(0,'127.0.0.1');url=await app.getUrl();
  });
  afterEach(async()=>{mock.restoreAll();await app?.close();if(root)await rm(root,{recursive:true,force:true});for(const k of Object.keys(process.env))if(!(k in original))delete process.env[k];Object.assign(process.env,original);});
  function browser(){let cookie='';return {get cookie(){return cookie;},async request(path:string,body?:any,method=body===undefined?'GET':'POST',csrf?:string){
    const raw=Buffer.isBuffer(body);const r=await fetch(url+path,{method,headers:{cookie,...(body!==undefined?{'content-type':raw?'application/octet-stream':'application/json'}:{}),...(csrf===undefined?{}:{'x-csrf-token':csrf})},body:body===undefined?undefined:raw?new Uint8Array(body):JSON.stringify(body),redirect:'manual'});
    if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie')!.split(';')[0];return{status:r.status,headers:r.headers,body:await r.text()};
  }};}
  function token(html:string){const t=/name="_csrf" value="([a-f0-9]{64})"/.exec(html)?.[1];assert.ok(t,html);return t;}
  async function actor(name='owner'){const client=browser(),csrf=token((await client.request('/login')).body);assert.equal((await client.request('/login',{username:name,password},'POST',csrf)).status,302);return{client,csrf:token((await client.request('/')).body)};}
  async function confirm(){const a=await actor('admin');const r=await a.client.request('/admin/settings/uploads',{maxUploadGb:'1',confirm:'yes'},'POST',a.csrf);assert.equal(r.status,303,r.body);}
  async function intent(a:Awaited<ReturnType<typeof actor>>,bytes=3,name='sample.txt',key=randomUUID()){
    return a.client.request('/uploads/intents',{originalFilename:name,title:'Private title',description:'Private description',sizeBytes:String(bytes),idempotencyKey:key},'POST',a.csrf);
  }
  async function upload(a:Awaited<ReturnType<typeof actor>>,data=Buffer.from('abc'),name='sample.txt'){
    const r=await intent(a,data.length,name);assert.equal(r.status,201,r.body);const id=JSON.parse(r.body).id;
    const done=await a.client.request(`/uploads/${id}/content`,data,'PUT',a.csrf);assert.equal(done.status,200,done.body);return id;
  }
  it('provides an authenticated upload page with CSRF and unscanned/macro warnings',async()=>{const a=await actor();const r=await a.client.request('/uploads');assert.equal(r.status,200);assert.equal(token(r.body),a.csrf);assert.match(r.body,/Office|macro/i);assert.match(r.body,/not.*scanned|unscanned/i);});
  it('requires explicit administrator confirmation before accepting any reservation',async()=>{const a=await actor();assert.equal((await intent(a)).status,409);assert.equal(store.files.size,0);});
  it('reserves, streams and durably commits an owner-private file with exact bytes and hash',async()=>{
    await confirm();const a=await actor(),id=await upload(a),file=store.files.get(id);assert.equal(file.upload.state,'committed');assert.equal(file.uploadedByUserId,'owner');assert.equal(file.sizeBytes,3);assert.deepEqual(file.sharedWithUserIds,[]);assert.equal(file.sha256,createHash('sha256').update('abc').digest('hex'));assert.equal(file.scanResult,'not-scanned');
    assert.equal((await readFile(join(process.env.PORTAL_UPLOADS_DIR!,'objects',file.storedFilename))).toString(),'abc');assert.deepEqual(await readdir(join(process.env.PORTAL_UPLOADS_DIR!,'staging')),[]);assert.equal((await readFile(join(nas,'sentinel.txt'))).toString(),'legacy unchanged');
  });
  for(const tokenValue of [undefined,'wrong'])it(`rejects ${tokenValue??'missing'} upload CSRF before reservations`,async()=>{await confirm();const a=await actor();assert.equal((await a.client.request('/uploads/intents',{originalFilename:'a.txt',title:'a',description:'',sizeBytes:'1',idempotencyKey:randomUUID()},'POST',tokenValue)).status,403);assert.equal(store.files.size,0);});
  it('rejects unauthenticated uploads with a valid anonymous CSRF token',async()=>{await confirm();const client=browser(),csrf=token((await client.request('/login')).body);assert.equal((await client.request('/uploads/intents',{},'POST',csrf)).status,401);});
  it('rejects role, owner, path and sharing injection through strict DTO validation',async()=>{await confirm();const a=await actor();const r=await a.client.request('/uploads/intents',{originalFilename:'a.txt',title:'a',description:'',sizeBytes:'1',idempotencyKey:randomUUID(),uploadedByUserId:'admin',allowedRoles:['member'],storedFilename:'../outside'},'POST',a.csrf);assert.equal(r.status,400);assert.equal(store.files.size,0);});
  for(const name of ['../a.txt','a.exe','file.xll','a.txt.exe','bad\r\n.txt','NUL.txt'])it(`rejects unsafe or unsupported filename ${JSON.stringify(name)}`,async()=>{await confirm();const a=await actor();assert.equal((await intent(a,3,name)).status,400);assert.equal(store.files.size,0);});
  for(const mode of ['user','global','override'])it(`rejects Not configured ${mode} quota without fallback`,async()=>{await confirm();if(mode==='override')store.users.get('owner').storageQuotaOverride={mode:'not-configured'};else store.settings[mode==='user'?'defaultUserQuota':'globalStorageQuota']={mode:'not-configured'};const a=await actor();assert.equal((await intent(a)).status,409);assert.equal(store.files.size,0);});
  it('accepts exact capacity and refuses one byte over with no extra reservation',async()=>{await confirm();store.settings.defaultUserQuota={mode:'limited',bytes:'3'};const a=await actor();await upload(a);assert.equal((await intent(a,1)).status,409);});
  it('serializes concurrent reservations competing for the last global bytes',async()=>{await confirm();store.settings.globalStorageQuota={mode:'limited',bytes:'3'};const a=await actor(),b=await actor('member'),r=await Promise.all([intent(a),intent(b)]);assert.deepEqual(r.map(x=>x.status).sort(),[201,409]);assert.equal(store.files.size,1);});
  it('returns the same durable intent for retries and rejects changed parameters',async()=>{await confirm();const a=await actor(),key=randomUUID();const r=await intent(a,3,'a.txt',key),again=await intent(a,3,'a.txt',key);assert.equal(r.status,201);assert.equal(JSON.parse(r.body).id,JSON.parse(again.body).id);assert.equal(store.files.size,1);assert.equal((await intent(a,4,'a.txt',key)).status,409);});
  it('does not expose pending file metadata or payloads',async()=>{await confirm();const a=await actor(),r=await intent(a);assert.equal(r.status,201);const id=JSON.parse(r.body).id;assert.equal((await a.client.request(`/files/${id}`)).status,404);assert.equal((await a.client.request(`/download/${id}`)).status,404);assert.doesNotMatch((await a.client.request('/files')).body,/Private title/);});
  it('cleans a short stream and releases its reservation only after cleanup',async()=>{await confirm();const a=await actor(),r=await intent(a,5);const id=JSON.parse(r.body).id;assert.equal((await a.client.request(`/uploads/${id}/content`,Buffer.from('abc'),'PUT',a.csrf)).status,400);assert.equal(store.files.get(id).upload.state,'aborted');assert.deepEqual(await readdir(join(process.env.PORTAL_UPLOADS_DIR!,'staging')),[]);});
  it('rejects disguised executable content and never exposes it as an Office document',async()=>{await confirm();const a=await actor(),r=await intent(a,4,'report.docm');assert.equal(r.status,201);const id=JSON.parse(r.body).id;assert.equal((await a.client.request(`/uploads/${id}/content`,Buffer.from('MZ!!'),'PUT',a.csrf)).status,400);assert.equal(store.files.get(id).upload.state,'aborted');});
  it('revalidates quota changes before finalization',async()=>{await confirm();const a=await actor(),r=await intent(a),id=JSON.parse(r.body).id;store.settings.globalStorageQuota={mode:'limited',bytes:'2'};assert.equal((await a.client.request(`/uploads/${id}/content`,Buffer.from('abc'),'PUT',a.csrf)).status,409);assert.notEqual(store.files.get(id).upload.state,'committed');});
  it('fails closed on durable metadata errors without leaking internal details',async()=>{await confirm();const a=await actor();store.failRead=true;const r=await intent(a);assert.equal(r.status,503);assert.doesNotMatch(r.body,/private-db|portal-upload-test/);assert.equal(store.files.size,0);});
  it('never removes an existing destination after a promotion collision',async()=>{
    await confirm();const a=await actor(),r=await intent(a),id=JSON.parse(r.body).id,file=store.files.get(id),target=join(process.env.PORTAL_UPLOADS_DIR!,'objects',file.storedFilename);
    await writeFile(target,'unrelated collision sentinel');assert.equal((await a.client.request(`/uploads/${id}/content`,Buffer.from('abc'),'PUT',a.csrf)).status,503);assert.equal(await readFile(target,'utf8'),'unrelated collision sentinel');assert.notEqual(store.files.get(id).upload.state,'aborted');
  });
  it('never removes a pre-existing staging entry when exclusive creation fails',async()=>{
    await confirm();const a=await actor(),r=await intent(a),id=JSON.parse(r.body).id,file=store.files.get(id),target=join(process.env.PORTAL_UPLOADS_DIR!,'staging',file.storedFilename);
    await writeFile(target,'existing staging sentinel');assert.equal((await a.client.request(`/uploads/${id}/content`,Buffer.from('abc'),'PUT',a.csrf)).status,503);assert.equal(await readFile(target,'utf8'),'existing staging sentinel');
  });
  it('retains a charged reservation after an unlink failure and recovers it after restart',async()=>{
    await confirm();const a=await actor(),r=await intent(a,4),id=JSON.parse(r.body).id,storage=app.get(ManagedStorage);
    mock.method(filesystem,'unlink',async()=>{throw Object.assign(Error('fixture unlink failure'),{code:'EACCES'});});
    assert.equal((await a.client.request(`/uploads/${id}/content`,Buffer.from('abc'),'PUT',a.csrf)).status,400);assert.notEqual(store.files.get(id).upload.state,'aborted');mock.restoreAll();
    await storage.recover();assert.equal(store.files.get(id).upload.state,'aborted');
  });
  it('aborts and cleans interrupted known staging work during fresh-service recovery',async()=>{
    await confirm();const a=await actor(),r=await intent(a),id=JSON.parse(r.body).id,storage:any=app.get(ManagedStorage);let failed=false;
    mock.method(storage,'checkpoint',async(name:string)=>{if(name==='chunk'&&!failed){failed=true;store.failRead=true;throw Error('simulated abrupt persistence outage');}});
    assert.equal((await a.client.request(`/uploads/${id}/content`,Buffer.from('abc'),'PUT',a.csrf)).status,503);assert.notEqual(store.files.get(id).upload.state,'aborted');store.failRead=false;mock.restoreAll();await storage.recover();assert.equal(store.files.get(id).upload.state,'aborted');
    assert.deepEqual(await readdir(join(process.env.PORTAL_UPLOADS_DIR!,'staging')),[]);
  });
  it('does not release physical leftovers associated with an already-aborted record',async()=>{
    await confirm();const a=await actor(),r=await intent(a),id=JSON.parse(r.body).id;store.files.get(id).upload.state='aborted';await writeFile(join(process.env.PORTAL_UPLOADS_DIR!,'staging',store.files.get(id).storedFilename),'unexpected');await assert.rejects(app.get(ManagedStorage).recover());
  });
  it('fails admission when an unknown physical object makes accounting incomplete',async()=>{
    await confirm();await writeFile(join(process.env.PORTAL_UPLOADS_DIR!,'staging',randomUUID()),'unknown bytes');const a=await actor();assert.equal((await intent(a)).status,503);
  });
  it('expires unused intents safely without requiring application restart',async()=>{
    await confirm();store.settings.globalStorageQuota={mode:'limited',bytes:'3'};const a=await actor(),first=await intent(a),id=JSON.parse(first.body).id;store.files.get(id).upload.expiresAt=new Date(Date.now()-1).toISOString();assert.equal((await intent(a)).status,201);assert.equal(store.files.get(id).upload.state,'aborted');
  });
  it('does not erase possibly committed bytes when CouchDB accepts a write then loses its acknowledgement',async()=>{
    await confirm();const a=await actor(),r=await intent(a),id=JSON.parse(r.body).id;let failed=false;store.afterWrite=(db,doc)=>{if(db==='portal_files'&&doc.upload?.state==='committed'&&!failed){failed=true;throw Error('response lost after actual write');}};
    assert.equal((await a.client.request(`/uploads/${id}/content`,Buffer.from('abc'),'PUT',a.csrf)).status,503);const file=store.files.get(id);assert.equal(file.upload.state,'committed');assert.equal(await readFile(join(process.env.PORTAL_UPLOADS_DIR!,'objects',file.storedFilename),'utf8'),'abc');
    await app.get(ManagedStorage).recover();assert.equal((await a.client.request(`/uploads/${id}`)).status,200);
  });
  it('requires authenticated current sessions again at commit when logout occurs during the stream',async()=>{
    await confirm();const a=await actor(),r=await intent(a),id=JSON.parse(r.body).id,storage:any=app.get(ManagedStorage);mock.method(storage,'checkpoint',async(name:string)=>{if(name==='prepared')assert.equal((await a.client.request('/logout',{},'POST',a.csrf)).status,302);});
    assert.equal((await a.client.request(`/uploads/${id}/content`,Buffer.from('abc'),'PUT',a.csrf)).status,403);assert.equal(store.files.get(id).upload.state,'aborted');
  });
  it('rechecks account revocation and quota changes after the complete body arrives',async()=>{
    await confirm();const a=await actor(),r=await intent(a),id=JSON.parse(r.body).id,storage:any=app.get(ManagedStorage);mock.method(storage,'checkpoint',async(name:string)=>{if(name==='prepared'){store.users.get('owner').isActive=false;store.users.get('owner').sessionVersion++;}});
    assert.equal((await a.client.request(`/uploads/${id}/content`,Buffer.from('abc'),'PUT',a.csrf)).status,403);assert.equal(store.files.get(id).upload.state,'aborted');
  });
  it('recovery rejects a wrong storage marker and leaves all records unchanged',async()=>{await confirm();const before=structuredClone([...store.files]);await writeFile(join(process.env.PORTAL_UPLOADS_DIR!,'.portal-storage.json'),JSON.stringify({schemaVersion:1,id:randomUUID()}));await assert.rejects(app.get(ManagedStorage).recover());assert.deepEqual([...store.files],before);});
  it('does not create a missing production managed-storage directory',async()=>{const missing=join(root,'missing');process.env.PORTAL_UPLOADS_DIR=missing;await assert.rejects(app.get(FilesService).initializeStorage());await assert.rejects(stat(missing),(e:any)=>e.code==='ENOENT');});
  it('offers recommended quotas only after explicit confirmation on a fresh installation',async()=>{
    store.settings=null;const a=await actor('admin');assert.equal((await a.client.request('/admin/settings/uploads',{maxUploadGb:'1',confirm:'yes',useRecommended:'yes'},'POST',a.csrf)).status,303);
    assert.equal(store.settings.defaultUserQuota.bytes,'10000000000');assert.equal(store.settings.globalStorageQuota.bytes,'100000000000');assert.equal(store.docs.get('managed-upload-policy').maxFileBytes,'1000000000');
  });
  it('does not overwrite configured quotas when recommended defaults are explicitly requested',async()=>{
    store.settings.defaultUserQuota={mode:'limited',bytes:'777'};const a=await actor('admin');assert.equal((await a.client.request('/admin/settings/uploads',{maxUploadGb:'1',confirm:'yes',useRecommended:'yes'},'POST',a.csrf)).status,303);assert.equal(store.settings.defaultUserQuota.bytes,'777');assert.equal(store.settings.globalStorageQuota.bytes,'100000000000');
  });
  it('rejects a file above the administrator-adjusted per-file maximum with HTTP 413',async()=>{
    const a=await actor('admin');assert.equal((await a.client.request('/admin/settings/uploads',{maxUploadGb:'0.000000003',confirm:'yes'},'POST',a.csrf)).status,303);const owner=await actor();assert.equal((await intent(owner,4)).status,413);assert.equal(store.files.size,0);
  });
  it('retains quota reservations when metadata is corrupt, never guessing zero usage',async()=>{
    await confirm();const a=await actor(),r=await intent(a),id=JSON.parse(r.body).id;delete store.files.get(id).uploadedByUserId;assert.equal((await intent(a)).status,503);
  });
  it('rejects a symlink in the managed directory tree without touching its target',async()=>{
    const source=join(process.env.PORTAL_UPLOADS_DIR!,'staging');await rm(source,{recursive:true});await symlink(nas,source,process.platform==='win32'?'junction':'dir');await assert.rejects(app.get(FilesService).initializeStorage());assert.equal(await readFile(join(nas,'sentinel.txt'),'utf8'),'legacy unchanged');
  });
  async function share(a:Awaited<ReturnType<typeof actor>>,id:string,recipients:string[]){return a.client.request(`/files/${id}/sharing`,{recipientIds:recipients},'POST',a.csrf);}
  it('lets the owner list, inspect and download exact managed bytes with safe headers and completed audits',async()=>{
    await confirm();const a=await actor(),id=await upload(a);const page=await a.client.request(`/files/${id}`);assert.equal(page.status,200,page.body);assert.match(page.body,/Private description/);assert.match((await a.client.request('/files')).body,/Private title/);
    const audited=new Promise<void>(resolve=>{store.completedDownload=resolve;});const r=await a.client.request(`/download/${id}`);assert.equal(r.status,200,r.body);assert.equal(r.body,'abc');assert.equal(r.headers.get('content-length'),'3');assert.match(r.headers.get('content-disposition')!,/^attachment;/);assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.match(r.headers.get('cache-control')!,/private|no-store/);await within(audited,5000,'Completed download audit');assert.equal(store.downloads.length,1);assert.equal(store.downloads[0].userId,'owner');
  });
  for(const name of ['member','admin'])it(`does not grant ${name} private-file access or metadata by role`,async()=>{
    await confirm();const owner=await actor(),id=await upload(owner),other=await actor(name);
    for(const path of [`/files/${id}`,`/download/${id}`]){const r=await other.client.request(path);assert.equal(r.status,404);assert.doesNotMatch(r.body,/Private title|Private description|sample\.txt/);}
    assert.doesNotMatch((await other.client.request('/files')).body,/Private title/);
  });
  it('renders a CSRF-protected owner sharing interface listing only approved active recipients',async()=>{
    await confirm();store.users.set('pending',{...store.users.get('member'),_id:'pending',username:'hidden-pending',registration:{status:'pending'}});const a=await actor(),id=await upload(a),page=await a.client.request(`/files/${id}/sharing`);assert.equal(page.status,200);assert.equal(token(page.body),a.csrf);assert.match(page.body,/member/);assert.doesNotMatch(page.body,/hidden-pending|passwordHash/);
  });
  it('grants only selected recipients and revokes on subsequent listing, details and download requests',async()=>{
    await confirm();const owner=await actor(),id=await upload(owner),member=await actor('member');assert.equal((await share(owner,id,['member'])).status,303);assert.equal((await member.client.request(`/download/${id}`)).body,'abc');assert.match((await member.client.request('/files')).body,/Private title/);
    assert.equal((await share(owner,id,[])).status,303);assert.equal((await member.client.request(`/download/${id}`)).status,404);assert.equal((await member.client.request(`/files/${id}`)).status,404);assert.doesNotMatch((await member.client.request('/files')).body,/Private title/);
    const audits=[...store.docs.values()].filter(d=>d.type==='audit');const events=audits.filter(d=>['file.shared','file.sharing_revoked'].includes(d.event));assert.equal(events.length,2);assert.equal(events[0].userId,'owner');assert.equal(events[0].details.fileId,id);assert.deepEqual(events[0].details.next,['member']);
  });
  it('allows administrator downloads only after an explicit owner grant and durable access audit',async()=>{
    await confirm();const owner=await actor(),id=await upload(owner),admin=await actor('admin');assert.equal((await admin.client.request(`/download/${id}`)).status,404);assert.equal((await share(owner,id,['admin'])).status,303);
    assert.equal((await admin.client.request(`/download/${id}`)).body,'abc');assert.ok(store.audits.some(a=>a.event==='file.administrator_access'&&a.userId==='admin'&&a.details.fileId===id));
    store.failAudit=true;const denied=await admin.client.request(`/download/${id}`);assert.equal(denied.status,503);assert.doesNotMatch(denied.body,/Private description|sample\.txt|private-audit/);
  });
  it('does not let a recipient or administrator redistribute access',async()=>{
    await confirm();const owner=await actor(),id=await upload(owner);await share(owner,id,['member','admin']);for(const name of ['member','admin']){const other=await actor(name);assert.equal((await share(other,id,[])).status,404);assert.equal((await other.client.request(`/files/${id}/sharing`)).status,404);}assert.deepEqual(store.files.get(id).sharedWithUserIds,['member','admin']);
  });
  it('invalidates recipient grants across disable/reactivate cycles instead of resurrecting old privileges',async()=>{
    await confirm();const owner=await actor(),id=await upload(owner);assert.equal((await share(owner,id,['member'])).status,303);const member=await actor('member');store.users.get('member').isActive=false;store.users.get('member').sessionVersion++;assert.equal((await member.client.request(`/download/${id}`)).status,401);
    store.users.get('member').isActive=true;store.users.get('member').sessionVersion++;const fresh=await actor('member');assert.equal((await fresh.client.request(`/download/${id}`)).status,404);assert.equal((await share(owner,id,['member'])).status,303);assert.equal((await fresh.client.request(`/download/${id}`)).status,200);
  });
  it('suspends sharing after owner closure while preserving bytes, ownership and quota charge',async()=>{
    await confirm();const owner=await actor(),id=await upload(owner);assert.equal((await share(owner,id,['member'])).status,303);const member=await actor('member');store.users.get('owner').isActive=false;store.users.get('owner').closedAt=new Date().toISOString();store.users.get('owner').sessionVersion++;
    assert.equal((await member.client.request(`/download/${id}`)).status,404);assert.equal(store.files.get(id).uploadedByUserId,'owner');assert.equal(await readFile(join(process.env.PORTAL_UPLOADS_DIR!,'objects',store.files.get(id).storedFilename),'utf8'),'abc');
  });
  it('does not duplicate physical storage or quota charges when sharing with multiple users',async()=>{
    await confirm();const owner=await actor(),id=await upload(owner);const path=join(process.env.PORTAL_UPLOADS_DIR!,'objects',store.files.get(id).storedFilename),before=await stat(path);assert.equal((await share(owner,id,['member','admin'])).status,303);assert.equal(store.files.size,1);assert.equal((await stat(path)).ino,before.ino);const a=await actor('admin'),page=await a.client.request('/admin/settings');assert.match(page.body,/Global known managed bytes: 3/);
  });
  for(const csrf of [undefined,'wrong'])it(`requires ${csrf??'missing'} sharing CSRF even for the owner`,async()=>{await confirm();const owner=await actor(),id=await upload(owner);assert.equal((await owner.client.request(`/files/${id}/sharing`,{recipientIds:['member']},'POST',csrf)).status,403);assert.deepEqual(store.files.get(id).sharedWithUserIds,[]);});
  for(const state of ['missing','disabled','pending','closed'])it(`rejects ${state} sharing recipients without changing grants`,async()=>{
    await confirm();const owner=await actor(),id=await upload(owner);if(state==='missing')store.users.delete('member');if(state==='disabled')store.users.get('member').isActive=false;if(state==='pending')store.users.get('member').registration={status:'pending'};if(state==='closed')store.users.get('member').closedAt='2026-01-01';assert.equal((await share(owner,id,['member'])).status,400);assert.deepEqual(store.files.get(id).sharedWithUserIds,[]);
  });
  it('keeps legacy role-based NAS downloads readable through the original read-only boundary',async()=>{
    store.files.set('legacy',{_id:'legacy',type:'file',title:'Legacy',description:'external',storedFilename:'sentinel.txt',originalFilename:'legacy.txt',visibility:'private',allowedRoles:['member'],mimeType:'text/plain',sizeBytes:16});const member=await actor('member');assert.equal((await member.client.request('/download/legacy')).body,'legacy unchanged');
  });
  it('refuses a corrupt managed payload before sending successful download headers',async()=>{
    await confirm();const owner=await actor(),id=await upload(owner);await writeFile(join(process.env.PORTAL_UPLOADS_DIR!,'objects',store.files.get(id).storedFilename),'xyz');
    const r=await fetch(url+`/download/${id}`,{headers:{cookie:owner.client.cookie}});await r.arrayBuffer().catch(()=>undefined);assert.equal(r.status,500);assert.equal(store.downloads.length,0);assert.equal((await intent(owner)).status,503);
  });
  it('revalidates storage identity for managed reads as well as writes',async()=>{
    await confirm();const owner=await actor(),id=await upload(owner);await writeFile(join(process.env.PORTAL_UPLOADS_DIR!,'.portal-storage.json'),JSON.stringify({schemaVersion:1,id:randomUUID()}));assert.equal((await owner.client.request(`/download/${id}`)).status,503);
  });
  it('labels Private, Shared and Administrator access accurately in the browser',async()=>{
    await confirm();const owner=await actor(),id=await upload(owner);assert.match((await owner.client.request('/files')).body,/>Private</);assert.equal((await share(owner,id,['admin','member'])).status,303);assert.match((await owner.client.request('/files')).body,/>Shared</);const admin=await actor('admin');assert.match((await admin.client.request(`/files/${id}`)).body,/Administrator/);
  });
  it('shows confirmation after saving sharing and supports native unchecked-form revocation',async()=>{
    await confirm();const owner=await actor(),id=await upload(owner),saved=await share(owner,id,['member']);assert.equal(saved.status,303);const page=await owner.client.request(saved.headers.get('location')!);assert.match(page.body,/role="status"/);
    const revoked=await fetch(url+`/files/${id}/sharing`,{method:'POST',headers:{cookie:owner.client.cookie},body:new URLSearchParams({_csrf:owner.csrf}),redirect:'manual'});await revoked.text();assert.equal(revoked.status,303);assert.deepEqual(store.files.get(id).sharedWithUserIds,[]);
  });
  it('enforces a per-owner object budget even when quotas are Unlimited and bodies are empty',async()=>{
    await confirm();process.env.PORTAL_UPLOAD_MAX_OBJECTS_PER_USER='1';store.settings.defaultUserQuota={mode:'unlimited'};store.settings.globalStorageQuota={mode:'unlimited'};const owner=await actor();await upload(owner,Buffer.alloc(0),'empty.txt');assert.equal((await intent(owner,0,'another.txt')).status,409);
  });
  it('requires a durable download-start audit for owners as well as privileged recipients',async()=>{
    await confirm();const owner=await actor(),id=await upload(owner);store.failAudit=true;assert.equal((await owner.client.request(`/download/${id}`)).status,503);assert.equal(store.downloads.length,0);
  });
  it('reports the partial outcome clearly if upload-policy auditing fails',async()=>{
    const admin=await actor('admin');store.failAudit=true;const r=await admin.client.request('/admin/settings/uploads',{maxUploadGb:'1',confirm:'yes'},'POST',admin.csrf);assert.equal(r.status,503);assert.match(r.body,/policy changed/i);assert.equal(store.docs.get('managed-upload-policy').confirmed,true);
  });
  it('does not disclose private-file existence through different not-found messages',async()=>{
    await confirm();const owner=await actor(),id=await upload(owner),member=await actor('member');const denied=await member.client.request(`/download/${id}`),missing=await member.client.request('/download/upload-'+'0'.repeat(64));assert.equal(denied.status,404);assert.equal(missing.status,404);assert.equal(denied.body,missing.body);
  });
  it('cleans a real disconnected HTTP stream and permits a subsequent upload without restart',async()=>{
    await confirm();const owner=await actor(),r=await intent(owner,5),id=JSON.parse(r.body).id,storage:any=app.get(ManagedStorage);
    let chunkReady!:()=>void,cleanupReady!:()=>void;const chunk=new Promise<void>(resolve=>{chunkReady=resolve;}),cleaned=new Promise<void>(resolve=>{cleanupReady=resolve;});
    mock.method(storage,'checkpoint',async(name:string)=>{if(name==='chunk')chunkReady();if(name==='cleaned')cleanupReady();});
    const raw=httpRequest(url+`/uploads/${id}/content`,{method:'PUT',headers:{cookie:owner.client.cookie,'x-csrf-token':owner.csrf,'content-type':'application/octet-stream'}},res=>res.resume());raw.on('error',()=>undefined);
    try{raw.write('a');await within(chunk,5000,'Actual streamed chunk');raw.destroy();await within(cleaned,5000,'Disconnect cleanup');assert.equal(store.files.get(id).upload.state,'aborted');assert.deepEqual(await readdir(join(process.env.PORTAL_UPLOADS_DIR!,'staging')),[]);assert.equal((await intent(owner)).status,201);}finally{raw.destroy();}
  });
  it('keeps bytes charged and requires restart after an uncertain file-handle close',async()=>{
    await confirm();const owner=await actor(),r=await intent(owner),id=JSON.parse(r.body).id,storage=app.get(ManagedStorage);const actualOpen=filesystem.open;let release:(()=>Promise<void>)|undefined;
    mock.method(filesystem,'open',async(path:any,flags:any,mode?:any)=>{const handle=await actualOpen(path,flags,mode);if(String(path).startsWith(join(process.env.PORTAL_UPLOADS_DIR!,'staging'))){release=handle.close.bind(handle);mock.method(handle,'close',async()=>{throw Object.assign(Error('uncertain close'),{code:'EIO'});});}return handle;});
    try{assert.equal((await owner.client.request(`/uploads/${id}/content`,Buffer.from('abc'),'PUT',owner.csrf)).status,503);assert.notEqual(store.files.get(id).upload.state,'aborted');await assert.rejects(storage.recover());}finally{mock.restoreAll();await release?.();}
  });
  for(const host of ['same','nested'])it(`rejects ${host} declared host paths even when container paths are different`,async()=>{
    process.env.PORTAL_UPLOADS_HOST_PATH=host==='same'?nas:join(nas,'managed');await assert.rejects(app.get(FilesService).initializeStorage(),/separate|overlap/i);
  });
  it('refuses new reservations if an aborted journal unexpectedly still has physical bytes',async()=>{
    await confirm();const owner=await actor(),r=await intent(owner),id=JSON.parse(r.body).id;store.files.get(id).upload.state='aborted';await writeFile(join(process.env.PORTAL_UPLOADS_DIR!,'staging',store.files.get(id).storedFilename),'unexpected');assert.equal((await intent(owner)).status,503);
  });
  it('resolves managed file paths through the managed objects root rather than the legacy NAS',async()=>{
    await confirm();const owner=await actor(),id=await upload(owner);assert.equal(app.get(FilesService).getSecureFilePath(store.files.get(id)),join(process.env.PORTAL_UPLOADS_DIR!,'objects',store.files.get(id).storedFilename));
  });
  it('retains charges when known staging unexpectedly disappears outside the cleanup protocol',async()=>{
    await confirm();const owner=await actor(),r=await intent(owner),id=JSON.parse(r.body).id,storage:any=app.get(ManagedStorage);
    mock.method(storage,'checkpoint',async(name:string,file:any)=>{if(name==='synced'){await filesystem.unlink(join(process.env.PORTAL_UPLOADS_DIR!,'staging',file.storedFilename));throw Error('external staging removal');}});
    assert.equal((await owner.client.request(`/uploads/${id}/content`,Buffer.from('abc'),'PUT',owner.csrf)).status,503);assert.equal(store.files.get(id).upload.state,'quarantined');await assert.rejects(storage.recover());
  });
  it('records cleanup-pending before unlink so a failed final metadata write can recover absent files',async()=>{
    await confirm();const owner=await actor(),r=await intent(owner,4),id=JSON.parse(r.body).id;const actualUnlink=filesystem.unlink;
    mock.method(filesystem,'unlink',async(path:any)=>{await actualUnlink(path);store.failWrite=true;});
    assert.equal((await owner.client.request(`/uploads/${id}/content`,Buffer.from('abc'),'PUT',owner.csrf)).status,400);assert.equal(store.files.get(id).upload.state,'cleanup-pending');mock.restoreAll();store.failWrite=false;await app.get(ManagedStorage).recover();assert.equal(store.files.get(id).upload.state,'aborted');
  });
  it('rejects managed storage inside the application checkout to prevent static or image-layer exposure',async()=>{
    const isolated=join(process.cwd(),'tmp','upload-boundary-'+randomUUID());await mkdir(isolated,{recursive:true});for(const d of ['staging','objects','quarantine'])await mkdir(join(isolated,d));await writeFile(join(isolated,'.portal-storage.json'),JSON.stringify({schemaVersion:1,id:process.env.PORTAL_UPLOADS_STORAGE_ID}));
    process.env.PORTAL_UPLOADS_DIR=isolated;process.env.PORTAL_UPLOADS_HOST_PATH=isolated;try{await assert.rejects(app.get(FilesService).initializeStorage(),/application|checkout|overlap/i);}finally{await rm(isolated,{recursive:true,force:true});}
  });
  it('fails upload admission if a previously committed payload disappears',async()=>{
    await confirm();const owner=await actor(),id=await upload(owner);await filesystem.unlink(join(process.env.PORTAL_UPLOADS_DIR!,'objects',store.files.get(id).storedFilename));assert.equal((await intent(owner)).status,503);assert.equal(store.files.get(id).upload.state,'committed');
  });
  it('drains a previous sharing audit before accepting another ACL mutation during an audit outage',async()=>{
    await confirm();const owner=await actor(),id=await upload(owner);store.failAudit=true;store.failAuditWrite=true;const first=await share(owner,id,['member']);assert.equal(first.status,503);
    assert.equal((await share(owner,id,[])).status,503);assert.equal(store.files.get(id).upload.auditOutbox.length,1);assert.deepEqual(store.files.get(id).sharedWithUserIds,['member']);assert.match(first.body,/sharing.*saved|sharing changed/i);
  });
  it('does not confuse a dot-prefixed child directory with a parent traversal when checking root overlap',async()=>{
    const child=join(process.env.PORTAL_UPLOADS_DIR!,'..published');await mkdir(child);process.env.NAS_FILES_DIR=child;await assert.rejects(app.get(FilesService).initializeStorage(),/separate|overlap/i);
  });
  it('serializes a sharing decision queued during upload finalization without a stale audit write',async()=>{
    await confirm();const owner=await actor(),r=await intent(owner),id=JSON.parse(r.body).id,storage:any=app.get(ManagedStorage),users:any=app.get(UsersService),coordinate=users.coordinateStorage.bind(users);
    let waiting=false,queued!:()=>void,sharing:Promise<any>|undefined;const entered=new Promise<void>(resolve=>{queued=resolve;});
    mock.method(users,'coordinateStorage',(operation:any)=>{const actual=coordinate(operation);if(waiting)queued();return actual;});
    mock.method(storage,'checkpoint',async(name:string)=>{if(name==='committed'){waiting=true;sharing=share(owner,id,['member']);await within(entered,5000,'Actual sharing operation queued behind commit');waiting=false;}});
    const uploadResult=await owner.client.request(`/uploads/${id}/content`,Buffer.from('abc'),'PUT',owner.csrf);assert.equal(uploadResult.status,200,uploadResult.body);assert.equal((await sharing!).status,303);assert.deepEqual(store.files.get(id).sharedWithUserIds,['member']);assert.equal((await intent(owner)).status,201);
  });
  it('fails upload admission if committed physical bytes differ from quota metadata',async()=>{
    await confirm();const owner=await actor(),id=await upload(owner);await writeFile(join(process.env.PORTAL_UPLOADS_DIR!,'objects',store.files.get(id).storedFilename),'unexpected growth');assert.equal((await intent(owner)).status,503);
  });
});
