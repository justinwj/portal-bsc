import { FileHandle } from 'node:fs/promises';
export interface ArchiveEntry {
    name: string;
    method: number;
    compressed: number;
    uncompressed: number;
    local: number;
    data: number;
    end: number;
    directory: boolean;
}
async function read(h: FileHandle, length: number, position: number) { const b = Buffer.alloc(length); let n = 0; while (n < length) {
    const r = await h.read(b, n, length - n, position + n);
    if (!r.bytesRead)
        throw Error('Truncated ZIP metadata');
    n += r.bytesRead;
} return b; }
function safeName(name: string) {
    name = name.replace(/\\/g, '/');
    const parts = name.endsWith('/') ? name.slice(0, -1).split('/') : name.split('/');
    if (!name || name.startsWith('/') || /[:\x00-\x1f\x7f<>"|?*]/.test(name) || parts.some(p => !p || p === '.' || p === '..' || p.trim() !== p || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))
        throw Error('Unsafe ZIP member name');
}
function extra(data: Buffer, name: string) {
    for (let p = 0; p < data.length;) {
        if (p + 4 > data.length)
            throw Error('Truncated ZIP extra');
        const id = data.readUInt16LE(p), n = data.readUInt16LE(p + 2);
        p += 4;
        if (p + n > data.length)
            throw Error('Invalid ZIP extra');
        if ([1, 0x9901, 0x0017].includes(id))
            throw Error('ZIP64/encryption requires separate policy');
        if (id === 0x7075) {
            if (n < 5 || data[p] !== 1)
                throw Error('Invalid Unicode path');
            const alternative = new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(p + 5, p + n));
            safeName(alternative);
            if (alternative !== name)
                throw Error('Conflicting ZIP path override');
        }
        p += n;
    }
}
// Metadata inspection only: never inflate, extract, create or execute members.
export async function inspectArchive(h: FileHandle, size: number): Promise<ArchiveEntry[]> {
    if (size < 22 || !Number.isSafeInteger(size))
        throw Error('Invalid ZIP size');
    const tailSize = Math.min(size, 65557), tail = await read(h, tailSize, size - tailSize);
    let end = -1;
    for (let p = tail.length - 22; p >= 0; p--)
        if (tail.readUInt32LE(p) === 0x06054b50 && p + 22 + tail.readUInt16LE(p + 20) === tail.length) {
            end = p;
            break;
        }
    if (end < 0)
        throw Error('Missing ZIP directory');
    const count = tail.readUInt16LE(end + 10), length = tail.readUInt32LE(end + 12), offset = tail.readUInt32LE(end + 16);
    if (tail.readUInt16LE(end + 4) || tail.readUInt16LE(end + 6) || tail.readUInt16LE(end + 8) !== count || count > 10000 || length > 8 * 1024 * 1024 || offset + length !== size - tailSize + end)
        throw Error('Unsupported ZIP directory');
    const central = await read(h, length, offset), entries: ArchiveEntry[] = [], keys = new Map<string, boolean>();
    let at = 0, budget = length;
    async function bounded(n: number, p: number) { budget += n; if (budget > 16 * 1024 * 1024)
        throw Error('ZIP metadata inspection budget exceeded'); return read(h, n, p); }
    for (let i = 0; i < count; i++) {
        if (at + 46 > central.length || central.readUInt32LE(at) !== 0x02014b50)
            throw Error('Invalid central entry');
        const flags = central.readUInt16LE(at + 8), method = central.readUInt16LE(at + 10), crc = central.readUInt32LE(at + 16), compressed = central.readUInt32LE(at + 20), uncompressed = central.readUInt32LE(at + 24), n = central.readUInt16LE(at + 28), x = central.readUInt16LE(at + 30), comment = central.readUInt16LE(at + 32), local = central.readUInt32LE(at + 42);
        if (flags & ~0x080e || ![0, 8].includes(method) || !n || n > 1024 || central.readUInt16LE(at + 34) || [compressed, uncompressed, local].includes(0xffffffff) || at + 46 + n + x + comment > central.length)
            throw Error('Unsupported ZIP entry');
        const raw = central.subarray(at + 46, at + 46 + n), originalName = flags & 0x800 ? new TextDecoder('utf-8', { fatal: true }).decode(raw) : raw.toString('latin1'), name = originalName.replace(/\\/g, '/');
        safeName(name);
        extra(central.subarray(at + 46 + n, at + 46 + n + x), originalName);
        const mode = (central.readUInt32LE(at + 38) >>> 16) & 0xf000, directory = name.endsWith('/'), key = name.replace(/\/$/, '').normalize('NFC').toLowerCase();
        if (keys.has(key) || ((central.readUInt16LE(at + 4) >>> 8) === 3 && ![0, 0x8000, 0x4000].includes(mode)) || (mode === 0x4000 && !directory) || (directory && uncompressed))
            throw Error('Conflicting or special ZIP member');
        keys.set(key, directory);
        if (local + 30 > offset)
            throw Error('Invalid local entry offset');
        const header = await bounded(30, local);
        if (header.readUInt32LE(0) !== 0x04034b50 || header.readUInt16LE(6) !== flags || header.readUInt16LE(8) !== method || header.readUInt16LE(26) !== n)
            throw Error('Conflicting ZIP local header');
        const localExtra = header.readUInt16LE(28), data = local + 30 + n + localExtra;
        if (data + compressed > offset)
            throw Error('Truncated ZIP member');
        const fields = await bounded(n + localExtra, local + 30);
        if (!fields.subarray(0, n).equals(raw))
            throw Error('Conflicting ZIP names');
        extra(fields.subarray(n), originalName);
        if (method === 0 && compressed !== uncompressed)
            throw Error('Invalid stored member size');
        let memberEnd = data + compressed;
        if (flags & 8) {
            if (memberEnd + 12 > offset)
                throw Error('Missing data descriptor');
            const first = await bounded(4, memberEnd), signed = first.readUInt32LE(0) === 0x08074b50;
            const d = await bounded(signed ? 16 : 12, memberEnd), start = signed ? 4 : 0;
            if (d.readUInt32LE(start) !== crc || d.readUInt32LE(start + 4) !== compressed || d.readUInt32LE(start + 8) !== uncompressed)
                throw Error('Conflicting ZIP descriptor');
            memberEnd += d.length;
        }
        else if (header.readUInt32LE(14) !== crc || header.readUInt32LE(18) !== compressed || header.readUInt32LE(22) !== uncompressed)
            throw Error('Conflicting ZIP sizes/CRC');
        entries.push({ name, method, compressed, uncompressed, local, data, end: memberEnd, directory });
        at += 46 + n + x + comment;
    }
    if (at !== central.length)
        throw Error('Invalid directory length');
    let previous = 0;
    for (const e of [...entries].sort((a, b) => a.local - b.local)) {
        if (e.local !== previous)
            throw Error('Overlapping/unindexed ZIP data');
        previous = e.end;
        const parts = e.name.replace(/\/$/, '').normalize('NFC').toLowerCase().split('/');
        parts.pop();
        while (parts.length) {
            if (keys.get(parts.join('/')) === false)
                throw Error('File/directory conflict');
            parts.pop();
        }
    }
    if (previous !== offset)
        throw Error('Unindexed ZIP data');
    return entries;
}
