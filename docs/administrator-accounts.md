# Administrator account safety

Open **Users** while signed in as an active administrator. The page identifies your current account and displays each user's role and Active/Disabled status. Only active administrators may view or change account management.

- **Disable** opens a server-rendered confirmation page. Review the username, then confirm or cancel. Disabling blocks subsequent protected requests, including existing sessions. It does not cancel a response or download already authorized and in progress.
- **Enable** reactivates an approved or legacy disabled account. Its username, role, email and password hash are preserved. The user must log in again; old sessions cannot be restored by enabling the account. Pending/rejected registrations and Closed accounts require their own policy and cannot be enabled here.
- Your current account cannot be disabled through ordinary user management, even if other administrators exist. The last active administrator is protected. Disabled administrators do not count as active administrators.
- Repeating a completed enable or disable is a no-op, with an explanatory message and no duplicate status-change audit. Repeated self-disable is always rejected.

These restrictions apply in the service as well as the interface. Both POST actions require an authenticated, active administrator and a valid session CSRF token. Disabling also requires the explicit confirmation value. No inline script or relaxed CSP is needed.

For public registration, Pending Registrations, deletion-request decisions and account audit review, see [Registration and account lifecycle](account-lifecycle.md). These operations share the same mutation queue and preserve the self-disable/last-administrator protections.

Ordinary creation, approval and reactivation also enforce the [active-user capacity policy](capacity-and-quotas.md). Explicit bootstrap preserves its established creation/collision/recovery behavior and can leave the portal over capacity; it does not silently deactivate or promote accounts.

## Concurrency and deployment boundary

The Release 1 application must run as **one Node application instance with one Nest UsersService singleton**. A shared in-process queue serializes all status transitions, across different target users, and rereads the actor inside the critical section. If two administrators attempt to disable each other, only one can succeed: the losing actor is no longer an active administrator when its queued operation is validated. The queue covers validation, save and the audit attempt, and is released on failure as well as success.

This is not a distributed lock or a CouchDB multi-document transaction. Multiple application instances, Node cluster workers, independent UsersService instances, direct database edits, replication writers or other programs changing account status are outside this guarantee. A separately approved distributed coordination strategy is required before scaling beyond this deployment boundary. The confirmation page is a preview; the POST always repeats validation against current data.

The persisted `sessionVersion` increments on each actual status transition, including Enable. Login records the version in the session; the authentication guard verifies it on subsequent protected requests. Legacy records and sessions without the field use version zero. Rotating on reactivation also rejects old version-zero cookies for accounts disabled before versioning existed. No-op requests do not rotate versions. No bulk migration or existing-account rewrite is required.

## Audit records and storage failures

Successful transitions record `user.disabled` or `user.enabled` in `portal_audit` with:

- `userId`, `username`: the acting administrator, freshly loaded from storage.
- `details.targetUserId`, `details.targetUsername`: the target account.
- `details.previousStatus`, `details.newStatus`: `active` or `disabled`.
- `createdAt`: application timestamp; `ip`: the request IP under the existing trusted-proxy configuration.
- `details.userAgent`: at most 256 characters of the request User-Agent.

Passwords, password hashes, session cookies, CSRF tokens and configuration secrets are not added to these events. Rejected operations and unchanged statuses do not generate successful transition events.

The account document saves **before** the separate audit insert. There is no atomic transaction, durable outbox or automatic audit replay. If audit persistence fails after a successful account update, HTTP 503 and a generic operator log explicitly report that the status changed but its audit record could not be saved. The status is not rolled back. A repeated action is a no-op and will not reconstruct that missing audit event. Inspect the account and audit store before taking further action. A transport timeout can also make a write outcome uncertain: verify persisted state rather than assuming a failed response means nothing changed. Process termination between the two writes can leave an unaudited transition without a response.

Raw database errors and credentials are not shown to users. Production database failures do not enable an in-memory fallback. Audit outage behavior is verified with both an external-adapter failure fixture and an actual CouchDB validation rejection in disposable CI services. See the [Session 7D report](development-session-7d.md) for executed results.

## Existing lockouts and bootstrap

This release does not repair or overwrite existing local accounts. If every administrator is already disabled, the ordinary management interface cannot recover them. Recovery requires a separately approved procedure; this session provides no automatic promotion or reactivation policy.

Bootstrap policy remains unchanged: an existing active administrator is preserved, an existing non-administrator username collision is rejected without promotion, and an existing disabled administrator causes bootstrap to fail rather than report success. Never reuse production bootstrap secrets in tests. Follow the [DS925+ readiness guide](ds925-production-readiness.md) for bootstrap credential handling after initial initialization.
