# Development Session 7E: registration, approval and deletion requests

## Scope, branch and commits

- Authorized branch: `codex/portal-bsc-r1-fixes`.
- Reviewed starting SHA: `9a5a532fcc22c83c608473f2686403476e4d0882`.
- RED tests: `7540458e66df40ca84e8577cefaff210008fa351`.
- GREEN implementation: `59d7349e61bbf8ddacd8ded50e3af574356a8e35`.
- Final source/refactoring SHA: `3f9d6fd2967097084deee98e5395bc746bad3415`. The final documentation publication SHA is supplied by the final CI/handoff; a report cannot contain its own Git object hash.

Only Session 7E is implemented. No quotas, uploads, SMTP/email delivery, permanent account removal or file disposition was added. There was no merge, deployment, image publication, production-credential change, database/volume/NAS deletion or modification of existing local user records. All test accounts and metadata fixtures are disposable; actual service tests run against isolated GitHub Actions services.

## Baseline

Verified branch/HEAD/status, fetched origin, read `AGENTS.md` and `.github/copilot-instructions.md` from `origin/master`, and reviewed Session 7D and administrator controls. The three original staged `.idea` additions, ignored `.idea/vcs.xml`, and pre-existing untracked options report are preserved. Explicit-path `commit --only` excludes unrelated staged files.

- npm **10.9.9** `ci`: exit **0**, 216 packages installed / 217 audited, zero findings.
- `npm run typecheck`: exit **0**.
- `npm test`: **139 passed**, 0 failed/cancelled/skipped, exit **0**.
- `npm run build`: exit **0**.
- Full audit, production audit and npm 10.9.9 dependency-tree validation: all exit **0**, no findings or invalid peers.
- [Reviewed Session 7D CI](https://github.com/justinwj/portal-bsc/actions/runs/42533365433): completed success at the starting SHA, **216 distinct tests + 23 Windows repetitions = 239 passing executions**, no failures/cancellations/skips. Production Docker build/startup passed.

No production code was changed during baseline verification. Package declarations, lockfile and dependency versions remain unchanged throughout 7E. Installation/audit/tree commands use npm 10.9.9 explicitly; Node 22 CI independently verifies runtime compatibility.

Local Windows runtime: Node **24.19.0**, host npm **11.17.0**. CI's Linux/Windows jobs and the actual production image ran Node **22.23.4**; CI used npm **10.9.9**.

## RED evidence

`src/users/lifecycle.test.ts` uses actual Nest HTTP routes, authentication and guards, bcrypt, sessions, CSRF, DTO validation, Helmet, Handlebars and the registration limiter. Only the external CouchDB adapter is replaced with a test-owned store whose reads/writes clone documents. `NODE_ENV=test` and the development/test-only session fallback are explicitly enabled. Each test creates/closes its own application, so process-local limiter state is isolated without disabling the limiter.

Initial local RED: **38 tests, 4 passed / 34 failed**. Three added confirmation/decision/storage cases produced **41 tests, 4 passed / 37 failed**, zero cancellations/skips. Existing global CSRF rejection already worked; these passing checks were retained rather than manufacturing a RED for working middleware.

Failures demonstrate missing registration/settings/decision/history routes; no public form/link; no pending-account gate or ordinary-Enable protection for the new states; absent confirmation/closure/request workflows; missing abuse limiting and audit records. HTTP 404 for a missing endpoint is evidence of missing functionality, not a claim that the old application exposed an unauthorized approval endpoint.

[Independent RED CI](https://github.com/justinwj/portal-bsc/actions/runs/42536192508), before production changes:

| Suite | Passed | Failed | Cancelled | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Unit/HTTP/tooling, including first 38 new cases | 143 | 34 | 0 | 0 |
| Actual Redis/CouchDB, including six new lifecycle cases | 66 | 6 | 0 | 0 |
| Docker/Compose | 11 | 0 | 0 | 0 |
| Windows tooling | 23 | 0 | 0 | 0 |
| **All executions** | **243** | **40** | **0** | **0** |

The six real-service failures cover pending registration/approval, duplicate identity races, rejection/Enable bypass, closure with retained files and Redis revocation, request history/stale decisions, and concurrent registration decisions. Every previously passing test remained enabled and passed.

## GREEN implementation

Public `/register` has its own strict DTO, deliberately separate from administrator creation. It accepts only username/email/password, normalizes public identifiers, enforces bounded input and password rules including bcrypt's 72-byte boundary, and creates an inactive pending member. Public fields cannot assign roles, status, session versions or lifecycle metadata. All eligible submissions are hashed before lookup; new/duplicate identities receive the same generic redirect/page. Duplicate public usernames/emails are reserved across all retained account states. Existing administrative creation retains its shared-email policy, while username reservations are checked case-insensitively under the same queue.

Five registration attempts per IP per 15 minutes are enforced by actual express-rate-limit middleware in AppModule, across fresh cookies. Existing global limiting, CSRF, Helmet and CSP are preserved. The limiter's owned memory store is shut down on module destruction. No orchestration/security dependency was added.

User management displays Pending Registrations, fixed-member approval/rejection, request/decision dates, pending deletion requests and scoped audit history. `/account` lets active authenticated users request deletion with explicit confirmation. It never accepts a target user ID from the body. Repeated pending requests are coalesced. Rejected requests are retained, and a later request receives a fresh ID. Decisions carry that ID; stale forms cannot act on a newer request.

Approval of deletion sets Closed/inactive and increments the session version. It never invokes file, database or user deletion. Username, email, password hash, role, request history, audit history and associated/shared files remain. Ordinary Enable rejects pending/rejected registrations and Closed accounts. Reopening/reconsideration is not silently added as a recovery policy.

Login and AuthGuard share an accessibility predicate: valid legacy active records remain eligible, while pending/rejected/closed states block access even with an inconsistent active flag. Registration approval and closure rotate session versions; pending deletion requests and rejections do not interrupt otherwise active sessions. All acting administrators/users are reread inside the shared singleton mutation queue. Self-closure and last-active-administrator safety reuse the 7D validation, including concurrent cross-administrator actions.

The first implementation passed **40/41** new local tests. The remaining test used a nonexistent `/files/:id/download` URL; it was corrected to the actual `/download/:id` route, retaining the required HTTP 401 assertion. This was a test URL error, not a production route defect. Full local GREEN then passed **180/180**, type checking and production build.

[First GREEN CI](https://github.com/justinwj/portal-bsc/actions/runs/42536968008): all jobs passed, **180 unit/HTTP/tooling + 72 real-service + 11 container + 23 Windows = 286 passing executions**, zero failures/cancellations/skips.

## Refactoring and compatibility evidence

The queue now consistently covers managed user creation, public identity reservation, status changes and lifecycle requests/decisions. Audit-field construction is shared with ordinary status changes. Accessibility and status presentation are centralized, controllers only handle validated input/rendering, and templates render backend-derived controls and escaped fields. Confirmation and feedback use native SSR controls with no inline script or CSP relaxation.

A compatibility regression added during review exposed a real signup failure when `_all_docs` includes CouchDB design/index metadata: targeted RED **1 executed / 0 passed / 1 failed** (HTTP 503 instead of 303). UsersService now filters non-user documents before account identity and management checks. A seventh real-service case creates an actual unique CouchDB design fixture, verifies registration, then removes only that fixture. It does not delete account records, databases, volumes or files.

Final local verification after refactoring and template date display: **181 passed**, 0 failed/cancelled/skipped; typecheck and production build exited **0**. No existing test was weakened, skipped, disabled or deleted. Legacy schema-valid UserRecord documents lacking lifecycle fields require no migration, and existing local records are not rewritten. Existing bootstrap collision/recovery behavior is unchanged.

## New tests and security coverage

**42 new local HTTP tests** cover:

- Public form/link, CSRF, CSP, password hashing, pending status and blocked login/files.
- Role/status/version/closure-field injection, invalid input and multi-byte bcrypt length.
- Normalized/concurrent duplicate identities, generic responses, database index metadata and rate limits across fresh sessions.
- Registration approval/rejection, member-only role assignment, conflicting/repeated decisions and Enable bypass denial.
- Anonymous/member denial, CSRF, unknown targets, injected roles and unsupported decisions.
- Authenticated settings, deletion request status/dates, confirmation, target-ID injection and concurrent duplicate requests.
- Closure, old-cookie revocation, data/file preservation, rejection/new requests, stale IDs and conflicting decisions.
- Administrator self/last-admin protections and competing cross-closure approvals.
- Scoped/attributed audit review, forged active workflow states, decision write/audit failures and generic public audit-failure responses.

**Seven new real Redis/CouchDB tests** verify pending registration/approval and persisted decisions/audits; identity reservation and privilege rejection; rejected-registration Enable denial; actual Redis cookie revocation and preserved file metadata after closure; rejected/new request history and stale decisions; concurrent registration decisions; and compatibility with actual CouchDB design metadata. They launch the production application with real services and use fresh service instances/real database reads to verify persistence. No real-service adapter is mocked.

## Audits and failure behavior

New events are `registration.requested`, `registration.approved`, `registration.rejected`, `account.deletion_requested`, `account.deletion_rejected` and `account.closed`. They store target ID/username, previous/new status, relevant request ID, timestamp, request IP and truncated User-Agent. Decision actor IDs/usernames come from the freshly loaded administrator; deletion requests identify the requester. Public intake does not assert a verified registrant identity. Passwords/hashes, cookies, CSRF tokens and configuration secrets are not added.

Account updates and audit inserts are **not atomic**. Private workflow operations report HTTP 503 when a committed update cannot be audited. Public registration preserves its generic response after a saved pending record/audit failure and emits a fixed operator error; it does not claim the audit was saved. No rollback, durable outbox or replay is implied. Repeated no-op actions cannot repair missing events. Process crashes or transport failures may leave gaps/uncertain outcomes; operators must inspect persisted state. All records remain retained.

The admin history view is target-scoped, escaped and capped at the latest 100 matching account-management events. It does not expose raw arbitrary details or credentials. Full audit history stays in CouchDB; the current implementation scans audit documents before filtering. Scaling/indexing/pagination beyond this small single-instance use requires further review.

## Final verification

[Completed final source CI](https://github.com/justinwj/portal-bsc/actions/runs/42537438696) at `3f9d6fd2967097084deee98e5395bc746bad3415`: **success**. All three jobs and their verification steps were inspected.

| Final suite | Passed | Failed | Cancelled | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Linux unit/HTTP/tooling: 139 existing + 42 new cases | 181 | 0 | 0 | 0 |
| Real Redis/CouchDB, production HTTP/download/NAS: 66 existing + 7 new cases | 73 | 0 | 0 | 0 |
| Production Docker/Compose, bootstrap and startup | 11 | 0 | 0 | 0 |
| Windows tooling independently repeated | 23 | 0 | 0 | 0 |
| **All executions** | **288** | **0** | **0** | **0** |

There are **265 distinct tests**; Windows repeats 23 tooling contracts. All pre-existing tests remain enabled and pass. The actual CouchDB metadata compatibility case passed. Type checking, production TypeScript and Docker builds, production startup/bootstrap, Compose configuration/persistence/recreation and read-only NAS checks passed. The actual image runs Node **22.23.4** and reports `tests: []`, `entrypoints: true`, `assets: true`; rendering dependencies remain at the reviewed versions. No Docker image was published, and test teardown retained volumes.

Both full and production npm 10.9.9 audits exited **0**, with zero findings. `npm ls --all --json` exited **0** with no invalid peers. No package/lockfile/override changed. CI retains the full audit/peer checks and production critical/high gate.

CI's full audit/peer checks and production security gate passed. Final whitespace validation exited **0**. Original `.idea` file hashes match the baseline; the three additions remain staged and excluded from all session commits. Existing local users, production credentials and NAS files remain untouched.

## Exact files changed

```text
README.md
docs/administrator-accounts.md
docs/account-lifecycle.md
docs/development-session-7e.md
src/app.module.ts
src/auth/auth.service.ts
src/common/account-state.ts
src/common/couchdb.service.ts
src/common/dto/common.dto.ts
src/common/guards/auth.guard.ts
src/users/lifecycle.controller.ts
src/users/lifecycle.test.ts
src/users/users.controller.ts
src/users/users.service.ts
test/integration/lifecycle.test.ts
views/account-history.hbs
views/account.hbs
views/admin-users.hbs
views/layouts/main.hbs
views/login.hbs
views/register.hbs
views/workflow-error.hbs
```

## Outstanding limitations and decisions

- One Node process/one UsersService singleton is required. The queue is not a distributed lock, database uniqueness constraint or protection against independent writers. Multi-instance scaling needs separately approved coordination.
- Email ownership is not verified and no mail is sent. Administrators must verify eligibility/identity through their approved organizational process. CAPTCHA/distributed abuse protection is not claimed. IP limits reset on restart, shared NATs share a bucket, and the existing trusted-proxy/private-backend boundary must be maintained. Hashing duplicates reduces an obvious timing difference but is not a formal constant-time guarantee.
- Existing administrative shared-email behavior is preserved. Public registrations reserve normalized usernames/emails; legacy login spelling is not migrated. Rejected/closed identities remain reserved.
- Decisions are final except for idempotent repetition; reconsideration, closed-account reopening, permanent deletion, retention/disposition and recovery policies require separate approval. Existing lockouts are untouched.
- Audit writes have the durability limitations above. Subsequent protected requests are revoked, not already-authorized in-flight transfers.
- Interactive Rider/browser/assistive-technology acceptance was not performed or claimed. Automated HTTP/CSP tests verify the server-rendered controls.
- Sessions 7F (quotas) and 7G (uploads) remain unimplemented. No NAS data or production service was used as a test fixture.

This session stops after final successful CI for independent review.
