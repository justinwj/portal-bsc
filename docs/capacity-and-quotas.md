# Capacity and storage quota controls

Active administrators open **Capacity and quotas** in the navigation. Settings and overrides require authentication, CSRF, current administrator authorization and valid inputs. The page reports applicable policies and metadata usage; it never reads, moves, truncates or deletes NAS files.

## Values and units

Enter one of these exact values in a policy field:

| Input | Meaning |
| --- | --- |
| `not-configured` | **Not configured**: no policy has been selected for this limit |
| `unlimited` | **Unlimited**: an explicit decision not to apply this limit |
| A nonnegative number | A numeric limit; zero is a real zero budget |

The maximum active-user field accepts whole integers. Storage fields use decimal GB: **1 GB = 1,000,000,000 bytes**, with up to nine fractional digits (one-byte resolution). For example, `1.000000001` is exactly 1,000,000,001 bytes. Input must be canonical: no negative signs, whitespace, separators, leading zeros, exponent notation, NaN or Infinity. Storage values above `9007199.254740991` GB are rejected; maximum counts above `9007199254740991` are rejected.

Storage arithmetic uses BigInt and persistent canonical integer-byte strings, never floating-point GB multiplication. File metadata sizes must themselves be nonnegative safe integers. Usage sums can exceed Number.MAX_SAFE_INTEGER without rounding.

An absent settings document has Not configured values, without an automatic write or user migration. Only an actual CouchDB 404 means absence. Unavailable or invalid stored policy causes an error; it is not substituted with Unlimited or zero usage. Production startup still requires real CouchDB/Redis. Development-only in-memory fallback, if used, is ephemeral and does not provide CouchDB persistence guarantees.

## Active-user capacity: enforced now

Active approved accounts count toward capacity, including administrators and schema-valid legacy active accounts without registration fields. Pending/rejected registrations, disabled accounts and Closed accounts do not count. Accounts are counted, not sessions.

The cap is checked inside the shared UsersService mutation queue for ordinary administrator creation, pending-registration approval, and disabled-account reactivation. A pending registration can still be submitted when full; approval waits for capacity. Repeated activation of an already-active account is a no-op rather than a second charge. Rejections, disabling and closure can proceed under the existing administrator safety rules.

Saving a numeric maximum below the current active count is rejected. Existing accounts are never disabled automatically. Concurrent settings changes and account activations are serialized and reread current policy/counts. This guarantee covers the documented **one Node process / one Nest UsersService singleton** model; it is not distributed coordination or protection against independent database writers.

### Explicit bootstrap exception: existing recovery policy preserved

The privileged `seed:admin:prod` CLI retains its established behavior. It may create a new bootstrap administrator at capacity. It preserves an existing active administrator/password, rejects member collisions without promotion, and refuses to reactivate an existing disabled administrator. The exception is private to bootstrap, not a public HTTP option or ordinary creation bypass.

Bootstrap can therefore leave the count **Over capacity**. The page reports that state; ordinary growth remains blocked. Increase the maximum or review eligible account status explicitly. A maximum below the current count cannot be resaved even if it came from a previous policy; resolve capacity first. No users are silently disabled to reconcile it. Existing lockouts still require a separately approved recovery procedure; no local administrator records were repaired in this development session.

## Storage policy and managed-upload enforcement

The default quota applies when a user has no individual override. An override takes precedence, including an explicit Unlimited or Not configured override. Enter **`inherit`** in an override field to remove it and use the current default. Removal is stored as null (equivalent to absent) so a merged CouchDB user document cannot retain a stale override. Quota edits preserve identity, role, active status, password and session version; only quota metadata/update time changes.

The global storage policy applies independently to all known Portal-managed file usage, including retained files owned by disabled or Closed accounts. Lowering a storage policy below known usage is permitted and displays **Over limit**. It does not remove data or block existing downloads.

Session 7G-B adds opt-in managed uploads with durable reservations and commit-time policy/account checks. See [Managed uploads, sharing and recovery](managed-uploads.md) for setup and failure semantics. Existing installations require explicit administrator confirmation; recommended initial policies are **10 GB per user, 100 GB globally and 1 GB per upload**. These are decimal GB, and existing configured policies/overrides are preserved. Both applicable global and user policies must be configured; Not configured blocks uploads, while Unlimited is an explicit choice. The per-file numeric maximum is separately adjustable on **Managed storage policy**.

This is not a limit on the whole DS925+, a Synology share or direct SMB writes. Physical free-space preflight provides additional headroom but does not reserve disk capacity against other NAS writers. No existing NAS directory is made writable.

### Usage accounting

- Only file records explicitly marked `storageScope: 'portal-managed'` are included. Existing records without a scope, and explicit `external-nas` records, are reported as excluded legacy/external metadata. No automatic classification or NAS scan occurs.
- Each distinct managed file ID contributes once globally; identical duplicate metadata copies are deduplicated. Distinct IDs are distinct managed metadata objects; physical aliases/hard links cannot be detected without a separately reviewed storage/provenance policy.
- Valid byte sizes contribute to the global total even if ownership is missing. Per-user attribution uses `uploadedByUserId` and a retained user record; missing/unknown ownership is reported as **unattributed**, never guessed as the administrator.
- Invalid/unsafe sizes, missing IDs, conflicting duplicate sizes/owners or storage classifications, and unknown scopes make totals incomplete. The display gives known lower-bound bytes and warnings; unknown data is not asserted to use zero bytes.
- Global byte completeness and ownership completeness are distinct. If global sizes are complete, missing ownership does not change the global byte sum. Incomplete attribution makes per-user totals conservative lower bounds. Numeric remaining bytes become Unknown when the relevant metadata is incomplete.
- Over-limit is definitive when even the known lower bound exceeds the policy. Otherwise an incomplete report cannot prove that a user is within quota.
- Schema-v2 upload journals distinguish committed bytes from reserved/uncertain work. Only verified-aborted journals release their charges; cleanup-pending, quarantined and uncertain states remain charged. Reports show committed and reserved components separately. Sharing does not duplicate storage or charge recipients.

Metadata may be stale after out-of-band file changes. SMB data and unmarked legacy NAS entries are outside Portal control. The managed upload producer assigns scope, owner, size, storage identity and a recoverable journal; admission fails closed on incomplete accounting, unknown managed provenance or inconsistent physical state. Older manually populated managed metadata is not automatically migrated/adopted. Startup and verified downloads check hashes; this is not a scanner for all NAS data.

## Persistence and auditing

Portal policy is a schema-versioned `portal-settings` document in the existing `portal_users` database. User overrides remain on the corresponding user document. Both persist across application restarts and container recreation when the CouchDB data volume is retained. Policy documents are excluded from account counts and user targets.

Changes produce `portal.settings_changed` or `user.quota_changed` audit events. They include the fresh actor ID/username, timestamp, previous/new canonical values and request context. User-override events identify the target account. Passwords, hashes, session cookies, CSRF tokens and configuration credentials are not added. Identical submissions are no-ops, including semantically equal override objects with a different JSON key order.

Policy/user writes and audit inserts remain separate CouchDB operations. If a write succeeds but its audit fails, HTTP 503 explicitly reports the partial commit, and the operator log uses a fixed message. There is no rollback, durable outbox or automatic replay; an unchanged retry cannot reconstruct a missing audit event. Transport timeouts may leave a write outcome uncertain. Inspect saved state and audit records before recovery. Corrupt policy requires operator review rather than a permissive fallback.

## Manual acceptance still required

Automated HTTP, CouchDB, container and Windows tooling checks do not operate Rider or capture UI screenshots. In a disposable test environment:

1. Sign in as an administrator and open Capacity and quotas. Capture the default Not configured view and confirm decimal-GB help, scope boundaries and current active count are clear.
2. Save a numeric capacity at the current count and a fractional storage quota such as `1.000000001`. Reload and capture current values. Try a below-count maximum, negative value and fractional-byte value; confirm clear rejection and no persisted change.
3. Set a user's override to a number, Unlimited, Not configured, then `inherit`. Confirm the effective source/value and capture the inherited/override views. Repeat a submission and verify no duplicate transition audit.
4. Review a managed-metadata fixture with unknown ownership or size. Capture warnings and lower-bound/Unknown reporting. Do not use production NAS files as fixtures.
5. Confirm member/anonymous denial and native form keyboard access. Check layout/labels at narrow widths and with assistive technology. No interactive Rider, visual or accessibility pass is claimed by the automated report.

See [Session 7F evidence](development-session-7f.md) for the original policy implementation and [Session 7G-B evidence](development-session-7g-b.md) for uploads. SMTP, permanent deletion and distributed coordination remain outside the implementation.
