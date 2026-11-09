// Small synthetic containers for admission/signature tests, not a claim that
// every Office application can open these as complete documents.
export function officePackage(family:string,macro=false):Buffer {
  const entries=[['[Content_Types].xml','<Types/>'],[family,'<document/>'],...(macro?[[family.split('/')[0]+'/vbaProject.bin','untrusted macro bytes']]:[])];
  const locals:Buffer[]=[],central:Buffer[]=[];let position=0;
  for(const [name,content]of entries){
    const n=Buffer.from(name),data=Buffer.from(content);let crc=0xffffffff;for(const b of data){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}crc=(crc^0xffffffff)>>>0;
    const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(n.length,26);
    const directory=Buffer.alloc(46);directory.writeUInt32LE(0x02014b50);directory.writeUInt16LE(20,4);directory.writeUInt16LE(20,6);directory.writeUInt32LE(crc,16);directory.writeUInt32LE(data.length,20);directory.writeUInt32LE(data.length,24);directory.writeUInt16LE(n.length,28);directory.writeUInt32LE(position,42);
    locals.push(local,n,data);central.push(directory,n);position+=local.length+n.length+data.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(position,16);return Buffer.concat([...locals,directory,end]);
}
export function compoundDocument(){const data=Buffer.alloc(512);Buffer.from('d0cf11e0a1b11ae1','hex').copy(data);data.writeUInt16LE(3,26);data.writeUInt16LE(0xfffe,28);data.writeUInt16LE(9,30);return data;}
