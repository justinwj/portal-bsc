// Small synthetic containers for admission/signature tests, not a claim that
// every Office application can open these as complete documents.
export function officePackage(family:string,macro=false):Buffer {
  return projectZip([['[Content_Types].xml','<Types/>'],[family,'<document/>'],...(macro?[[family.split('/')[0]+'/vbaProject.bin','untrusted macro bytes']] as [string,string][]:[])]);
}
export function projectZip(entries:readonly (readonly [string,string])[],options:{deflate?:boolean;descriptor?:boolean}={}):Buffer {
  const locals:Buffer[]=[],central:Buffer[]=[];let position=0;
  for(const [name,content]of entries){
    const n=Buffer.from(name),data=Buffer.from(content);let crc=0xffffffff;for(const b of data){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}crc=(crc^0xffffffff)>>>0;
    const compressed:Buffer=options.deflate?require('node:zlib').deflateRawSync(data):data,method=options.deflate?8:0,flags=options.descriptor?8:0;
    const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(flags,6);local.writeUInt16LE(method,8);if(!options.descriptor){local.writeUInt32LE(crc,14);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(data.length,22);}local.writeUInt16LE(n.length,26);
    const directory=Buffer.alloc(46);directory.writeUInt32LE(0x02014b50);directory.writeUInt16LE(20,4);directory.writeUInt16LE(20,6);directory.writeUInt16LE(flags,8);directory.writeUInt16LE(method,10);directory.writeUInt32LE(crc,16);directory.writeUInt32LE(compressed.length,20);directory.writeUInt32LE(data.length,24);directory.writeUInt16LE(n.length,28);directory.writeUInt32LE(position,42);
    const descriptor=Buffer.alloc(options.descriptor?16:0);if(options.descriptor){descriptor.writeUInt32LE(0x08074b50);descriptor.writeUInt32LE(crc,4);descriptor.writeUInt32LE(compressed.length,8);descriptor.writeUInt32LE(data.length,12);}
    locals.push(local,n,compressed,descriptor);central.push(directory,n);position+=local.length+n.length+compressed.length+descriptor.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(position,16);return Buffer.concat([...locals,directory,end]);
}
export function compoundDocument(){const data=Buffer.alloc(512);Buffer.from('d0cf11e0a1b11ae1','hex').copy(data);data.writeUInt16LE(3,26);data.writeUInt16LE(0xfffe,28);data.writeUInt16LE(9,30);return data;}

// Structural signature fixtures only; no owner documents or image content.
export function tiffDocument(bigEndian=false,bigTiff=false):Buffer {
  const header=bigTiff?16:8,count=bigTiff?8:2,entry=bigTiff?20:12,next=bigTiff?8:4;
  const data=Buffer.alloc(header+count+entry+next);
  const u16=(n:number,p:number)=>bigEndian?data.writeUInt16BE(n,p):data.writeUInt16LE(n,p);
  const u32=(n:number,p:number)=>bigEndian?data.writeUInt32BE(n,p):data.writeUInt32LE(n,p);
  const u64=(n:bigint,p:number)=>bigEndian?data.writeBigUInt64BE(n,p):data.writeBigUInt64LE(n,p);
  data.write(bigEndian?'MM':'II');u16(bigTiff?43:42,2);
  if(bigTiff){u16(8,4);u64(16n,8);u64(1n,16);}else{u32(8,4);u16(1,8);}
  u16(256,header+count);u16(4,header+count+2);
  if(bigTiff){u64(1n,header+count+4);u32(1,header+count+12);}else{u32(1,header+count+4);u32(1,header+count+8);}
  return data;
}
export function heicDocument(major='heic',compatible=['mif1','heic']):Buffer {
  const ftyp=Buffer.alloc(16+4*compatible.length);ftyp.writeUInt32BE(ftyp.length);ftyp.write('ftyp',4);ftyp.write(major,8);
  compatible.forEach((brand,i)=>ftyp.write(brand,16+4*i));
  const meta=Buffer.alloc(12);meta.writeUInt32BE(12);meta.write('meta',4);
  const mdat=Buffer.alloc(9);mdat.writeUInt32BE(9);mdat.write('mdat',4);mdat[8]=1;
  return Buffer.concat([ftyp,meta,mdat]);
}
