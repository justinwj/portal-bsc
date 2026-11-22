export const managedVisibilities = ['all-members', 'selected-members', 'private'] as const;
export type ManagedVisibility = typeof managedVisibilities[number];

// Old managed records used "private" for both owner-only and recipient sharing.
// Reads infer that old policy without rewriting the record or widening access.
export function managedVisibility(file: {visibility?: unknown; sharedWithUserIds?: string[]}): ManagedVisibility {
  if (file.visibility === 'all-members' || file.visibility === 'selected-members') return file.visibility;
  if (file.visibility === 'private' || file.visibility === undefined)
    return file.sharedWithUserIds?.length ? 'selected-members' : 'private';
  throw Error('Unsupported managed file visibility');
}
export const visibilityLabel = (mode: ManagedVisibility) => ({'all-members':'All members','selected-members':'Selected members',private:'Private'})[mode];
