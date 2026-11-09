import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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

// Only the external database is replaced. Routes, guards, sessions, CSRF,
// validation, filesystem operations and streamed HTTP bodies are real.
class UploadStore {
  users = new Map<string, any>(); files = new Map<string, any>(); docs = new Map<string, any>(); audits: any[] = [];
  settings: any = { type:'portal-settings',schemaVersion:1,maxActiveUsers:{mode:'unlimited'},defaultUserQuota:{mode:'limited',bytes:'10000000000'},globalStorageQuota:{mode:'limited',bytes:'100000000000'} };
  failRead = false; failWrite = false; failAudit = false;
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
    if(this.failWrite)throw Error('private-db-write');const map=database==='portal_files'?this.files:this.docs,current=map.get(doc._id);
    if(current?._rev!==doc._rev)throw Object.assign(Error('conflict'),{statusCode:409});
    const next={...structuredClone(doc),_rev:String(Number(current?._rev??0)+1)};map.set(doc._id,next);return structuredClone(next);
  }
  async logAudit(event:string,details:any,userId?:string,username?:string,ip?:string){if(this.failAudit)throw Error('private-audit');const e={event,details,userId,username,ip,createdAt:new Date().toISOString()};this.audits.push(e);return e;}
}
describe('managed upload admission and streaming HTTP',{concurrency:false},()=>{
  let app:NestExpressApplication,store:UploadStore,root:string,nas:string,url:string;
  const original={...process.env},password='UploadPassword123';
  beforeEach(async()=>{
    root=await mkdtemp(join(tmpdir(),'portal-upload-test-'));nas=join(root,'legacy');await mkdir(nas);await writeFile(join(nas,'sentinel.txt'),'legacy unchanged');
    const managed=join(root,'managed');await mkdir(managed);for(const d of ['staging','objects','quarantine'])await mkdir(join(managed,d));
    Object.assign(process.env,{NODE_ENV:'test',ALLOW_IN_MEMORY_SESSION_STORE:'true',NAS_FILES_DIR:nas,PORTAL_UPLOADS_ENABLED:'true',PORTAL_UPLOADS_DIR:managed,PORTAL_UPLOADS_STORAGE_ID:randomUUID(),PORTAL_UPLOAD_MIN_FREE_BYTES:'1'});
    await writeFile(join(managed,'.portal-storage.json'),JSON.stringify({schemaVersion:1,id:process.env.PORTAL_UPLOADS_STORAGE_ID}));
    store=new UploadStore();const hash=await bcrypt.hash(password,4);for(const role of ['owner','member','admin'])store.users.set(role,{_id:role,type:'user',username:role,email:`${role}@example.test`,role:role==='admin'?'admin':'member',isActive:true,passwordHash:hash,sessionVersion:0});
    app=await NestFactory.create<NestExpressApplication>({module:AppModule,providers:[{provide:CouchDbService,useValue:store}]},{logger:false,abortOnError:false});
    app.use(session({secret:randomUUID(),resave:false,saveUninitialized:false,store:new session.MemoryStore()}));app.use(express.urlencoded({extended:false}));app.use(attachCsrfToken);app.use(csrfMiddleware);configureViews(app);
    app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));
    await app.get(FilesService).initializeStorage();await app.listen(0,'127.0.0.1');url=await app.getUrl();
  });
  afterEach(async()=>{await app?.close();if(root)await rm(root,{recursive:true,force:true});for(const k of Object.keys(process.env))if(!(k in original))delete process.env[k];Object.assign(process.env,original);});
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
});
