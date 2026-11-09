import { BadRequestException } from '@nestjs/common';
import { FileHandle } from 'node:fs/promises';
import { extname } from 'node:path';

// Documents are transported, never executed or unpacked. These are container
// signature checks, not proof of application validity or absence of malware.
const zipFamilies: Record<string,string> = {};
for (const ext of ['xlsx','xlsm','xltx','xltm','xlam']) zipFamilies[ext] = 'xl/workbook.xml';
zipFamilies.xlsb = 'xl/workbook.bin';
for (const ext of ['docx','docm','dotx','dotm']) zipFamilies[ext] = 'word/document.xml';
for (const ext of ['pptx','pptm','ppsx','ppsm','potx','potm']) zipFamilies[ext] = 'ppt/presentation.xml';
for (const ext of ['vsdx','vsdm']) zipFamilies[ext] = 'visio/document.xml';
const compound = ['xls','xlt','doc','dot','ppt','pps','pot','vsd','mpp','pub','msg'];
export const uploadExtensions = [...Object.keys(zipFamilies),...compound,'accdb','mdb','one','onepkg','txt','pdf','jpg','jpeg','png'].sort();

export function uploadExtension(name: string): string {
  if (typeof name !== 'string' || !name || name.length > 200 || name.trim() !== name
    || Buffer.from(name,'utf8').toString('utf8') !== name
    || /[\\/\x00-\x1f\x7f<>:"|?*]/.test(name) || /[. ]$/.test(name)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw new BadRequestException('Unsafe original filename');
  const extension = extname(name).slice(1).toLowerCase();
  if (!uploadExtensions.includes(extension)) throw new BadRequestException('Unsupported file extension');
  return extension;
}
async function bytes(handle:FileHandle, length:number, position:number) {
  const buffer=Buffer.alloc(length);const result=await handle.read(buffer,0,length,position);return buffer.subarray(0,result.bytesRead);
}
async function officeZip(handle:FileHandle,size:number,extension:string) {
  const tail=await bytes(handle,Math.min(size,65557),Math.max(0,size-65557));
  let end=-1;for(let i=tail.length-22;i>=0;i--)if(tail.readUInt32LE(i)===0x06054b50&&i+22+tail.readUInt16LE(i+20)===tail.length){end=i;break;}
  if(end<0)throw Error('Missing ZIP directory');
  const count=tail.readUInt16LE(end+10),length=tail.readUInt32LE(end+12),offset=tail.readUInt32LE(end+16);
  if(tail.readUInt16LE(end+4)||tail.readUInt16LE(end+6)||tail.readUInt16LE(end+8)!==count||!count||count>10000||length>8*1024*1024||offset+length!==size-tail.length+end)throw Error('Unsupported ZIP directory');
  const directory=await bytes(handle,length,offset);let at=0;const names=new Set<string>();
  for(let i=0;i<count;i++){
    if(at+46>directory.length||directory.readUInt32LE(at)!==0x02014b50)throw Error('Malformed ZIP entry');
    const flags=directory.readUInt16LE(at+8),method=directory.readUInt16LE(at+10),n=directory.readUInt16LE(at+28),extra=directory.readUInt16LE(at+30),comment=directory.readUInt16LE(at+32),local=directory.readUInt32LE(at+42),compressed=directory.readUInt32LE(at+20);
    if(flags&1||![0,8].includes(method)||n>1024||at+46+n+extra+comment>directory.length)throw Error('Unsupported ZIP entry');
    const name=directory.subarray(at+46,at+46+n).toString('utf8');
    if(!name||names.has(name)||name.startsWith('/')||name.includes('\\')||name.split('/').some(p=>p==='..'||p==='.')||/[\x00-\x1f]/.test(name))throw Error('Unsafe ZIP entry');
    const header=await bytes(handle,30,local);if(header.length!==30||header.readUInt32LE(0)!==0x04034b50||header.readUInt16LE(26)!==n||local+30+n+header.readUInt16LE(28)+compressed>offset)throw Error('Malformed ZIP local entry');
    if((await bytes(handle,n,local+30)).toString('utf8')!==name)throw Error('Conflicting ZIP names');
    names.add(name);at+=46+n+extra+comment;
  }
  if(at!==directory.length||!names.has('[Content_Types].xml')||!names.has(zipFamilies[extension]))throw Error('Wrong Office document family');
  if(!['xlsm','xltm','xlam','xlsb','docm','dotm','pptm','ppsm','potm','vsdm'].includes(extension)&&[...names].some(n=>/vbaproject\.bin$/i.test(n)))throw Error('Macro content requires a macro-enabled extension');
}
export async function validateUploadContent(handle:FileHandle,size:number,name:string):Promise<string>{
  const ext=uploadExtension(name),head=await bytes(handle,Math.min(512,size),0);
  try {
    if(zipFamilies[ext]){if(head.readUInt32LE(0)!==0x04034b50)throw Error();await officeZip(handle,size,ext);}
    else if(compound.includes(ext)){if(head.length<512||head.subarray(0,8).toString('hex')!=='d0cf11e0a1b11ae1'||head.readUInt16LE(28)!==0xfffe||![9,12].includes(head.readUInt16LE(30)))throw Error();}
    else if(ext==='mdb'||ext==='accdb'){if(head.length<32||head.readUInt32LE(0)!==0x100||!head.subarray(4,20).toString('ascii').startsWith(ext==='mdb'?'Standard Jet DB':'Standard ACE DB'))throw Error();}
    else if(ext==='one'){if(head.length<80||head.subarray(0,16).toString('hex')!=='e4525c7b8cd8a74daeb15378d02996d3')throw Error();}
    else if(ext==='onepkg'){if(head.subarray(0,4).toString('ascii')!=='MSCF'||size<36)throw Error();}
    else if(ext==='pdf'){if(!head.subarray(0,5).equals(Buffer.from('%PDF-')))throw Error();}
    else if(ext==='png'){if(head.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error();}
    else if(['jpg','jpeg'].includes(ext)){if(head.length<3||head[0]!==255||head[1]!==216||head[2]!==255)throw Error();}
    else {
      const decoder=new TextDecoder('utf-8',{fatal:true});let position=0;
      while(position<size){const chunk=await bytes(handle,Math.min(65536,size-position),position);if(!chunk.length||chunk.includes(0))throw Error();decoder.decode(chunk,{stream:true});position+=chunk.length;}
      decoder.decode();if(head.subarray(0,2).toString('ascii')==='MZ'||head.subarray(0,4).toString('hex')==='7f454c46')throw Error();
    }
  }catch{throw new BadRequestException('File content does not match the supported document format');}
  return ext==='txt'?'text/plain':ext==='pdf'?'application/pdf':ext==='png'?'image/png':['jpg','jpeg'].includes(ext)?'image/jpeg':'application/octet-stream';
}
