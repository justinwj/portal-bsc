import type { UserRecord } from './couchdb.service';

// Records predating public registration retain their existing active/disabled
// behavior. New workflow states are an additional gate, never an access grant.
export function isAccessibleAccount(user?: UserRecord | null): boolean {
  return !!user && user.isActive === true && !user.closedAt && (!user.registration || user.registration.status === 'approved');
}

export function accountStatus(user: UserRecord): string {
  if (user.closedAt) return 'Closed';
  if (user.registration?.status === 'pending') return 'Pending Approval';
  if (user.registration?.status === 'rejected') return 'Registration Rejected';
  return user.isActive ? 'Active' : 'Disabled';
}
