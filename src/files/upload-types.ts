import { BadRequestException } from '@nestjs/common';
import { FileHandle } from 'node:fs/promises';
import { extname } from 'node:path';
// Documents are transported, never executed or unpacked. These are container
// signature checks, not proof of application validity or absence of malware.
const zipFamilies: Record<string, string> = {};
for (const ext of ['xlsx', 'xlsm', 'xltx', 'xltm', 'xlam'])
  zipFamilies[ext] = 'xl/workbook.xml';
zipFamilies.xlsb = 'xl/workbook.bin';
for (const ext of ['docx', 'docm', 'dotx', 'dotm'])
  zipFamilies[ext] = 'word/document.xml';
for (const ext of ['pptx', 'pptm', 'ppsx', 'ppsm', 'potx', 'potm'])
  zipFamilies[ext] = 'ppt/presentation.xml';
for (const ext of ['vsdx', 'vsdm'])
  zipFamilies[ext] = 'visio/document.xml';
const compound = ['xls', 'xlt', 'doc', 'dot', 'ppt', 'pps', 'pot', 'vsd', 'mpp', 'pub', 'msg'];
export const uploadExtensions = [...Object.keys(zipFamilies), ...compound, 'accdb', 'mdb', 'one', 'onepkg', 'txt', 'pdf', 'jpg', 'jpeg', 'png', 'tif', 'tiff', 'heic'].sort();
export function uploadExtension(name: string): string {
  if (typeof name !== 'string' || !name || name.length > 200 || name.trim() !== name
    || Buffer.from(name, 'utf8').toString('utf8') !== name
    || /[\\/\x00-\x1f\x7f<>:"|?*]/.test(name) || /[. ]$/.test(name)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))
    throw new BadRequestException('Unsafe original filename');
  const extension = extname(name).slice(1).toLowerCase();
  if (!uploadExtensions.includes(extension))
    throw new BadRequestException('Unsupported file extension');
  return extension;
}
async function bytes(handle: FileHandle, length: number, position: number) {
  const buffer = Buffer.alloc(length);
  let filled = 0;
  while (filled < length) {
    const result = await handle.read(buffer, filled, length - filled, position + filled);
    if (!result.bytesRead)
      break;
    filled += result.bytesRead;
  }
  return buffer.subarray(0, filled);
}
async function officeZip(handle: FileHandle, size: number, extension: string) {
  const tail = await bytes(handle, Math.min(size, 65557), Math.max(0, size - 65557));
  let end = -1;
  for (let i = tail.length - 22; i >= 0; i--)
    if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === tail.length) {
      end = i;
      break;
    }
  if (end < 0)
    throw Error('Missing ZIP directory');
  const count = tail.readUInt16LE(end + 10), length = tail.readUInt32LE(end + 12), offset = tail.readUInt32LE(end + 16);
  if (tail.readUInt16LE(end + 4) || tail.readUInt16LE(end + 6) || tail.readUInt16LE(end + 8) !== count || !count || count > 10000 || length > 8 * 1024 * 1024 || offset + length !== size - tail.length + end)
    throw Error('Unsupported ZIP directory');
  const directory = await bytes(handle, length, offset);
  let at = 0;
  const names = new Set<string>();
  for (let i = 0; i < count; i++) {
    if (at + 46 > directory.length || directory.readUInt32LE(at) !== 0x02014b50)
      throw Error('Malformed ZIP entry');
    const flags = directory.readUInt16LE(at + 8), method = directory.readUInt16LE(at + 10), n = directory.readUInt16LE(at + 28), extra = directory.readUInt16LE(at + 30), comment = directory.readUInt16LE(at + 32), local = directory.readUInt32LE(at + 42), compressed = directory.readUInt32LE(at + 20);
    if (flags & 1 || ![0, 8].includes(method) || n > 1024 || at + 46 + n + extra + comment > directory.length)
      throw Error('Unsupported ZIP entry');
    const name = directory.subarray(at + 46, at + 46 + n).toString('utf8');
    if (!name || names.has(name) || name.startsWith('/') || name.includes('\\') || name.split('/').some(p => p === '..' || p === '.') || /[\x00-\x1f]/.test(name))
      throw Error('Unsafe ZIP entry');
    const header = await bytes(handle, 30, local);
    if (header.length !== 30 || header.readUInt32LE(0) !== 0x04034b50 || header.readUInt16LE(26) !== n || local + 30 + n + header.readUInt16LE(28) + compressed > offset)
      throw Error('Malformed ZIP local entry');
    if ((await bytes(handle, n, local + 30)).toString('utf8') !== name)
      throw Error('Conflicting ZIP names');
    names.add(name);
    at += 46 + n + extra + comment;
  }
  if (at !== directory.length || !names.has('[Content_Types].xml') || !names.has(zipFamilies[extension]))
    throw Error('Wrong Office document family');
  if (!['xlsm', 'xltm', 'xlam', 'xlsb', 'docm', 'dotm', 'pptm', 'ppsm', 'potm', 'vsdm'].includes(extension) && [...names].some(n => /vbaproject\.bin$/i.test(n)))
    throw Error('Macro content requires a macro-enabled extension');
}
async function tiffSignature(handle: FileHandle, head: Buffer, size: number) {
  const order = head.subarray(0, 2).toString('ascii');
  if (!['II', 'MM'].includes(order) || head.length < 8) throw Error('Invalid TIFF header');
  const u16 = (b: Buffer, p: number) => order === 'II' ? b.readUInt16LE(p) : b.readUInt16BE(p);
  const u32 = (b: Buffer, p: number) => order === 'II' ? b.readUInt32LE(p) : b.readUInt32BE(p);
  const u64 = (b: Buffer, p: number) => order === 'II' ? b.readBigUInt64LE(p) : b.readBigUInt64BE(p);
  const version = u16(head, 2), big = version === 43;
  if (version !== 42 && !big) throw Error('Unknown TIFF version');
  if (big && (head.length < 16 || u16(head, 4) !== 8 || u16(head, 6) !== 0)) throw Error('Invalid BigTIFF header');
  const offset = big ? u64(head, 8) : BigInt(u32(head, 4));
  const countSize = big ? 8 : 2, entrySize = big ? 20n : 12n, nextSize = big ? 8n : 4n;
  if (offset < (big ? 16n : 8n) || offset % (big ? 8n : 2n) || offset + BigInt(countSize) > BigInt(size)) throw Error('Invalid TIFF directory');
  const countBytes = await bytes(handle, countSize, Number(offset));
  const count = big ? u64(countBytes, 0) : BigInt(u16(countBytes, 0));
  if (!count || offset + BigInt(countSize) + count * entrySize + nextSize > BigInt(size)) throw Error('Truncated TIFF directory');
}
async function heicSignature(handle: FileHandle, size: number) {
  let position = 0, boxes = 0, branded = false, metadata = false, media = false;
  while (position < size) {
    if (++boxes > 4096) throw Error('Too many media boxes');
    const head = await bytes(handle, Math.min(16, size - position), position);
    if (head.length < 8) throw Error('Truncated media box');
    const kind = head.subarray(4, 8).toString('ascii'), declared = head.readUInt32BE(0);
    const headerSize = declared === 1 ? 16 : 8;
    if (head.length < headerSize) throw Error('Truncated extended media box');
    const length = declared === 1 ? head.readBigUInt64BE(8) : BigInt(declared || size - position);
    if (length < BigInt(headerSize) || length > BigInt(size - position)) throw Error('Invalid media box size');
    if (!position) {
      if (kind !== 'ftyp' || length < BigInt(headerSize + 8) || length > 4096n || (length - BigInt(headerSize + 8)) % 4n) throw Error('Invalid HEIC file type');
      const type = await bytes(handle, Number(length) - headerSize, position + headerSize);
      const brands = [type.subarray(0, 4).toString('ascii')];
      for (let i = 8; i < type.length; i += 4) brands.push(type.subarray(i, i + 4).toString('ascii'));
      branded = brands.some(brand => ['heic', 'heix', 'hevc', 'hevx'].includes(brand));
    } else if (kind === 'ftyp') throw Error('Duplicate file type');
    if (kind === 'meta') {
      const version = await bytes(handle, 4, position + headerSize);
      if (length < BigInt(headerSize + 4) || version.length !== 4 || version.readUInt32BE(0) !== 0) throw Error('Invalid image metadata');
      metadata = true;
    }
    if (kind === 'moov' && length > BigInt(headerSize)) metadata = true;
    if (kind === 'mdat' && length > BigInt(headerSize)) media = true;
    position += Number(length);
  }
  if (!branded || !metadata || !media) throw Error('Missing HEVC image structure');
}
export async function validateUploadContent(handle: FileHandle, size: number, name: string): Promise<string> {
  const ext = uploadExtension(name), head = await bytes(handle, Math.min(512, size), 0);
  try {
    if (zipFamilies[ext]) {
      if (head.readUInt32LE(0) !== 0x04034b50)
        throw Error();
      await officeZip(handle, size, ext);
    }
    else if (compound.includes(ext)) {
      if (head.length < 512 || head.subarray(0, 8).toString('hex') !== 'd0cf11e0a1b11ae1' || head.readUInt16LE(28) !== 0xfffe || ![9, 12].includes(head.readUInt16LE(30)))
        throw Error();
    }
    else if (ext === 'mdb' || ext === 'accdb') {
      if (head.length < 32 || head.readUInt32LE(0) !== 0x100 || !head.subarray(4, 20).toString('ascii').startsWith(ext === 'mdb' ? 'Standard Jet DB' : 'Standard ACE DB'))
        throw Error();
    }
    else if (ext === 'one') {
      if (head.length < 80 || head.subarray(0, 16).toString('hex') !== 'e4525c7b8cd8a74daeb15378d02996d3')
        throw Error();
    }
    else if (ext === 'onepkg') {
      if (head.subarray(0, 4).toString('ascii') !== 'MSCF' || size < 36)
        throw Error();
    }
    else if (ext === 'tif' || ext === 'tiff') {
      await tiffSignature(handle, head, size);
    }
    else if (ext === 'heic') {
      await heicSignature(handle, size);
    }
    else if (ext === 'pdf') {
      if (!head.subarray(0, 5).equals(Buffer.from('%PDF-')))
        throw Error();
    }
    else if (ext === 'png') {
      if (head.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a')
        throw Error();
    }
    else if (['jpg', 'jpeg'].includes(ext)) {
      if (head.length < 3 || head[0] !== 255 || head[1] !== 216 || head[2] !== 255)
        throw Error();
    }
    else {
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let position = 0;
      while (position < size) {
        const chunk = await bytes(handle, Math.min(65536, size - position), position);
        if (!chunk.length || chunk.includes(0))
          throw Error();
        decoder.decode(chunk, { stream: true });
        position += chunk.length;
      }
      decoder.decode();
      if (head.subarray(0, 2).toString('ascii') === 'MZ' || head.subarray(0, 4).toString('hex') === '7f454c46')
        throw Error();
    }
  }
  catch {
    throw new BadRequestException('File content does not match the supported document format');
  }
  return ext === 'txt' ? 'text/plain' : ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : ['jpg', 'jpeg'].includes(ext) ? 'image/jpeg' : 'application/octet-stream';
}
