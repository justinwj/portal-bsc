import { ServiceUnavailableException } from '@nestjs/common';
import { CouchDbService, FileRecord, UserRecord } from '../common/couchdb.service';
import { isAccessibleAccount, accountStatus } from '../common/account-state';
import { collectUsage, countLabel, countText, defaultPortalSettings, formatGB, limitStatus, PortalSettings,
  remainingBytes, storageLabel, storageText, validatePortalSettings, validateStorageLimit } from '../common/quota-policy';

// Read/format helper only. UsersService owns all writes under its shared queue.
export class QuotaService {
  constructor(private readonly database: CouchDbService) {}
  async load(): Promise<PortalSettings> {
    try { const stored = await this.database.getPortalSettings(); return stored === null ? defaultPortalSettings() : validatePortalSettings(stored); }
    catch { throw new ServiceUnavailableException('Portal quota policy is unavailable or invalid. No unlimited fallback was applied.'); }
  }
  snapshot(policy: PortalSettings, users: UserRecord[], files: FileRecord[]) {
    const usage = collectUsage(files, users), activeCount = users.filter(isAccessibleAccount).length;
    try {
      return { activeCount, maxLabel: countLabel(policy.maxActiveUsers), maxInput: countText(policy.maxActiveUsers),
        defaultLabel: storageLabel(policy.defaultUserQuota), defaultInput: storageText(policy.defaultUserQuota),
        globalLabel: storageLabel(policy.globalStorageQuota), globalInput: storageText(policy.globalStorageQuota),
        updatedAt: policy.updatedAt, updatedBy: policy.updatedBy,
        overCapacity: policy.maxActiveUsers.mode === 'limited' && activeCount > policy.maxActiveUsers.count,
        globalBytes: usage.knownBytes.toString(), globalGb: formatGB(usage.knownBytes), managedFiles: usage.managedFiles,
        committedBytes:usage.committedBytes.toString(),reservedBytes:usage.reservedBytes.toString(),
        globalStatus: limitStatus(policy.globalStorageQuota, usage.knownBytes, usage.complete),
        globalRemaining: remainingBytes(policy.globalStorageQuota, usage.knownBytes, usage.complete),
        incomplete: !usage.complete, unattributedBytes: usage.unattributedBytes.toString(), incompleteAttribution: !usage.attributionComplete,
        excluded: usage.excluded, warnings: usage.warnings,
        users: users.map(user => {
          const override = user.storageQuotaOverride == null ? null : validateStorageLimit(user.storageQuotaOverride);
          const effective = override ?? policy.defaultUserQuota, bytes = usage.perUser.get(user._id!) ?? 0n;
          const complete = usage.complete && usage.attributionComplete;
          return { id: user._id, username: user.username, role: user.role, status: accountStatus(user),
            source: override ? 'Individual override' : 'Default quota', input: override ? storageText(override) : 'inherit',
            effective: storageLabel(effective), knownBytes: bytes.toString(), knownGb: formatGB(bytes),
            usageStatus: limitStatus(effective, bytes, complete), remaining: remainingBytes(effective, bytes, complete), incomplete: !complete };
        }) };
    } catch { throw new ServiceUnavailableException('An individual quota policy is invalid. No default override was substituted.'); }
  }
}
