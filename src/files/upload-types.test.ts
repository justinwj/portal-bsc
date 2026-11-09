import assert from 'node:assert/strict';
import { after, before, it } from 'node:test';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { uploadExtension, validateUploadContent } from './upload-types';
import { officePackage, compoundDocument } from '../../test/fixtures/documents';
let directory:string;
before(async()=>{directory=await mkdtemp(join(tmpdir(),'portal-types-'));});after(async()=>{await rm(directory,{recursive:true,force:true});});
async function validate(name:string,data:Buffer){const path=join(directory,randomUUID());await writeFile(path,data);const handle=await open(path,'r');try{return await validateUploadContent(handle,data.length,name);}finally{await handle.close();}}
const families:Record<string,string>={xlsx:'xl/workbook.xml',xlsm:'xl/workbook.xml',xlsb:'xl/workbook.bin',xltx:'xl/workbook.xml',xltm:'xl/workbook.xml',xlam:'xl/workbook.xml',docx:'word/document.xml',docm:'word/document.xml',dotx:'word/document.xml',dotm:'word/document.xml',pptx:'ppt/presentation.xml',pptm:'ppt/presentation.xml',ppsx:'ppt/presentation.xml',ppsm:'ppt/presentation.xml',potx:'ppt/presentation.xml',potm:'ppt/presentation.xml',vsdx:'visio/document.xml',vsdm:'visio/document.xml'};
for(const [ext,family]of Object.entries(families))it(`accepts supported Office ZIP container .${ext} as an opaque attachment`,async()=>{assert.equal(await validate('test.'+ext,officePackage(family)), 'application/octet-stream');});
for(const ext of ['xls','xlt','doc','dot','ppt','pps','pot','vsd','mpp','pub','msg'])it(`accepts a recognized legacy compound signature for .${ext}`,async()=>{assert.equal(await validate('test.'+ext,compoundDocument()),'application/octet-stream');});
for(const ext of ['mdb','accdb'])it(`accepts .${ext} with its database-family signature`,async()=>{const data=Buffer.alloc(128);data.writeUInt32LE(0x100);data.write(ext==='mdb'?'Standard Jet DB':'Standard ACE DB',4,'ascii');assert.equal(await validate('test.'+ext,data),'application/octet-stream');});
it('accepts OneNote revision-store and package signatures without executing or unpacking them',async()=>{const one=Buffer.alloc(80);Buffer.from('e4525c7b8cd8a74daeb15378d02996d3','hex').copy(one);await validate('test.one',one);const pkg=Buffer.alloc(36);pkg.write('MSCF');await validate('test.onepkg',pkg);});
for(const ext of ['xlsm','xlam','docm','pptm','vsdm'])it(`accepts explicit macro-enabled .${ext} while preserving its untrusted bytes`,async()=>{await validate('macro.'+ext,officePackage(families[ext],true));});
it('rejects a disguised executable, wrong Office family, malformed ZIP and macro disguise',async()=>{
  await assert.rejects(validate('test.docm',Buffer.from('MZ executable')));
  await assert.rejects(validate('test.docx',officePackage('xl/workbook.xml')));
  await assert.rejects(validate('test.docx',Buffer.from('PK\x03\x04malformed')));
  await assert.rejects(validate('test.docx',officePackage('word/document.xml',true)));
});
it('rejects ZIP paths, encrypted entries and executable add-ins independently of filename case',async()=>{
  await assert.rejects(validate('test.docx',officePackage('../word/document.xml')));
  const data=officePackage('word/document.xml');data.writeUInt16LE(1,data.indexOf(Buffer.from('504b0102','hex'))+8);await assert.rejects(validate('test.docx',data));
  for(const ext of ['exe','dll','xll','com','js','vbs','ps1','ppa','ppam','xla'])assert.throws(()=>uploadExtension('file.'+ext));
});
it('retains text, PDF, JPEG and PNG and permits an empty TXT file',async()=>{await validate('empty.txt',Buffer.alloc(0));await validate('text.txt',Buffer.from('hello'));await validate('file.pdf',Buffer.from('%PDF-1.7'));await validate('file.jpg',Buffer.from('ffd8ffe0','hex'));await validate('file.png',Buffer.from('89504e470d0a1a0a','hex'));await assert.rejects(validate('binary.txt',Buffer.from([0,255])));});
