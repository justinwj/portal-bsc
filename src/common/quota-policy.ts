import { BadRequestException } from '@nestjs/common';
import type { FileRecord, UserRecord } from './couchdb.service';

export type StorageLimit = { mode: 'not-configured' | 'unlimited' } | { mode: 'limited'; bytes: string };
export type CountLimit = { mode: 'not-configured' | 'unlimited' } | { mode: 'limited'; count: number };
export interface PortalSettings {
  type: 'portal-settings'; schemaVersion: 1;
  maxActiveUsers: CountLimit; defaultUserQuota: StorageLimit; globalStorageQuota: StorageLimit;
  updatedAt?: string; updatedBy?: string;
}
const GB = 1000000000n, MAX = 9007199254740991n;
const modes = ['not-configured', 'unlimited'];
export function defaultPortalSettings(): PortalSettings {
  return { type: 'portal-settings', schemaVersion: 1, maxActiveUsers: { mode: 'not-configured' },
    defaultUserQuota: { mode: 'not-configured' }, globalStorageQuota: { mode: 'not-configured' } };
}
function text(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length > 64) throw new BadRequestException('Use not-configured, unlimited, or a supported numeric limit');
}
export function parseStorageLimit(value: unknown): StorageLimit {
  text(value);
  if (modes.includes(value)) return { mode: value as 'not-configured' | 'unlimited' };
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,9}))?$/.exec(value);
  if (!match) throw new BadRequestException('Storage must be decimal GB with at most 9 fractional digits');
  const bytes = BigInt(match[1]) * GB + BigInt((match[2] ?? '').padEnd(9, '0'));
  if (bytes > MAX) throw new BadRequestException('Storage limit exceeds 9007199.254740991 GB');
  return { mode: 'limited', bytes: bytes.toString() };
}
export function parseCountLimit(value: unknown): CountLimit {
  text(value);
  if (modes.includes(value)) return { mode: value as 'not-configured' | 'unlimited' };
  if (!/^(0|[1-9]\d*)$/.test(value) || BigInt(value) > MAX) throw new BadRequestException('Active-user maximum must be a supported nonnegative integer');
  return { mode: 'limited', count: Number(value) };
}
export function formatGB(bytes: bigint): string {
  const fraction = (bytes % GB).toString().padStart(9, '0').replace(/0+$/, '');
  return `${bytes / GB}${fraction ? '.' + fraction : ''}`;
}
export function storageText(limit: StorageLimit): string { return limit.mode === 'limited' ? formatGB(BigInt(limit.bytes)) : limit.mode; }
export function storageLabel(limit: StorageLimit): string { return limit.mode === 'limited' ? `${storageText(limit)} GB` : limit.mode === 'unlimited' ? 'Unlimited' : 'Not configured'; }
export function countText(limit: CountLimit): string { return limit.mode === 'limited' ? String(limit.count) : limit.mode; }
export function countLabel(limit: CountLimit): string { return limit.mode === 'limited' ? String(limit.count) : limit.mode === 'unlimited' ? 'Unlimited' : 'Not configured'; }

export function validateStorageLimit(value: any): StorageLimit {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid stored storage policy');
  if (modes.includes(value.mode) && Object.keys(value).length === 1) return { mode: value.mode };
  if (value.mode !== 'limited' || typeof value.bytes !== 'string' || !/^(0|[1-9]\d*)$/.test(value.bytes)
      || value.bytes.length > 16 || BigInt(value.bytes) > MAX || Object.keys(value).some(k => !['mode', 'bytes'].includes(k))) throw Error('Invalid stored storage policy');
  return { mode: 'limited', bytes: value.bytes };
}
export function validatePortalSettings(value: any): PortalSettings {
  if (!value || value.type !== 'portal-settings' || value.schemaVersion !== 1) throw Error('Invalid stored portal policy');
  const limit = value.maxActiveUsers;
  let maximum: CountLimit;
  if (limit && modes.includes(limit.mode) && Object.keys(limit).length === 1) maximum = { mode: limit.mode };
  else if (limit?.mode === 'limited' && Number.isSafeInteger(limit.count) && limit.count >= 0
      && !Object.keys(limit).some(k => !['mode', 'count'].includes(k))) maximum = { mode: 'limited', count: limit.count };
  else throw Error('Invalid stored active-user maximum');
  return { type: 'portal-settings', schemaVersion: 1, maxActiveUsers: maximum,
    defaultUserQuota: validateStorageLimit(value.defaultUserQuota), globalStorageQuota: validateStorageLimit(value.globalStorageQuota),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : undefined,
    updatedBy: typeof value.updatedBy === 'string' ? value.updatedBy : undefined };
}
export function policyValues(policy: PortalSettings) {
  return { maxActiveUsers: policy.maxActiveUsers, defaultUserQuota: policy.defaultUserQuota, globalStorageQuota: policy.globalStorageQuota };
}

export function collectUsage(files: FileRecord[], users: UserRecord[]) {
  const owners = new Set(users.filter(u => u.type === 'user').map(u => u._id));
  const perUser = new Map<string, bigint>(), groups = new Map<string, FileRecord[]>(), warnings: string[] = [];
  let knownBytes = 0n, unattributedBytes = 0n, complete = true, attributionComplete = true, excluded = 0, managedFiles = 0;
  for (const file of files) {
    if (!file || file.type !== 'file') continue;
    if (typeof file._id !== 'string' || !file._id.trim()) {
      if (file.storageScope == null || file.storageScope === 'external-nas') excluded++;
      else { complete = false; warnings.push('Managed or unclassified metadata has no reliable file ID'); }
      continue;
    }
    const group = groups.get(file._id) ?? []; group.push(file); groups.set(file._id, group);
  }
  for (const [id, group] of groups) {
    if (group.every(f => f.storageScope == null || f.storageScope === 'external-nas')) { excluded += group.length; continue; }
    if (group.some(f => f.storageScope === 'portal-managed')) managedFiles++;
    if (!group.every(f => f.storageScope === 'portal-managed')) {
      complete = false; warnings.push(`Unknown or conflicting storage classification for ${id}`); continue;
    }
    const first = group[0];
    if (!group.every(f => Object.is(f.sizeBytes, first.sizeBytes) && f.uploadedByUserId === first.uploadedByUserId)) {
      complete = false; warnings.push(`Conflicting duplicate metadata for ${id}`); continue;
    }
    if (!Number.isSafeInteger(first.sizeBytes) || first.sizeBytes < 0) { complete = false; warnings.push(`Unknown or invalid byte size for ${id}`); continue; }
    const bytes = BigInt(first.sizeBytes); knownBytes += bytes;
    if (typeof first.uploadedByUserId === 'string' && owners.has(first.uploadedByUserId)) {
      perUser.set(first.uploadedByUserId, (perUser.get(first.uploadedByUserId) ?? 0n) + bytes);
    } else { unattributedBytes += bytes; attributionComplete = false; warnings.push(`Missing or unknown ownership for ${id}`); }
  }
  return { knownBytes, perUser, unattributedBytes, complete, attributionComplete, excluded, managedFiles, warnings };
}

export function limitStatus(limit: StorageLimit, bytes: bigint, complete: boolean): string {
  if (limit.mode !== 'limited') return storageLabel(limit);
  if (bytes > BigInt(limit.bytes)) return 'Over limit';
  if (!complete) return 'Unknown — incomplete metadata';
  return bytes === BigInt(limit.bytes) ? 'At limit' : 'Within limit';
}
export function remainingBytes(limit: StorageLimit, bytes: bigint, complete: boolean): string {
  if (limit.mode !== 'limited') return storageLabel(limit);
  if (!complete) return 'Unknown';
  const remaining = BigInt(limit.bytes) - bytes;
  return (remaining < 0n ? 0n : remaining).toString();
}
