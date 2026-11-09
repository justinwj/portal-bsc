import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException, OnModuleDestroy, PayloadTooLargeException, ServiceUnavailableException } from '@nestjs/common';
import { constants, promises as fs } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { Request } from 'express';
import type {} from 'express-session';
import { CouchDbService } from '../common/couchdb.service';
import { isAccessibleAccount } from '../common/account-state';
import { collectUsage, defaultPortalSettings, formatGB, parseStorageLimit, validatePortalSettings, validateStorageLimit } from '../common/quota-policy';
import { UsersService } from '../users/users.service';
import { UploadIntentDto, UploadPolicyDto } from './upload.dto';
import { uploadExtension, uploadExtensions, validateUploadContent } from './upload-types';

const POLICY = 'managed-upload-policy', STORAGE = 'managed-storage-registration';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const idPattern = /^upload-[a-f0-9]{64}$/;
const states = ['reserved','receiving','prepared','committed','cleanup-pending','aborted','quarantined'];
export interface ManagedFile {
  _id:string; _rev?:string; type:'file'; schemaVersion:2; storageScope:'portal-managed'; storageId:string;
  accessModel:'owner-acl-v1'; uploadedByUserId:string; sharedWithUserIds:string[];
  storedFilename:string; originalFilename:string; title:string; description:string;
  visibility:'private'; allowedRoles:[]; category:'managed'; mimeType:string; sizeBytes:number; sha256:string;
  scanResult:'not-scanned'; createdAt:string; updatedAt:string;
  upload:{state:string; declaredBytes:string; reservedBytes:string; fingerprint:string; sessionVersion:number;
    sessionDigest:string; expiresAt:string; auditOutbox:any[]; identity?:{dev:string;ino:string}};
}

@Injectable()
export class ManagedStorage implements OnModuleDestroy {
  private root?:string;
  private identity?:{dev:bigint;ino:bigint};
  private blocked = false;
  private stopping = false;
  private workers = new Map<string,{abort:()=>void;done:Promise<void>}>();
  constructor(private readonly database:CouchDbService,private readonly users:UsersService){}
  get configured(){return process.env.PORTAL_UPLOADS_ENABLED==='true';}
  get extensions(){return uploadExtensions.join(', ');}
  get objectsRoot(){if(!this.root)throw new ServiceUnavailableException('Managed storage is unavailable');return join(this.root,'objects');}
  private unavailable(){return new ServiceUnavailableException('Managed storage is unavailable or inconsistent. No quota or persistence fallback was used.');}
  private async document(db:'portal_users'|'portal_files'|'portal_audit',id:string){try{return await this.database.getDocument(db,id);}catch{this.blocked=true;throw this.unavailable();}}
  private async save(db:'portal_users'|'portal_files'|'portal_audit',doc:any){try{return await this.database.putDocument(db,doc);}catch{this.blocked=true;throw this.unavailable();}}
  private valid(doc:any):asserts doc is ManagedFile {
    if(!doc||doc.type!=='file'||doc.schemaVersion!==2||doc.storageScope!=='portal-managed'||doc.accessModel!=='owner-acl-v1'||!idPattern.test(doc._id)||!uuid.test(doc.storedFilename)
      ||doc.storageId!==process.env.PORTAL_UPLOADS_STORAGE_ID||!states.includes(doc.upload?.state)||!/^\d{1,16}$/.test(doc.upload?.reservedBytes)||!/^\d{1,16}$/.test(doc.upload?.declaredBytes)
      ||!Number.isSafeInteger(doc.sizeBytes)||doc.sizeBytes<0||BigInt(doc.upload.declaredBytes)!==BigInt(doc.sizeBytes)||BigInt(doc.upload.reservedBytes)!==BigInt(doc.sizeBytes)
      ||typeof doc.uploadedByUserId!=='string'||!Array.isArray(doc.sharedWithUserIds)||doc.sharedWithUserIds.some((id:any)=>typeof id!=='string')||new Set(doc.sharedWithUserIds).size!==doc.sharedWithUserIds.length
      ||!Array.isArray(doc.upload.auditOutbox)||doc.upload.auditOutbox.length>100)throw this.unavailable();
    if(doc.upload.state==='committed'&&!/^[a-f0-9]{64}$/.test(doc.sha256))throw this.unavailable();
  }
  private async syncDirectory(path:string){
    // Windows development does not certify directory-entry power-loss durability.
    if(process.platform==='win32'&&process.env.NODE_ENV!=='production')return;
    const handle=await fs.open(path,constants.O_RDONLY);try{await handle.sync();}finally{await handle.close();}
  }
  private async roots(){
    if(!this.root||!this.identity)throw this.unavailable();
    for(const path of [this.root,...['staging','objects','quarantine'].map(d=>join(this.root!,d))]){
      const info=await fs.lstat(path,{bigint:true});if(!info.isDirectory()||info.isSymbolicLink()||info.dev!==this.identity.dev||await fs.realpath(path)!==path)throw this.unavailable();
      if(path===this.root&&info.ino!==this.identity.ino)throw this.unavailable();
    }
    const marker=join(this.root,'.portal-storage.json'),info=await fs.lstat(marker);if(!info.isFile()||info.isSymbolicLink()||info.size>1024)throw this.unavailable();
    const data=JSON.parse(await fs.readFile(marker,'utf8'));if(data.schemaVersion!==1||data.id!==process.env.PORTAL_UPLOADS_STORAGE_ID)throw this.unavailable();
  }
  async initialize(legacyRoot:string){
    if(process.env.PORTAL_UPLOADS_ENABLED!==undefined&&!['true','false'].includes(process.env.PORTAL_UPLOADS_ENABLED))throw Error('PORTAL_UPLOADS_ENABLED must be true or false');
    if(!this.configured)return;
    const configured=process.env.PORTAL_UPLOADS_DIR,id=process.env.PORTAL_UPLOADS_STORAGE_ID;
    if(!configured||!isAbsolute(configured)||!id||!uuid.test(id)||!/^([1-9]\d{0,15})$/.test(process.env.PORTAL_UPLOAD_MIN_FREE_BYTES??''))throw Error('Explicit managed-storage directory, identity and free-space reserve are required');
    if(process.env.NODE_ENV==='production'&&process.platform!=='linux')throw Error('Production managed storage requires the verified Linux filesystem backend');
    const root=resolve(configured);if(await fs.realpath(root)!==root)throw Error('Managed storage must not use symlink roots');
    const legacy=await fs.realpath(legacyRoot);if(!relative(root,legacy)||!relative(root,legacy).startsWith('..')||!relative(legacy,root).startsWith('..'))throw Error('Managed and legacy storage must not overlap');
    this.root=root;const stat=await fs.lstat(root,{bigint:true});this.identity={dev:stat.dev,ino:stat.ino};await this.roots();
    // Probe only the dedicated root; never create anything in the legacy mount.
    const key=randomUUID(),probe=join(root,'staging',key),link=join(root,'objects',key);let handle;
    try{handle=await fs.open(probe,constants.O_CREAT|constants.O_EXCL|constants.O_RDWR,0o600);await handle.writeFile('probe');await handle.sync();await handle.close();handle=undefined;await fs.link(probe,link);await fs.unlink(probe);await fs.unlink(link);await this.syncDirectory(join(root,'staging'));await this.syncDirectory(join(root,'objects'));}
    finally{await handle?.close();}
    await this.recover();
  }
  private async account(id:string,sessionVersion?:number){const user=await this.users.findById(id);if(!isAccessibleAccount(user)||(sessionVersion!==undefined&&(user.sessionVersion??0)!==sessionVersion))throw new ForbiddenException('An active approved account and current login are required');return user;}
  private async administrator(id:string){const actor=await this.account(id);if(actor.role!=='admin')throw new ForbiddenException('An active administrator is required');return actor;}
  private async policy(){const p=await this.document('portal_users',POLICY);if(!p||p.confirmed!==true||p.schemaVersion!==1||!/^([1-9]\d{0,15})$/.test(p.maxFileBytes))throw new ConflictException('An administrator must confirm configured upload policies before uploads are enabled');return p;}
  async settings(actorId:string){await this.administrator(actorId);const policy=this.configured?await this.document('portal_users',POLICY):null;return{configured:this.configured,confirmed:policy?.confirmed===true,maxUploadGb:policy?formatGB(BigInt(policy.maxFileBytes)):'1',extensions:this.extensions};}
  async configure(dto:UploadPolicyDto,actorId:string,context:any){return this.users.coordinateStorage(async()=>{
    const actor=await this.administrator(actorId);if(!this.configured||!this.root)throw new ConflictException('Provision managed storage before enabling uploads');await this.roots();
    const max=parseStorageLimit(dto.maxUploadGb);if(max.mode!=='limited'||BigInt(max.bytes)<=0n)throw new BadRequestException('The maximum upload must be a positive numeric GB limit');
    const old=await this.document('portal_users',POLICY),stored=await this.database.getPortalSettings();
    let policy=stored===null?defaultPortalSettings():validatePortalSettings(stored);
    if(dto.useRecommended==='yes'){
      const previous=structuredClone(policy);policy={...policy,defaultUserQuota:policy.defaultUserQuota.mode==='not-configured'?{mode:'limited',bytes:'10000000000'}:policy.defaultUserQuota,globalStorageQuota:policy.globalStorageQuota.mode==='not-configured'?{mode:'limited',bytes:'100000000000'}:policy.globalStorageQuota};
      if(JSON.stringify(previous)!==JSON.stringify(policy)){await this.database.savePortalSettings(policy);await this.database.logAudit('portal.settings_changed',{previous,next:policy,source:'explicit-upload-confirmation'},actor._id,actor.username,context.ip);}
    }
    if(policy.defaultUserQuota.mode==='not-configured'||policy.globalStorageQuota.mode==='not-configured')throw new ConflictException('Explicitly configure both quota policies or confirm the recommended values');
    const registration=await this.document('portal_users',STORAGE);if(registration&&registration.storageId!==process.env.PORTAL_UPLOADS_STORAGE_ID)throw this.unavailable();
    if(!registration)await this.save('portal_users',{_id:STORAGE,type:'managed-storage-registration',schemaVersion:1,storageId:process.env.PORTAL_UPLOADS_STORAGE_ID});
    const next={...old,_id:POLICY,type:'managed-upload-policy',schemaVersion:1,confirmed:true,maxFileBytes:max.bytes,updatedAt:new Date().toISOString(),updatedBy:actor._id};
    await this.save('portal_users',next);await this.database.logAudit('upload.policy_changed',{previous:old?{maxFileBytes:old.maxFileBytes,confirmed:old.confirmed}:null,next:{maxFileBytes:max.bytes,confirmed:true}},actor._id,actor.username,context.ip);
  });}
  private async ledger(){
    const files=await this.database.listFiles(),users=await this.users.listUsers();
    for(const file of files)if((file as any).schemaVersion===2)this.valid(file);
    const known=new Set(files.filter((f:any)=>f.schemaVersion===2).map(f=>f.storedFilename));
    for(const directory of ['staging','objects','quarantine']){const entries=await fs.opendir(join(this.root!,directory));for await(const entry of entries){if(!known.has(entry.name)||!entry.isFile()||directory==='quarantine')throw this.unavailable();}}
    // A legacy managed marker without storage provenance cannot authorize writes.
    if(files.some(f=>f.storageScope==='portal-managed'&&(f as any).schemaVersion!==2))throw this.unavailable();
    const charged=files.filter((f:any)=>f.schemaVersion!==2||f.upload.state!=='aborted');const usage=collectUsage(charged,users);
    if(!usage.complete||!usage.attributionComplete)throw this.unavailable();return{files:files as unknown as ManagedFile[],usage};
  }
  private async capacity(user:any,extra:bigint){
    const stored=await this.database.getPortalSettings(),policy=validatePortalSettings(stored),personal=user.storageQuotaOverride==null?policy.defaultUserQuota:validateStorageLimit(user.storageQuotaOverride);
    if(policy.globalStorageQuota.mode==='not-configured'||personal.mode==='not-configured')throw new ConflictException('Configure the applicable global and user quotas before uploading');
    const {files,usage}=await this.ledger();
    if((policy.globalStorageQuota.mode==='limited'&&usage.knownBytes+extra>BigInt(policy.globalStorageQuota.bytes))||(personal.mode==='limited'&&(usage.perUser.get(user._id)??0n)+extra>BigInt(personal.bytes)))throw new ConflictException('Insufficient managed-storage quota');
    await this.disk(files,extra);return files;
  }
  private async disk(files:ManagedFile[],extra:bigint){
    let remaining=extra;
    for(const f of files.filter(f=>f.schemaVersion===2&&!['committed','aborted'].includes(f.upload.state))){let written=0n;for(const directory of ['staging','objects']){try{const s=await fs.lstat(join(this.root!,directory,f.storedFilename),{bigint:true});if(!s.isFile()||s.isSymbolicLink())throw this.unavailable();written=s.size;break;}catch(e:any){if(e.code!=='ENOENT')throw e;}}remaining+=BigInt(f.upload.reservedBytes)>written?BigInt(f.upload.reservedBytes)-written:0n;}
    const disk=await fs.statfs(this.root!,{bigint:true});if(disk.bavail*disk.bsize<remaining+BigInt(process.env.PORTAL_UPLOAD_MIN_FREE_BYTES!)+1048576n)throw new ServiceUnavailableException('Managed storage has insufficient free disk space');
  }
  async reserve(dto:UploadIntentDto,req:Request&{session?:any}){return this.users.coordinateStorage(async()=>{
    try{
      if(!this.configured||!this.root||this.blocked||this.stopping)throw this.unavailable();await this.roots();const policy=await this.policy(),user=await this.account(req.session.user.id,req.session.user.sessionVersion??0);
      for(const pending of await this.database.listFiles()){
        const file=pending as unknown as ManagedFile;
        if(file.schemaVersion===2&&file.upload?.state==='reserved'&&new Date(file.upload.expiresAt).getTime()<=Date.now())await this.cleanup(file);
      }
      uploadExtension(dto.originalFilename);if(!/^(0|[1-9]\d{0,15})$/.test(dto.sizeBytes)||BigInt(dto.sizeBytes)>BigInt(Number.MAX_SAFE_INTEGER))throw new BadRequestException('Invalid exact byte size');
      if(BigInt(dto.sizeBytes)>BigInt(policy.maxFileBytes))throw new PayloadTooLargeException('File exceeds the configured maximum upload size');
      const id='upload-'+createHash('sha256').update(user._id+'\0'+dto.idempotencyKey).digest('hex'),fingerprint=createHash('sha256').update(JSON.stringify([dto.originalFilename,dto.title,dto.description,dto.sizeBytes])).digest('hex');
      const existing=await this.document('portal_files',id);if(existing){this.valid(existing);if(existing.upload.fingerprint!==fingerprint)throw new ConflictException('Retry key already belongs to a different upload');return{id,state:existing.upload.state};}
      const files=await this.capacity(user,BigInt(dto.sizeBytes)),pending=files.filter(f=>f.schemaVersion===2&&!['aborted','committed'].includes(f.upload.state));
      if(pending.length>=16||pending.filter(f=>f.uploadedByUserId===user._id).length>=2)throw new ConflictException('Too many outstanding upload reservations');
      const now=new Date().toISOString();const file:ManagedFile={_id:id,type:'file',schemaVersion:2,storageScope:'portal-managed',storageId:process.env.PORTAL_UPLOADS_STORAGE_ID!,accessModel:'owner-acl-v1',uploadedByUserId:user._id,sharedWithUserIds:[],storedFilename:randomUUID(),originalFilename:dto.originalFilename,title:dto.title,description:dto.description,visibility:'private',allowedRoles:[],category:'managed',mimeType:'application/octet-stream',sizeBytes:Number(dto.sizeBytes),sha256:'',scanResult:'not-scanned',createdAt:now,updatedAt:now,
        upload:{state:'reserved',declaredBytes:dto.sizeBytes,reservedBytes:dto.sizeBytes,fingerprint,sessionVersion:user.sessionVersion??0,sessionDigest:createHash('sha256').update(req.sessionID).digest('hex'),expiresAt:new Date(Date.now()+600000).toISOString(),auditOutbox:[]}};
      await this.save('portal_files',file);await this.checkpoint('reserved',file);return{id,state:'reserved'};
    }catch(error){if(error instanceof HttpException)throw error;this.blocked=true;throw this.unavailable();}
  });}
  async status(id:string,userId:string){const doc=await this.document('portal_files',id);if(!doc||doc.uploadedByUserId!==userId)throw new NotFoundException('Upload not found');this.valid(doc);return{id:doc._id,state:doc.upload.state};}
  protected async checkpoint(_name:string,_file:ManagedFile):Promise<void>{}
  private async liveSession(req:Request&{session?:any},file:ManagedFile){
    if(createHash('sha256').update(req.sessionID).digest('hex')!==file.upload.sessionDigest)throw new ForbiddenException('Use the original current login for this upload');
    const current:any=await new Promise((resolve,reject)=>req.sessionStore.get(req.sessionID,(error,session)=>error?reject(error):resolve(session)));
    if(!current?.user||current.user.id!==file.uploadedByUserId||new Date(current.cookie?.expires??0).getTime()<=Date.now())throw new ForbiddenException('The upload login expired or was revoked');
    return this.account(file.uploadedByUserId,file.upload.sessionVersion);
  }
  async receive(id:string,req:Request&{session?:any}){
    let file:ManagedFile,done!:()=>void;const finished=new Promise<void>(resolve=>{done=resolve;});
    await this.users.coordinateStorage(async()=>{
      if(!this.root||this.blocked||this.stopping)throw this.unavailable();await this.roots();const doc=await this.document('portal_files',id);if(!doc||doc.uploadedByUserId!==req.session.user.id)throw new NotFoundException('Upload not found');this.valid(doc);file=doc;
      await this.liveSession(req,file);if(file.upload.state==='committed')throw new ConflictException('Upload already committed; inspect its status');
      if(file.upload.state!=='reserved'||new Date(file.upload.expiresAt).getTime()<=Date.now())throw new ConflictException('Upload reservation expired or is already in use');
      if(req.headers['content-type']!=='application/octet-stream'||req.headers['content-encoding'])throw new BadRequestException('A raw uncompressed file body is required');
      if(this.workers.size>=2||[...this.workers.keys()].some(key=>key.startsWith(file.uploadedByUserId+'\0')))throw new ConflictException('An upload is already active; try again later');
      file.upload.state='receiving';file=await this.save('portal_files',file);
      this.workers.set(file.uploadedByUserId+'\0'+id,{abort:()=>req.destroy(),done:finished});
    });
    let handle:fs.FileHandle|undefined;const key=file!.uploadedByUserId+'\0'+id;const timer=setTimeout(()=>req.destroy(),3600000);timer.unref();req.setTimeout(60000,()=>req.destroy());
    try{
      await this.checkpoint('receiving',file!);const path=join(this.root!,'staging',file!.storedFilename);handle=await fs.open(path,constants.O_CREAT|constants.O_EXCL|constants.O_RDWR|(constants.O_NOFOLLOW??0),0o600);
      const created=await handle.stat({bigint:true});if(!created.isFile()||created.nlink!==1n)throw this.unavailable();file!.upload.identity={dev:created.dev.toString(),ino:created.ino.toString()};file=await this.save('portal_files',file!);
      await this.checkpoint('created',file!);let length=0;const hash=createHash('sha256');
      for await(const data of req){const chunk=Buffer.isBuffer(data)?data:Buffer.from(data);if(length+chunk.length>file!.sizeBytes)throw new BadRequestException('File body exceeds its declared size');length+=chunk.length;hash.update(chunk);await handle.writeFile(chunk);await this.checkpoint('chunk',file!);}
      if(length!==file!.sizeBytes)throw new BadRequestException('Incomplete file body');
      file!.mimeType=await validateUploadContent(handle,length,file!.originalFilename);file!.sha256=hash.digest('hex');await handle.sync();await handle.close();handle=undefined;await this.syncDirectory(join(this.root!,'staging'));await this.checkpoint('synced',file!);
      file!.upload.state='prepared';file=await this.save('portal_files',file!);await this.checkpoint('prepared',file!);
      await this.users.coordinateStorage(async()=>{
        await this.roots();await this.policy();const actor=await this.liveSession(req,file!);const max=await this.policy();if(BigInt(file!.sizeBytes)>BigInt(max.maxFileBytes))throw new ConflictException('The upload-size policy changed');await this.capacity(actor,0n);
        const source=join(this.root!,'staging',file!.storedFilename),target=join(this.root!,'objects',file!.storedFilename),info=await fs.lstat(source,{bigint:true});if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1n||info.size!==BigInt(file!.sizeBytes))throw this.unavailable();
        await fs.link(source,target);await this.syncDirectory(join(this.root!,'objects'));await this.checkpoint('linked',file!);await fs.unlink(source);await this.syncDirectory(join(this.root!,'staging'));await this.checkpoint('promoted',file!);
        const final=await fs.lstat(target,{bigint:true});if(final.ino!==info.ino||final.dev!==info.dev||final.nlink!==1n)throw this.unavailable();
        file!.upload.state='committed';this.event(file!,'file.uploaded',actor,req,{sizeBytes:file!.sizeBytes,sha256:file!.sha256});file=await this.save('portal_files',file!);await this.checkpoint('committed',file!);
        const verified=await this.document('portal_files',id);this.valid(verified);if(verified.upload.state!=='committed'||verified.sha256!==file!.sha256)throw this.unavailable();
      });
      await this.deliver(file!);return{id,state:'committed'};
    }catch(error){
      await handle?.close().catch(()=>undefined);handle=undefined;
      // A failed acknowledgement may already have committed. Never delete that
      // object or infer absence from a transport failure.
      try{const current=await this.document('portal_files',id);if(current){this.valid(current);if(current.upload.state!=='committed')await this.users.coordinateStorage(()=>this.cleanup(current));}}catch{this.blocked=true;}
      if(error instanceof BadRequestException||error instanceof ConflictException||error instanceof ForbiddenException)throw error;
      this.blocked=true;throw this.unavailable();
    }finally{clearTimeout(timer);req.setTimeout(0);await handle?.close().catch(()=>undefined);this.workers.delete(key);done();}
  }
  private event(file:ManagedFile,event:string,actor:any,req:any,details:any){file.upload.auditOutbox.push({_id:'upload-event-'+randomUUID(),type:'audit',event,userId:actor._id,username:actor.username,ip:req.ip,createdAt:new Date().toISOString(),details:{fileId:file._id,ownerId:file.uploadedByUserId,...details}});}
  private async deliver(file:ManagedFile){
    for(const event of file.upload.auditOutbox){const existing=await this.document('portal_audit',event._id);if(existing){const {_rev,...data}=existing;if(JSON.stringify(data)!==JSON.stringify(event))throw this.unavailable();}else await this.save('portal_audit',event);}
    // Keep deterministic delivery evidence in the journal; no second write is
    // needed after delivery. Repeated recovery checks the same event IDs.
  }
  private async cleanup(file:ManagedFile){
    await this.roots();this.valid(file);if(file.upload.state==='committed')throw this.unavailable();
    // Validate every candidate before removing either alias. A collision is not
    // evidence that the existing destination belongs to this upload.
    const present=[];
    for(const directory of ['staging','objects']){try{const info=await fs.lstat(join(this.root!,directory,file.storedFilename),{bigint:true});present.push(info);if(!file.upload.identity||!info.isFile()||info.isSymbolicLink()||info.dev.toString()!==file.upload.identity.dev||info.ino.toString()!==file.upload.identity.ino)throw this.unavailable();}catch(error:any){if(error.code!=='ENOENT')throw error;}}
    for(const info of present)if(info.nlink!==BigInt(present.length))throw this.unavailable();
    for(const directory of ['staging','objects']){
      const path=join(this.root!,directory,file.storedFilename);try{const info=await fs.lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.nlink>2)throw this.unavailable();await fs.unlink(path);await this.syncDirectory(join(this.root!,directory));}catch(error:any){if(error.code!=='ENOENT')throw error;}
    }
    file.upload.state='aborted';await this.save('portal_files',file);await this.checkpoint('cleaned',file);
  }
  async recover(){return this.users.coordinateStorage(async()=>{
    if(!this.configured||!this.root)return;
    this.blocked=true;await this.roots();if(this.workers.size)throw this.unavailable();
    const registration=await this.document('portal_users',STORAGE);if(registration&&registration.storageId!==process.env.PORTAL_UPLOADS_STORAGE_ID)throw this.unavailable();
    const files=await this.database.listFiles(),known=new Map<string,ManagedFile>();
    for(const entry of files){if((entry as any).schemaVersion!==2)continue;const file=entry as unknown as ManagedFile;this.valid(file);if(known.has(file.storedFilename))throw this.unavailable();known.set(file.storedFilename,file);}
    for(const directory of ['staging','objects','quarantine']){const iterator=await fs.opendir(join(this.root,directory));for await(const entry of iterator){if(!known.has(entry.name)||!entry.isFile()||directory==='quarantine')throw this.unavailable();}}
    for(const file of known.values()){
      if(!registration)throw this.unavailable();
      if(file.upload.state==='aborted'){
        for(const directory of ['staging','objects']){try{await fs.lstat(join(this.root,directory,file.storedFilename));throw this.unavailable();}catch(error:any){if(error.code!=='ENOENT')throw error;}}
      }else if(file.upload.state==='committed'){
        const handle=await fs.open(join(this.root,'objects',file.storedFilename),constants.O_RDONLY|(constants.O_NOFOLLOW??0));
        try{const s=await handle.stat({bigint:true});if(!s.isFile()||s.nlink!==1n||s.size!==BigInt(file.sizeBytes))throw this.unavailable();const hash=createHash('sha256');for await(const chunk of handle.createReadStream({autoClose:false}))hash.update(chunk);if(hash.digest('hex')!==file.sha256)throw this.unavailable();}finally{await handle.close();}
        await this.deliver(file);
      }else if(file.upload.state!=='aborted')await this.cleanup(file);
    }
    await this.ledger();this.blocked=false;
  });}
  async onModuleDestroy(){this.stopping=true;for(const worker of this.workers.values())worker.abort();await Promise.allSettled([...this.workers.values()].map(w=>w.done));}
}
