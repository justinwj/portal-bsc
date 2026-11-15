import { FileHandle } from 'node:fs/promises';
import { inspectArchive } from './archive-validation';
export const projectExtensions = '3dm 3dmbak blend fbx 3ds 3mf glb gltf obj stl skp dwg dxf dae sat igs stp step x_t usd usda usdc usdz py pyc rhl mp4 mp3 zip ai amf x emf kmz gts lwo ply pov raw rib svg slc vda wrl vrml wmf x3dv xaml csv'.split(' ');
async function read(h: FileHandle, n: number, p: number) {
    const b = Buffer.alloc(n);
    let done = 0;
    while (done < n) {
        const r = await h.read(b, done, n - done, p + done);
        if (!r.bytesRead)
            throw Error('Truncated format metadata');
        done += r.bytesRead;
    }
    return b;
}
async function text(h: FileHandle, size: number, head: Buffer) {
    const encoding = head[0] === 255 && head[1] === 254 ? 'utf-16le' : head[0] === 254 && head[1] === 255 ? 'utf-16be' : 'utf-8';
    const decoder = new TextDecoder(encoding, { fatal: true });
    let prefix = '';
    for (let p = 0; p < size;) {
        const b = await read(h, Math.min(65536, size - p), p), s = decoder.decode(b, { stream: true });
        if (s.includes('\0'))
            throw Error('Unexpected NUL');
        prefix += (s.slice(0, Math.max(0, 65536 - prefix.length)));
        p += b.length;
    }
    const last = decoder.decode();
    if (last.includes('\0'))
        throw Error('Unexpected NUL');
    return (prefix + last).replace(/^\uFEFF/, '');
}
async function mp4(h: FileHandle, size: number) {
    let p = 0, count = 0, brand = false, metadata = false, media = false;
    while (p < size) {
        if (++count > 4096)
            throw Error('Media metadata budget');
        const b = await read(h, Math.min(16, size - p), p);
        if (b.length < 8)
            throw Error('Short media box');
        const n = b.readUInt32BE(0), header = n === 1 ? 16 : 8;
        if (b.length < header)
            throw Error('Short media size');
        const length = n === 1 ? b.readBigUInt64BE(8) : BigInt(n || size - p), type = b.subarray(4, 8).toString('ascii');
        if (length < BigInt(header) || length > BigInt(size - p))
            throw Error('Invalid media box');
        if (!p) {
            if (type !== 'ftyp' || length < BigInt(header + 8) || length > 4096n || (length - BigInt(header + 8)) % 4n)
                throw Error('Invalid MP4 type');
            const data = await read(h, Number(length) - header, p + header), brands = [data.subarray(0, 4).toString('ascii')];
            for (let x = 8; x < data.length; x += 4)
                brands.push(data.subarray(x, x + 4).toString('ascii'));
            brand = brands.some(b => /^(isom|iso[2-9]|mp4[12]|avc1|dash|M4V )$/.test(b));
        }
        else if (type === 'ftyp')
            throw Error('Duplicate media type');
        if (type === 'moov' && length > BigInt(header))
            metadata = true;
        if (type === 'mdat' && length > BigInt(header))
            media = true;
        p += Number(length);
    }
    if (!brand || !metadata || !media)
        throw Error('Missing MP4 structure');
}
async function mp3(h: FileHandle, size: number, head: Buffer) {
    let p = 0;
    if (head.subarray(0, 3).toString() === 'ID3') {
        if (size < 10 || ![2, 3, 4].includes(head[3]) || head.subarray(6, 10).some(b => b & 128))
            throw Error('Invalid ID3');
        p = 10 + head.subarray(6, 10).reduce((n, b) => n * 128 + b, 0) + (head[3] === 4 && (head[5] & 16) ? 10 : 0);
    }
    if (p + 4 > size)
        throw Error('Missing MPEG frame');
    const b = await read(h, 4, p), version = (b[1] >> 3) & 3, layer = (b[1] >> 1) & 3, rate = b[2] >> 4, sample = (b[2] >> 2) & 3;
    if (b[0] !== 255 || (b[1] & 224) !== 224 || version === 1 || layer !== 1 || !rate || rate === 15 || sample === 3)
        throw Error('Invalid MPEG layer III');
    const bitrate = (version === 3 ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160])[rate] * 1000;
    const frequency = [44100, 48000, 32000][sample] / (version === 3 ? 1 : version === 2 ? 2 : 4), length = Math.floor((version === 3 ? 144 : 72) * bitrate / frequency) + ((b[2] >> 1) & 1);
    if (p + length > size)
        throw Error('Truncated MPEG frame');
}
export async function validateProject(h: FileHandle, size: number, ext: string, head: Buffer) {
    const ascii = head.toString('latin1'), hex = head.toString('hex'), starts = (s: string) => ascii.startsWith(s), check = (ok: boolean) => {
        if (!ok)
            throw Error('Unrecognized project format');
    };
    // A negative executable check is not a claim that other content is safe.
    check(!starts('MZ') && !hex.startsWith('7f454c46'));
    if (['zip', '3mf', 'kmz', 'usdz'].includes(ext)) {
        const entries = await inspectArchive(h, size), files = entries.filter(e => !e.directory);
        if (ext === '3mf')
            check(files.some(e => e.name === '[Content_Types].xml') && files.some(e => /^3D\/.+\.model$/i.test(e.name)));
        if (ext === 'kmz')
            check(files.some(e => /\.kml$/i.test(e.name)));
        if (ext === 'usdz') {
            const ordered = [...files].sort((a, b) => a.local - b.local);
            check(!!ordered.length && /\.(usd|usda|usdc)$/i.test(ordered[0].name) && entries.every(e => e.method === 0 && e.data % 64 === 0));
        }
        return;
    }
    if (ext === '3dm' || ext === '3dmbak') {
        check(size >= 32 && starts('3D Geometry File Format '));
        return;
    }
    if (ext === 'blend') {
        check((/^BLENDER[_-][vV]\d{3}/.test(ascii)) || (size >= 10 && hex.startsWith('1f8b08')) || (size >= 6 && hex.startsWith('28b52ffd')));
        return;
    }
    if (ext === '3ds') {
        check(size >= 6 && head.readUInt16LE(0) === 0x4d4d && head.readUInt32LE(2) === size);
        return;
    }
    if (ext === 'skp') {
        check(head.subarray(0, 4).toString('hex') === 'fffeff0e' && head.subarray(4, 32).toString('utf16le') === 'SketchUp Model');
        return;
    }
    if (ext === 'dwg') {
        check(size >= 6 && /^AC10\d{2}/.test(ascii));
        return;
    }
    if (ext === 'usdc' || (ext === 'usd' && starts('PXR-USDC'))) {
        check(size >= 16 && starts('PXR-USDC'));
        return;
    }
    if (ext === 'pyc') {
        check(size >= 17 && head[2] === 13 && head[3] === 10 && head.readUInt16LE(0) >= 3392 && head.readUInt16LE(0) < 4000 && head.readUInt32LE(4) < 4);
        return;
    }
    if (ext === 'emf') {
        check(size >= 88 && head.readUInt32LE(0) === 1 && head.readUInt32LE(4) >= 88 && head.subarray(40, 44).toString() === ' EMF');
        return;
    }
    if (ext === 'wmf') {
        check(size >= 18 && (head.readUInt32LE(0) === 0x9ac6cdd7 || ([1, 2].includes(head.readUInt16LE(0)) && head.readUInt16LE(2) === 9)));
        return;
    }
    if (ext === 'lwo') {
        check(size >= 12 && starts('FORM') && head.readUInt32BE(4) + 8 === size && ['LWO2', 'LWOB', 'LWO3'].includes(head.subarray(8, 12).toString()));
        return;
    }
    if (ext === 'mp4') {
        await mp4(h, size);
        return;
    }
    if (ext === 'mp3') {
        await mp3(h, size, head);
        return;
    }
    if (ext === 'glb') {
        check(size >= 20 && starts('glTF') && head.readUInt32LE(4) === 2 && head.readUInt32LE(8) === size);
        let p = 12, count = 0;
        while (p < size) {
            check(++count <= 4096 && p + 8 <= size);
            const chunk = await read(h, 8, p), n = chunk.readUInt32LE(0);
            check(n % 4 === 0 && p + 8 + n <= size && (p !== 12 || chunk.subarray(4).toString() === 'JSON'));
            p += 8 + n;
        }
        check(p === size);
        return;
    }
    if (ext === 'stl' && size >= 84) {
        const count = head.readUInt32LE(80);
        if (84 + 50 * count === size)
            return;
    }
    if (ext === 'fbx' && starts('Kaydara FBX Binary  \0\x1a\0')) {
        check(size >= 27);
        return;
    }
    if (ext === 'dxf' && starts('AutoCAD Binary DXF\r\n\x1a\0'))
        return;
    if (ext === 'ai' && starts('%PDF-'))
        return;
    if (ext === 'ply') {
        check(/^ply\r?\nformat (ascii|binary_little_endian|binary_big_endian) 1\.0\r?\n/.test(ascii));
        return;
    }
    if (ext === 'x' && /^xof\s+\d{4}(bin |tzip|bzip)/.test(ascii))
        return;
    const value = await text(h, size, head), trim = value.trimStart();
    if (ext === 'igs') {
        check(/^.{72}S\s*\d+/.test(value));
        return;
    }
    if (ext === 'rib') {
        check(/^##RenderMan/.test(trim) || /(?:^|\n)\s*(?:version\s+\d|Display\s+|Format\s+\d|Option\s+|WorldBegin\b|FrameBegin\b)/.test(value));
        return;
    }
    if (ext === 'raw') {
        const first = trim.split(/\r?\n/)[0].trim().split(/\s+/);
        check(first.length === 9 && first.every(n => /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(n) && Number.isFinite(Number(n))));
        return;
    }
    const patterns: Record<string, RegExp> = { fbx: /^(;\s*FBX|FBXHeaderExtension\s*:)/, gltf: /^\{/, stl: /^solid(?:\s|$)/, dxf: /^0\s+SECTION\b/i, dae: /^(?:<\?xml[^>]*>\s*)?<(?:\w+:)?COLLADA\b/, sat: /^\d+\s+\d+\s+\d+\s+\d+/, stp: /^ISO-10303-21\s*;/, step: /^ISO-10303-21\s*;/, usd: /^#usda\s+1\.0/, usda: /^#usda\s+1\.0/, ai: /^%!PS-Adobe/, amf: /^(?:<\?xml[^>]*>\s*)?<amf\b/, x: /^xof\s+\d{4}(txt |bin |tzip|bzip)/, gts: /^\d+\s+\d+\s+\d+/, svg: /^(?:<\?xml[^>]*>\s*)?<svg\b/, slc: /^-SLCVER\s/, wrl: /^#VRML\s+V[12]\.0/, vrml: /^#VRML\s+V[12]\.0/, x3dv: /^#X3D\s+V/, xaml: /^(?:<\?xml[^>]*>\s*)?<[A-Za-z_]/ };
    if (patterns[ext])
        check(patterns[ext].test(trim));
    // OBJ, Parasolid text, source/scripts, locks and CSV have no reliable magic.
    // Admit well-formed bounded-memory text; never parse/evaluate formulas or code.
}
