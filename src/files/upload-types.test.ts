import assert from 'node:assert/strict';
import { after, before, it } from 'node:test';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { uploadExtension, validateUploadContent } from './upload-types';
import { officePackage, compoundDocument, tiffDocument, heicDocument } from '../../test/fixtures/documents';
for(const ext of ['tif','tiff'])for(const big of [false,true])for(const be of [false,true])it(`accepts ${be?'big':'little'}-endian ${big?'BigTIFF':'TIFF'} .${ext} as download-only bytes`,async()=>{
  assert.equal(await validate('image.'+ext,tiffDocument(be,big)),'application/octet-stream');
});
for(const brand of ['heic','heix','hevc','hevx'])it(`accepts HEVC image container brand ${brand} under .HEIC`,async()=>{
  assert.equal(await validate('image.HEIC',heicDocument(brand,['mif1',brand])),'application/octet-stream');
});
it('recognizes HEIC compatible brands without accepting a generic HEIF or AVIF disguise',async()=>{
  await validate('image.heic',heicDocument('mif1',['mif1','heic']));
  for(const data of [heicDocument('mif1',['mif1']),heicDocument('avif',['mif1','avif']),Buffer.from('MZ disguised image')])
    await assert.rejects(validate('image.heic',data),/content does not match/);
});
it('rejects malformed TIFF signatures, unsafe offsets, truncated directories and fake executables',async()=>{
  const badOffset=tiffDocument();badOffset.writeUInt32LE(0xfffffff0,4);
  const badCount=tiffDocument();badCount.writeUInt16LE(65535,8);
  const bigOffset=tiffDocument(false,true);bigOffset.writeBigUInt64LE(0xffffffffffffffffn,8);
  const wrongBig=tiffDocument(false,true);wrongBig.writeUInt16LE(4,4);
  for(const data of [Buffer.from('MZ disguised image'),Buffer.from('49492a00','hex'),badOffset,badCount,bigOffset,wrongBig])
    await assert.rejects(validate('image.tif',data),/content does not match/);
});
it('rejects HEIC truncated, overflowing or absent media boxes instead of trusting a brand alone',async()=>{
  const image=heicDocument(),overflow=Buffer.from(image);overflow.writeUInt32BE(0xffffffff,24);
  for(const data of [image.subarray(0,24),image.subarray(0,-1),overflow,Buffer.concat([image,Buffer.from([1])])])
    await assert.rejects(validate('image.heic',data),/content does not match/);
});
it('supports a bounded extended-size HEIC media box and an end-of-file media box',async()=>{
  const image=heicDocument(),extended=Buffer.alloc(17);extended.writeUInt32BE(1);extended.write('mdat',4);extended.writeBigUInt64BE(17n,8);extended[16]=1;
  await validate('image.heic',Buffer.concat([image.subarray(0,-9),extended]));
  const last=Buffer.from(image);last.writeUInt32BE(0,last.length-9);await validate('image.heic',last);
});
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
it('handles legitimate short filesystem reads without rejecting a valid container',async()=>{
  for(const [name,data]of [['a.xls',compoundDocument()],['a.docm',officePackage('word/document.xml')]] as const){const path=join(directory,randomUUID());await writeFile(path,data);const handle=await open(path,'r');
    try{const partial={read:(buffer:Buffer,offset:number,length:number,position:number)=>handle.read(buffer,offset,Math.min(17,length),position)};assert.equal(await validateUploadContent(partial as any,data.length,name),'application/octet-stream');}finally{await handle.close();}
  }
});
