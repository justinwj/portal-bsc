# Registration and account lifecycle

## Registering and signing in

Use **Register** on the login page. Public registration collects only username, email and password. It creates an inactive **Pending Approval** account and does not sign the applicant in. An active administrator must approve it before any protected page or file is available.

Public usernames use 3–64 ASCII letters/numbers/dots/underscores/hyphens and start with a letter or number. Public usernames and emails are trimmed and lowercased; use the resulting lowercase username when signing in. Passwords retain their exact characters and require at least eight characters with uppercase, lowercase and a digit, with a maximum of 72 UTF-8 bytes to avoid bcrypt truncation. Passwords are hashed with bcrypt at cost 10 and are never redisplayed.

New and duplicate eligible submissions receive the same generic 303 response and confirmation page. Existing usernames and emails remain reserved across pending, rejected, disabled and closed accounts. Duplicate public identities are compared case-insensitively across user records. Existing administrator-created records retain their original names and password behavior; their login spelling is not migrated. Administrative creation continues to permit shared emails under its existing policy, but cannot create a case-variant duplicate username. Public registration never accepts a role, active flag, approval state, session version or closure date.

Registration POSTs have a dedicated limit of **five attempts per client IP per 15 minutes**, including fresh sessions and duplicate submissions. IPv6 subnet handling uses express-rate-limit's default. Existing global request limiting remains enabled. CSRF validation, bounded inputs, approval-before-access and generic responses provide additional safeguards. Eligible submissions are hashed before identity lookup to avoid an obvious cheap duplicate path; this is not a formal constant-time guarantee.

The limiter uses process-local memory and resets on application restart. Shared NATs share the limit. This is not distributed-bot prevention, CAPTCHA or email verification. The existing one-trusted-proxy configuration assumes the backend is private and traffic arrives through the trusted reverse proxy; exposing it directly would undermine IP attribution. No SMTP/email service was added. Administrators must verify eligibility and email ownership through their approved organizational process before approval.

## Administrator review

Open **Users → Pending Registrations**. Review the username, email and request date. **Approve as member** always assigns `member`, activates the account and rotates the session version. **Reject registration** retains the account as inactive/rejected. Repeating the same decision is a no-op; a conflicting final decision is rejected. Ordinary **Enable** cannot bypass approval or reopen a rejected registration.

The current-users table shows account status, registration dates, the latest deletion request and decision dates, plus an **Audit history** link. History is restricted to active administrators and displays the latest 100 matching account-management events with actor, timestamp and previous/new state. Full audit records remain in CouchDB; the current implementation scans audit documents before filtering and is intended for the existing small single-instance deployment. It does not add a retention/deletion policy or erase older events.

## Account deletion requests

Signed-in users open **Account settings**, confirm their intent, and request deletion. The account remains active while the request is pending, and settings show status and request/decision dates. A duplicate pending request is a no-op. Following a rejection the user may submit a new request with a new ID; prior requests remain in the account record.

Administrators review **Pending Account Deletion Requests**:

| Decision | Result |
| --- | --- |
| Reject | Account access is unchanged; the request and decision remain in history |
| Approve with explicit confirmation | Account becomes Closed/inactive, session version rotates, and old cookies are rejected on subsequent protected requests |
| Repeat the same decision for the current request | No additional change or duplicate success audit |
| Conflicting decision or old request ID after a newer request | Rejected; the newer request is unaffected |

Approval **does not delete anything**: user identity, password hash, role, request history, audit records and associated/shared files remain. No NAS files, metadata, databases or volumes are removed. Closed accounts cannot be reopened through ordinary Enable. Reconsidering rejected registrations, reopening closed accounts, permanent account removal and file-retention/disposition policy require separate approval. No automatic recovery or irreversible deletion is provided.

The Session 7D administrator protections still apply to closure approval. An administrator cannot approve closing their own account, even with other administrators present, and ordinary operations cannot leave zero active administrators. A sole administrator may submit a request, but approval remains blocked. Another active administrator must handle eligible administrator requests. Existing lockouts are not repaired by this feature, and bootstrap collision/recovery behavior is unchanged.

## Consistency, sessions and audit controls

Legacy user records without lifecycle fields retain their existing Active/Disabled behavior. Pending/rejected registrations and Closed accounts are denied by both login and protected-route checks even if their active flag is malformed. Successful approval or closure rotates the persisted session version; deletion requests and rejections do not revoke an otherwise active account's sessions. No bulk record migration runs.

All identity creation, registration decisions, deletion requests/decisions and ordinary status changes share the existing UsersService mutation queue. It rereads acting accounts inside the critical section. This protects concurrent requests **within one Node process and one Nest singleton**. It is not a database uniqueness constraint, distributed lock or cross-document transaction. Multiple application instances, independent service objects, replication writers and direct database edits require separately reviewed coordination. In-flight responses/downloads authorized before revocation are not cancelled.

Workflow audits are `registration.requested`, `registration.approved`, `registration.rejected`, `account.deletion_requested`, `account.deletion_rejected` and `account.closed`. They identify the target ID/username, previous/new state, request ID where applicable, timestamp and request context. Decisions identify the fresh acting administrator; deletion requests identify the requesting user. Public registration intake does not assert a verified user identity. Passwords/hashes, cookies, CSRF tokens and configuration credentials are not added to these events.

Account writes and audit inserts remain separate operations. Private decisions or deletion requests report HTTP 503 if a committed change cannot be audited; they do not roll it back or claim atomicity. Public registration retains its generic response if the pending record saves but the intake audit fails, and emits a fixed operator error. It makes no public claim that an audit was saved. Repeated unchanged operations do not recreate missing events. Transport failures can leave write outcomes uncertain, and process failure between writes can leave an audit gap. Inspect persisted state and operator logs before recovery; no durable outbox or replay mechanism is claimed.

See the [Session 7E report](development-session-7e.md) for this workflow's original tests and CI links. [Session 7F capacity/quota controls](capacity-and-quotas.md) now enforce active-user capacity on approval, ordinary creation and reactivation while keeping pending intake available at capacity. Storage quota policy is reporting only; uploads and commit enforcement remain deferred to Session 7G.
