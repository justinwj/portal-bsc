import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, stat, watch } from 'node:fs/promises';
import { createServer, request as forwardRequest } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CouchDbService } from '../../src/common/couchdb.service';
import { UsersService } from '../../src/users/users.service';
import { UserRole } from '../../src/common/roles';
import { browser, dependencyUrl, formToken, launchApplication, sessionId, within } from './support';
import { createClient } from 'redis';
import { officePackage } from '../fixtures/documents';
const nano=require('nano');

describe('persistent managed uploads using real CouchDB and Redis',{concurrency:false,timeout:90000},()=>{
  const name=`uploads-${randomUUID()}`,password='ManagedUploadPassword123',storageId=randomUUID();
  let app:Awaited<ReturnType<typeof launchApplication>>,directory:string,root:string,db:any,couch:CouchDbService,originalPolicy:any,owner:any,member:any;
  const originalFixed=new Map<string,any>(),ids=new Set<string>();
  const baselinePolicy={type:'portal-settings',schemaVersion:1,maxActiveUsers:{mode:'unlimited'},defaultUserQuota:{mode:'limited',bytes:'10000000000'},globalStorageQuota:{mode:'limited',bytes:'100000000000'}};
  async function doc(database:string,id:string){try{return await db.use(database).get(id);}catch(e:any){if(e.statusCode===404)return null;throw e;}}
  async function replacePolicy(value:any){const previous=await doc('portal_users','portal-settings');await db.use('portal_users').insert({...value,_id:'portal-settings',_rev:previous?._rev});}
  function overrides(){return{PORTAL_UPLOADS_ENABLED:'true',PORTAL_UPLOADS_DIR:root,PORTAL_UPLOADS_HOST_PATH:root,PORTAL_UPLOADS_STORAGE_ID:storageId,PORTAL_UPLOAD_MIN_FREE_BYTES:'1048576'};}
  async function start(couchUrl?:string){app=await launchApplication(dependencyUrl('REDIS_URL'),{...overrides(),...(couchUrl?{COUCHDB_URL:couchUrl}:{})});await within(app.ready,15000,'Managed production application readiness');}
  async function actor(username=name){const client=browser(app.url),csrf=formToken((await client.request('/login')).body);assert.equal((await client.request('/login',{username,password,_csrf:csrf})).headers.get('location'),'/');return{client,csrf:formToken((await client.request('/')).body)};}
  async function intent(a:Awaited<ReturnType<typeof actor>>,size:number,filename='file.txt',key=randomUUID()){
    const r=await fetch(app.url+'/uploads/intents',{method:'POST',headers:{cookie:a.client.cookie,'x-forwarded-proto':'https','x-csrf-token':a.csrf,'content-type':'application/json'},body:JSON.stringify({originalFilename:filename,title:'Managed real-service title',description:'private managed content',sizeBytes:String(size),idempotencyKey:key})});const body=await r.json() as any;if(body.id)ids.add(body.id);return{status:r.status,...body};
  }
  async function content(a:Awaited<ReturnType<typeof actor>>,id:string,data:Buffer){const r=await fetch(app.url+`/uploads/${id}/content`,{method:'PUT',headers:{cookie:a.client.cookie,'x-forwarded-proto':'https','x-csrf-token':a.csrf,'content-type':'application/octet-stream'},body:new Uint8Array(data)});return{status:r.status,body:await r.text()};}
  async function upload(a:Awaited<ReturnType<typeof actor>>,data:Buffer=Buffer.from('abc'),filename='file.txt'){const reserved=await intent(a,data.length,filename);assert.equal(reserved.status,201);const done=await content(a,reserved.id,data);assert.equal(done.status,200,done.body);return reserved.id;}
  before(async()=>{
    dependencyUrl('REDIS_URL');db=nano(dependencyUrl('COUCHDB_URL'));couch=new CouchDbService();await couch.initialize({allowMemoryFallback:false});originalPolicy=await doc('portal_users','portal-settings');
    for(const id of ['managed-upload-policy','managed-storage-registration']){
      const previous=await doc('portal_users',id);assert.equal(previous,null,'Managed suite must not modify an existing live managed-storage installation');originalFixed.set(id,previous);
    }
    await replacePolicy(baselinePolicy);const users=new UsersService(couch);owner=await users.createUser({username:name,email:`${name}@example.test`,password,role:UserRole.ADMIN});member=await users.createUser({username:name+'-member',email:`${name}-member@example.test`,password,role:UserRole.MEMBER});
    directory=await mkdtemp(join(tmpdir(),'portal-real-managed-'));root=join(directory,'managed');await mkdir(root);for(const d of ['staging','objects','quarantine'])await mkdir(join(root,d));await writeFile(join(root,'.portal-storage.json'),JSON.stringify({schemaVersion:1,id:storageId}));
  });
  beforeEach(async()=>{await replacePolicy(baselinePolicy);await start();const a=await actor();const r=await a.client.request('/admin/settings/uploads',{maxUploadGb:'1',confirm:'yes',_csrf:a.csrf});assert.equal(r.status,303,r.body);});
  afterEach(async()=>{await app?.close();});
  after(async()=>{
    await app?.close();
    // Delete only this suite's positively identified disposable file metadata.
    // No database/volume or pre-existing record is removed.
    if(db){for(const id of ids){const file=await doc('portal_files',id);if(file){assert.equal(file.storageId,storageId);await db.use('portal_files').destroy(id,file._rev);}}
      for(const [id,original]of originalFixed){const current=await doc('portal_users',id);if(original)await db.use('portal_users').insert({...original,_rev:current?._rev});else if(current)await db.use('portal_users').destroy(id,current._rev);}
      if(originalPolicy)await replacePolicy(originalPolicy);else{const current=await doc('portal_users','portal-settings');if(current)await db.use('portal_users').destroy(current._id,current._rev);}}
    if(directory)await rm(directory,{recursive:true,force:true});
  });
  it('persists real bytes, exact quotas and upload audit with readback from a fresh app',async()=>{
    const a=await actor(),id=await upload(a),file=await doc('portal_files',id);assert.equal(file.upload.state,'committed');assert.equal(file.scanResult,'not-scanned');assert.equal(file.sha256,createHash('sha256').update('abc').digest('hex'));assert.equal(await readFile(join(root,'objects',file.storedFilename),'utf8'),'abc');
    await app.close();await start();const fresh=await actor();assert.equal((await fresh.client.request(`/download/${id}`)).body,'abc');
    const events=(await db.use('portal_audit').list({include_docs:true})).rows.map((r:any)=>r.doc).filter((e:any)=>e.event==='file.uploaded'&&e.details.fileId===id);assert.equal(events.length,1);assert.equal(events[0].userId,owner._id);assert.equal(file.upload.auditOutbox.length,0);
  });
  it('persists selective grants and revocation without duplicate storage or quota charges',async()=>{
    const a=await actor(),id=await upload(a),other=await actor(name+'-member');assert.equal((await other.client.request(`/download/${id}`)).status,404);
    assert.equal((await a.client.request(`/files/${id}/sharing`,{recipientIds:member._id,_csrf:a.csrf})).status,303);assert.equal((await other.client.request(`/download/${id}`)).body,'abc');const original=await doc('portal_files',id);
    await app.close();await start();const fresh=await actor(),recipient=await actor(name+'-member');assert.equal((await recipient.client.request(`/download/${id}`)).status,200);assert.equal((await fresh.client.request(`/files/${id}/sharing`,{_csrf:fresh.csrf})).status,303);assert.equal((await recipient.client.request(`/download/${id}`)).status,404);
    const file=await doc('portal_files',id);assert.equal(file.storedFilename,original.storedFilename);assert.equal(file.sizeBytes,3);assert.equal(file.uploadedByUserId,owner._id);
  });
  it('enforces competing real HTTP reservations at the exact remaining global boundary',async()=>{
    const docs=(await db.use('portal_files').list({include_docs:true})).rows.map((r:any)=>r.doc).filter((f:any)=>f.schemaVersion===2&&f.storageId===storageId&&f.upload.state!=='aborted');const used=docs.reduce((n:bigint,f:any)=>n+BigInt(f.sizeBytes),0n);
    await replacePolicy({...baselinePolicy,globalStorageQuota:{mode:'limited',bytes:(used+3n).toString()}});const a=await actor(),b=await actor(name+'-member'),r=await Promise.all([intent(a,3),intent(b,3)]);assert.deepEqual(r.map(x=>x.status).sort(),[201,409]);
  });
  it('round-trips macro-enabled Office bytes as an opaque attachment with no preview',async()=>{
    const a=await actor(),data=officePackage('xl/workbook.xml',true),id=await upload(a,data,'untrusted.xlsm');const r=await fetch(app.url+`/download/${id}`,{headers:{cookie:a.client.cookie,'x-forwarded-proto':'https'}});assert.equal(r.status,200);assert.match(r.headers.get('content-disposition')!,/^attachment;/);assert.equal(r.headers.get('content-type'),'application/octet-stream');assert.deepEqual(Buffer.from(await r.arrayBuffer()),data);
  });
  it('revokes real Redis sessions and does not resurrect sharing privileges after account reactivation',async()=>{
    const a=await actor(),id=await upload(a),recipient=await actor(name+'-member');assert.equal((await a.client.request(`/files/${id}/sharing`,{recipientIds:member._id,_csrf:a.csrf})).status,303);
    const redis=createClient({url:dependencyUrl('REDIS_URL')});await redis.connect();
    try{const key='sess:'+sessionId(recipient.client.cookie);assert.equal(await redis.exists(key),1);const users=new UsersService(couch);await users.setUserActive(member._id,false,owner._id,{ip:'127.0.0.1'});assert.equal((await recipient.client.request(`/download/${id}`)).status,401);
      await within((async()=>{while(await redis.exists(key))await new Promise(resolve=>setImmediate(resolve));})(),5000,'Real Redis session destruction');
      await users.setUserActive(member._id,true,owner._id,{ip:'127.0.0.1'});const fresh=await actor(name+'-member');assert.equal((await fresh.client.request(`/download/${id}`)).status,404);assert.equal((await a.client.request(`/files/${id}/sharing`,{recipientIds:member._id,_csrf:a.csrf})).status,303);assert.equal((await fresh.client.request(`/download/${id}`)).status,200);
    }finally{await redis.quit();}
  });
  it('gracefully aborts a real active stream before SIGTERM shutdown completes',async()=>{
    const a=await actor(),reservation=await intent(a,5);assert.equal(reservation.status,201);const file=await doc('portal_files',reservation.id),abort=new AbortController();
    const changes=watch(join(root,'staging'),{signal:abort.signal});const written=(async()=>{for await(const _change of changes){try{if((await stat(join(root,'staging',file.storedFilename))).size>0)return;}catch(error:any){if(error.code!=='ENOENT')throw error;}}})();
    const raw=forwardRequest(app.url+`/uploads/${reservation.id}/content`,{method:'PUT',headers:{cookie:a.client.cookie,'x-forwarded-proto':'https','x-csrf-token':a.csrf,'content-type':'application/octet-stream'}},res=>res.resume());raw.on('error',()=>undefined);
    try{raw.write('a');await within(written,5000,'Actual bytes on persistent staging');await app.close();assert.equal((await doc('portal_files',reservation.id)).upload.state,'aborted');await assert.rejects(readFile(join(root,'staging',file.storedFilename)),(error:any)=>error.code==='ENOENT');}
    finally{raw.destroy();abort.abort();await written.catch(()=>undefined);}
  });
  // A real HTTP proxy gates acknowledgements around actual CouchDB writes.
  // It replaces no database or application component and never handles payloads.
  async function gate(state:string,afterWrite:boolean){
    let reached!:()=>void;const ready=new Promise<void>(resolve=>{reached=resolve;});let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve;});let captured=false;
    const destination=new URL(dependencyUrl('COUCHDB_URL'));
    const server=createServer(async(req,res)=>{
      const chunks:Buffer[]=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>65536){req.destroy();return;}chunks.push(Buffer.from(chunk));}const body=Buffer.concat(chunks);let parsed:any;try{parsed=JSON.parse(body.toString());}catch{}
      const selected=!captured&&parsed?.upload?.state===state&&['POST','PUT'].includes(req.method!);if(selected){captured=true;if(!afterWrite){reached();await wait;if(res.destroyed)return;}}
      const target=forwardRequest({hostname:destination.hostname,port:destination.port,path:req.url,method:req.method,headers:req.headers},async upstream=>{
        if(selected&&afterWrite){const output:Buffer[]=[];for await(const chunk of upstream)output.push(Buffer.from(chunk));assert.equal(upstream.statusCode,201);reached();await wait;if(!res.destroyed){res.writeHead(upstream.statusCode!,upstream.headers);res.end(Buffer.concat(output));}}
        else{res.writeHead(upstream.statusCode!,upstream.headers);upstream.pipe(res);}
      });target.on('error',()=>{if(!res.destroyed)res.destroy();});target.end(body);
    });
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address() as any;const url=new URL(destination);url.port=String(address.port);
    return{ready,url:url.toString(),async close(){release();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
  }
  for(const point of [{state:'prepared',after:true,committed:false},{state:'committed',after:false,committed:false},{state:'committed',after:true,committed:true}])it(`recovers SIGKILL ${point.after?'after':'before'} durable ${point.state} acknowledgement without duplicate commit`,async()=>{
    await app.close();const proxy=await gate(point.state,point.after);let pending:Promise<any>|undefined,id:string|undefined;
    try{
      await start(proxy.url);const a=await actor(),r=await intent(a,3);assert.equal(r.status,201);id=r.id;
      pending=content(a,id!,Buffer.from('abc')).catch(error=>({transportFailure:error.message}));await within(proxy.ready,10000,'CouchDB commit boundary');app.crash();await app.close();await pending;await proxy.close();
      await start();const file=await doc('portal_files',id!);assert.equal(file.upload.state,point.committed?'committed':'aborted');
      if(point.committed){const current=await actor();assert.equal((await current.client.request(`/download/${id}`)).body,'abc');const audit=(await db.use('portal_audit').list({include_docs:true})).rows.map((r:any)=>r.doc).filter((e:any)=>e.event==='file.uploaded'&&e.details.fileId===id);assert.equal(audit.length,1);}
      else{await assert.rejects(readFile(join(root,'objects',file.storedFilename)),(e:any)=>e.code==='ENOENT');await assert.rejects(readFile(join(root,'staging',file.storedFilename)),(e:any)=>e.code==='ENOENT');}
    }finally{await proxy.close();await pending;}
  });
});
