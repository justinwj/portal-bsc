import { projectZip, heicDocument } from './documents';
export const projectArchive=()=>projectZip([['models/',''],['models/main.obj','v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n'],['models/main.mtl','newmtl surface\n'],['textures/readme.txt','Synthetic dependency'],['docs/readme.txt','Synthetic project']]);
const binaryStl=Buffer.alloc(134);binaryStl.writeUInt32LE(1,80);
const threeDs=Buffer.alloc(6);threeDs.writeUInt16LE(0x4d4d);threeDs.writeUInt32LE(6,2);
const glb=Buffer.alloc(24);glb.write('glTF');glb.writeUInt32LE(2,4);glb.writeUInt32LE(24,8);glb.writeUInt32LE(4,12);glb.write('JSON',16);glb.write('{}  ',20);
const pyc=Buffer.alloc(17);pyc.writeUInt16LE(3495);pyc.write('\r\n',2);pyc[16]=0xe3;
const emf=Buffer.alloc(88);emf.writeUInt32LE(1);emf.writeUInt32LE(88,4);emf.write(' EMF',40);
const wmf=Buffer.alloc(22);wmf.writeUInt32LE(0x9ac6cdd7);
const lwo=Buffer.alloc(12);lwo.write('FORM');lwo.writeUInt32BE(4,4);lwo.write('LWO2',8);
const mp4=Buffer.from(heicDocument('mp42',['isom','mp42']));mp4.write('moov',28);
const mp3=Buffer.alloc(417);mp3.set([0xff,0xfb,0x90,0]);
// Only tiny synthetic signatures/text, never real owner models or media.
export const projectFixtures:Record<string,Buffer>={
 '3dm':Buffer.from('3D Geometry File Format       80\n'),'3dmbak':Buffer.from('3D Geometry File Format       80\n'),blend:Buffer.from('BLENDER-v400'),fbx:Buffer.from('; FBX 7.4.0 project\n'),'3ds':threeDs,'3mf':projectZip([['[Content_Types].xml','<Types/>'],['3D/3dmodel.model','<model/>']]),glb,gltf:Buffer.from('{"asset":{"version":"2.0"}}'),obj:Buffer.from('v 0 0 0\nf 1 1 1\n'),stl:binaryStl,skp:Buffer.concat([Buffer.from('fffeff0e','hex'),Buffer.from('SketchUp Model','utf16le')]),
 dwg:Buffer.from('AC1032'+'\0'.repeat(20)),dxf:Buffer.from('0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n'),dae:Buffer.from('<?xml version="1.0"?><COLLADA/>'),sat:Buffer.from('700 0 1 0\nEnd-of-ACIS-data'),igs:Buffer.from('Synthetic header'.padEnd(72)+'S      1'),stp:Buffer.from('ISO-10303-21;\nHEADER;\nENDSEC;'),step:Buffer.from('ISO-10303-21;\nHEADER;\nENDSEC;'),x_t:Buffer.from('**PARASOLID text interchange\n'),usd:Buffer.from('#usda 1.0\n'),usda:Buffer.from('#usda 1.0\n'),usdc:Buffer.from('PXR-USDC'+'\0'.repeat(16)),
 usdz:projectZip([['scene.usda', '#usda 1.0\n']]),py:Buffer.from('# Never run uploaded code\nprint("untrusted")\n'),pyc,rhl:Buffer.from('Temporary Rhino lock metadata'),mp4,mp3,zip:projectArchive(),
 ai:Buffer.from('%!PS-Adobe-3.0\n'),amf:Buffer.from('<amf unit="millimeter"/>'),x:Buffer.from('xof 0303txt 0032\n'),emf,kmz:projectZip([['doc.kml','<kml/>']]),gts:Buffer.from('3 3 1\n'),lwo,ply:Buffer.from('ply\nformat ascii 1.0\nend_header\n'),pov:Buffer.from('// POV-Ray scene\n'),rib:Buffer.from('##RenderMan RIB-Structure 1.1\n'),svg:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>untrusted()</script></svg>'),slc:Buffer.from('-SLCVER 2.0 -UNIT MM\r\n'),vda:Buffer.from('HEADER = VDAFS,\n'),wrl:Buffer.from('#VRML V2.0 utf8\n'),vrml:Buffer.from('#VRML V2.0 utf8\n'),wmf,x3dv:Buffer.from('#X3D V3.3 utf8\n'),xaml:Buffer.from('<Canvas xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"/>'),csv:Buffer.from('part,quantity\nframe,1\n')
};
// Pad test USDZ member data to its required 64-byte alignment using a legal extra field.
const usd=projectFixtures.usdz;const n=usd.readUInt16LE(26),padding=(64-(30+n)%64)%64;
if(padding){const extra=Buffer.alloc(padding);if(padding>=4){extra.writeUInt16LE(0xffff);extra.writeUInt16LE(padding-4,2);}const central=usd.indexOf(Buffer.from('504b0102','hex'));projectFixtures.usdz=Buffer.concat([usd.subarray(0,30+n),extra,usd.subarray(30+n)]);projectFixtures.usdz.writeUInt16LE(padding,28);const end=projectFixtures.usdz.length-22;projectFixtures.usdz.writeUInt32LE(central+padding,end+16);}
