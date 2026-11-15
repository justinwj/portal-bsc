import assert from 'node:assert/strict';
import { after, before, it } from 'node:test';
import { mkdtemp, open, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { uploadExtension, uploadExtensions, validateUploadContent } from './upload-types';
import { projectZip } from '../../test/fixtures/documents';
let root:string;
before(async()=>{root=await mkdtemp(join(tmpdir(),'portal-project-types-'));});
after(async()=>{await rm(root,{recursive:true,force:true});});
async function validate(ext:string,data:Buffer){const file=join(root,randomUUID());await writeFile(file,data);const h=await open(file,'r');try{return await validateUploadContent(h,data.length,'project.'+ext);}finally{await h.close();}}
import { projectFixtures as fixtures, projectArchive as zip } from '../../test/fixtures/projects';
for(const [ext,data] of Object.entries(fixtures))it(`admits approved .${ext} case-insensitively as opaque downloads`,async()=>{
 assert.equal(uploadExtension('Project.'+ext.toUpperCase()),ext);assert.equal(await validate(ext,data),'application/octet-stream');
});
it('normalizes mixed-case extensions with no allowlist duplicates',()=>{assert.equal(uploadExtension('data.CsV'),'csv');assert.equal(new Set(uploadExtensions).size,uploadExtensions.length);});
it('accepts an IGES start record whose fixed-width content is blank',async()=>{
 await validate('igs',Buffer.from(' '.repeat(72)+'S      1\n'));
});
it('accepts RenderMan command text without the optional RIB comment signature',async()=>{
 await validate('rib',Buffer.from('# Synthetic scene\nFormat 64 64 1\nWorldBegin\nWorldEnd\n'));
});
it('admits only the documented ASCII triangle variant of ambiguous RAW files',async()=>{
 assert.equal(uploadExtension('mesh.RaW'),'raw');assert.equal(await validate('raw',Buffer.from('0 0 0 1 0 0 0 1 0\n')),'application/octet-stream');
 for(const data of [Buffer.from('MZ binary disguise'),Buffer.from([0,255,1]),Buffer.from('not triangle text')])await assert.rejects(validate('raw',data),/content does not match/);
});
it('accepts Windows-created ZIP member separators without rewriting archive bytes',async()=>{
 await validate('zip',projectZip([['project\\',''],['project\\models\\mesh.obj','v 0 0 0\n']]));
});
it('rejects malicious mixed-separator paths and separator-alias collisions',async()=>{
 for(const name of ['..\\outside','/safe\\..\\..\\outside','\\\\server\\share','C:\\outside'])await assert.rejects(validate('zip',projectZip([[name,'untrusted']])),/content does not match/);
 await assert.rejects(validate('zip',projectZip([['folder/file','one'],['folder\\file','two']])),/content does not match/);
});
for(const ext of Object.keys(fixtures))it(`rejects an executable misleadingly named .${ext}`,async()=>{await assert.rejects(validate(ext,Buffer.from('MZnot the selected format')),/content does not match/);});
it('accepts an empty ZIP and nested project directories without touching payload bytes',async()=>{await validate('zip',projectZip([]));await validate('zip',zip());});
it('accepts stored/deflated ZIPs and streaming data descriptors without decompression',async()=>{
 for(const deflate of [false,true])for(const descriptor of [false,true])await validate('zip',projectZip([['project/model.obj','v 0 0 0\n'],['project/maps/texture.txt','synthetic dependency']],{deflate,descriptor}));
});
it('accepts a deflated empty directory entry in an otherwise ordinary project ZIP',async()=>{
 await validate('zip',projectZip([['project/',''],['project/model.obj','v 0 0 0\n']],{deflate:true,descriptor:true}));
});
it('recognizes binary DirectX headers without requiring its payload to be text',async()=>{
 await validate('x',Buffer.concat([Buffer.from('xof 0303bin 0032'),Buffer.from([0,255,0,1])]));
});
it('rejects encrypted archives regardless of central/local disagreement or encryption method',async()=>{
 for(const field of ['local','central','both','aes']){const data=zip(),c=data.indexOf(Buffer.from('504b0102','hex'));if(field!=='central')data.writeUInt16LE(1,6);if(field!=='local')data.writeUInt16LE(1,c+8);if(field==='aes')data.writeUInt16LE(99,c+10);await assert.rejects(validate('zip',data),/content does not match/);}
});
it('rejects unsafe members, collisions, links, truncated and inconsistent ZIP structures',async()=>{
 for(const name of ['../outside','/outside','C:/outside','a\\..\\b','a/../b','NUL.txt','file:stream'])await assert.rejects(validate('zip',projectZip([[name,'untrusted']])) ,/content does not match/);
 for(const names of [[['a','1'],['a','2']],[['a','1'],['A','2']],[['folder','1'],['folder/file','2']]] as [string,string][][])await assert.rejects(validate('zip',projectZip(names)),/content does not match/);
 const linked=zip(),c=linked.indexOf(Buffer.from('504b0102','hex'));linked[c+5]=3;linked.writeUInt32LE(0xa1ff0000,c+38);
 const wrong=zip();wrong.writeUInt16LE(8,8);
 const badCrc=zip();badCrc.writeUInt32LE(123,14);
 for(const data of [linked,wrong,badCrc,zip().subarray(0,-1),Buffer.from('PK\x03\x04broken')])await assert.rejects(validate('zip',data),/content does not match/);
});
it('rejects ZIP metadata over budget, ZIP64 and malformed extra fields',async()=>{
 const count=zip();count.writeUInt16LE(10001,count.length-12);count.writeUInt16LE(10001,count.length-14);
 const zip64=zip();zip64.writeUInt32LE(0xffffffff,zip64.length-6);
 const wrongExtra=zip();wrongExtra.writeUInt16LE(65535,28);
 for(const data of [count,zip64,wrongExtra])await assert.rejects(validate('zip',data),/content does not match/);
});
it('keeps Office family checks intact and rejects generic ZIP renamed to an Office/container family',async()=>{
 for(const ext of ['docx','xlsx','3mf','kmz','usdz'])await assert.rejects(validate(ext,zip()),/content does not match/);
});
it('does not interpret CSV formulas, Python, SVG, XAML or Rhino lock records as safe executable content',async()=>{
 for(const [ext,data]of [['csv','=HYPERLINK("untrusted")\n'],['py','raise Exception("never execute")\n'],['rhl',''],['svg','<svg onload="untrusted()"/>'],['xaml','<ResourceDictionary/>']] as const)assert.equal(await validate(ext,Buffer.from(data)),'application/octet-stream');
});

