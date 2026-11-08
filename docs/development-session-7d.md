# Development Session 7D: user management safety and audit controls

## Commits and scope

- Branch: `codex/portal-bsc-r1-fixes`.
- Starting reviewed SHA: `c5a4821add471361d9e23ef81acf98c3ec63cfe7`.
- RED HTTP and real-service tests: `1ec50f92b42dc6720d22858af30ba65ca16948d0`.
- Initial GREEN implementation: `11006c89d83b32ca5191a614808e50102c9c83d0`.
- Refactoring and guarded rendering correction: `ede0d67be80d1332269fce83d7a0864769517776`.
- Final source/test correction: `f1e3258b92a19a37f3bf2250dafd81e5c67854ff`. The final documentation publication SHA is recorded by the final workflow and handoff; a document cannot contain its own Git object hash.

Session 7D implements only safe account status changes, reactivation, confirmation, session revocation and status audits. Registration, deletion workflows, quotas and uploads remain unimplemented. No merge, deployment, image publication, Docker volume deletion, production credential change or repair of existing local accounts occurred.

## Baseline verification

Verified branch, HEAD and working-tree status; fetched origin; read `AGENTS.md` and `.github/copilot-instructions.md` from `origin/master`; reviewed Session 7C and the development workflow. Inspected controllers, UsersService, AuthService/AuthGuard/RolesGuard, templates, session/CSRF/validation setup, CouchDB writes and AuditService. All original staged `.idea` additions and the ignored `.idea/vcs.xml` are preserved; the pre-existing untracked options report is untouched. Commits use explicit paths with `--only` to exclude the user's staged files.

Local environment: Windows, Node **24.19.0**, host npm **11.17.0**. Lock-compatible installation, audit and dependency diagnostics explicitly use **npm 10.9.9**. Docker is now available: client/engine **29.9.2**, Docker Desktop **4.98.0**. Disposable CI services were used for actual integration/container testing; existing local services and CouchDB user records were not used as test targets.

| Baseline check | Actual result |
| --- | --- |
| Initial npm 10.9.9 `ci` | Failed, exit -4048 / Windows EPERM unlinking bcrypt.node; a running development watcher was present |
| `ci` retry | Exit 0; 216 installed, 217 audited, zero findings; no process force-termination or source correction used |
| `npm run typecheck` | Exit 0 |
| `npm test` | Exit 0; **105 passed**, 0 failed/cancelled/skipped |
| `npm run build` | Exit 0 |
| Full audit and production audit | Both exit 0; zero findings |
| npm 10.9.9 `ls --all --json` | Exit 0; no invalid/unresolved peers |
| [Reviewed Session 7C CI](https://github.com/justinwj/portal-bsc/actions/runs/41439616348) | Completed success at the expected SHA: 105 local-suite + 59 real-service + 11 container = **175 distinct tests**, plus 23 Windows repeats = **198 passing executions**, no failures/cancellations/skips; Docker build passed |

The install retry restored the dependency tree before testing. No production files changed during baseline verification. Package declarations and lockfile remain unchanged throughout this session.

## RED evidence

New tests exercise actual Nest controllers, guards, bcrypt authentication, session cookies, CSRF, strict DTO validation, Handlebars and Helmet/CSP. The local HTTP harness replaces only the external database adapter with a test-owned store. Reads and writes clone documents rather than sharing mutable object references; writes yield so concurrent operations can overlap. Its memory session store is explicitly test-only (`NODE_ENV=test`, development/test fallback enabled).

Local first RED: **28 tests, 10 passed, 18 failed**. Additional service validation, duplicate-operation and session characterizations brought the pre-correction local suite to **32 tests, 10 passed, 22 failed**, zero cancellations/skips. The failure set includes:

| Contract | Observed baseline defect |
| --- | --- |
| Own-account disable with one or multiple active administrators | HTTP 302 instead of 403; service permitted self-disable |
| Missing/member/disabled/nonexistent acting administrator | Service accepted changes without fresh actor authorization |
| Last administrator / simultaneous conflicting service operations | Both calls succeeded, permitting zero active administrators |
| Concurrent HTTP actions | Unsafe outcomes were reproduced locally and with real services; HTTP timing sometimes already caused one guard to reject, so the deterministic service race is also asserted |
| Non-boolean status | Service accepted a non-boolean value |
| Member/administrator reactivation | Enable endpoint returned 404 |
| Repeated transitions and audit attribution | No successful status audit records existed |
| Disable confirmation and administration feedback | POST required no confirmation; no confirmation route or Enable controls existed |
| Unobserved old session after fixture reactivation | Protected route returned **200 instead of 401**, independently of the missing Enable route |
| Audit failure | Status returned a success redirect instead of reporting the failed audit |
| Account-write failure | Uncontrolled HTTP 500 instead of a safe storage-unavailable response |

Existing disabled-login rejection, destruction of sessions presented while disabled, role denial and CSRF behavior already worked. Those positive characterizations were retained; no RED was manufactured for them. In particular the destroyed-session characterization passed before corrections, while the independent unobserved-cookie test failed.

[Independent RED CI](https://github.com/justinwj/portal-bsc/actions/runs/42531863842), committed before production changes:

- Unit/HTTP/tooling: **115 passed, 18 failed** (133 executed, including the first 28 new tests).
- Actual Redis/CouchDB integration: **59 passed, 5 failed** (64 executed). All five new production account tests failed: self-disable, persisted transitions/audit/version, old-cookie revocation after reactivation, conflicting administrators, and administrator reactivation/idempotence.
- Container/Compose: **11 passed**. Windows tooling: **23 passed**.
- Total: **208 passed, 23 failed**, zero cancellations/skips. Every pre-existing test remained enabled and passed.

## GREEN implementation

The service accepts an acting administrator ID for `setUserActive`, rejects missing/inactive/non-administrator actors, validates boolean status, rejects self-disable with HTTP 403, and protects the last active administrator. Account data is copied before writing so a failed save does not mutate a shared fallback-store document.

One queue on the singleton UsersService serializes the entire status operation across all target accounts. After obtaining it, the service rereads the acting administrator, target and active administrator count. Two competing administrators cannot both disable each other: the losing queued request discovers its actor is disabled. This is not an unprotected read-count-write check. Errors release the queue. Repeating an already-set status is a no-op and does not duplicate successful audits or increment revocation versions.

The existing disable POST is retained and an enable POST is added. Both use AuthGuard followed by AdminGuard, CSRF and strict form validation. The common AdminGuard replaces duplicated controller role checks. GET disable previews render a confirmation page; the actual POST requires `confirmed=yes` and repeats service validation. Enable preserves username, role, email, password hash and creation time. Existing password policy and bootstrap collision/recovery rules are unchanged.

`sessionVersion` is optional on legacy user records and sessions, defaulting to zero. Each actual status transition increments the persisted version. Login copies the version into its new session and AuthGuard compares it on every protected request. Enabling rotates the version too: old cookies remain invalid even when they were never used during the disabled interval, including accounts disabled before versioning existed. Reactivated users must sign in again. No-op requests do not rotate the version. No bulk migration or existing local account rewrite is performed.

Local targeted GREEN: **32/32 passed**. Full local regression: **137/137 passed**, with typecheck and production build exiting 0.

[First GREEN CI](https://github.com/justinwj/portal-bsc/actions/runs/42532303098): all jobs passed, **137 local-suite + 64 real-service + 11 container + 23 Windows = 235 passing executions**, zero failures/cancellations/skips.

## Refactoring and additional verification

Status validation is shared between confirmation previews and mutations. Administrative view models are built from current backend records without passwords or hashes. Controllers share status-change/error handling; fixed feedback messages use a Map whitelist rather than arbitrary query text. Templates display current identity, roles, Active/Disabled, self/last-administrator protection and Enable/Disable controls. Confirmation, cancellation and status/error feedback use native server-rendered controls and semantic status/alert roles, with no inline scripts and no Helmet/CSP changes.

A further race test exposed an error-path defect in the initial implementation: an actor disabled after guard validation could receive the administration table within its 403 rejection page. Targeted RED: **1 executed, 0 passed, 1 failed**. The external-store fixture changes status after the guard's detached read; actual guards/controllers still execute. Rendering now revalidates the active administrator through the same service helper, so that rejected actor receives no administrative table. The unchanged regression now passes.

Post-refactor local results: **138 passed**, 0 failed/cancelled/skipped; typecheck and production build passed. No pre-existing assertion was weakened. One bootstrap fixture now uses a direct disposable database save to arrange an already-disabled account rather than invoking ordinary management without an actor. Its original bootstrap rejection and account-preservation assertions remain intact.

A sixth real-service test adds CouchDB-side audit rejection coverage. A unique test-owned design validation document rejects only `user.disabled` for that test's unique target ID. It communicates with actual CouchDB; no database adapter is mocked. The test checks HTTP 503, committed disabled status, absence of a success audit and no disclosure of the private rejection reason. Cleanup removes only its own temporary validation document, never user/audit records, databases or volumes. The mechanism follows [CouchDB document validation](https://docs.couchdb.org/en/stable/ddocs/ddocs.html#validate-document-update-functions).

[Refactor CI](https://github.com/justinwj/portal-bsc/actions/runs/42532608923) passed **138 local-suite + 65 real-service + 11 container + 23 Windows = 237 executions**, with zero failures/cancellations/skips. The real CouchDB audit rejection passed.

Backward-compatibility review then identified one more gap: a pre-7D disabled record without a version could be enabled with version zero, allowing its unobserved old cookie to work again. A new targeted HTTP test demonstrated **200 instead of 401**: **1 executed, 0 passed, 1 failed**. The minimum correction rotates the version on both actual transitions, including Enable. A seventh real-service test arranges only its newly created fixture as a legacy disabled record and checks that old Redis cookies are rejected and a fresh login succeeds. No existing local record is migrated or repaired.

Final local regression after the legacy correction: **139 passed**, 0 failed/cancelled/skipped; typecheck and production build exited 0.

## Administrator protections and coverage

The 34 new local HTTP/service tests cover:

- Self-disable with one/multiple administrators, direct-service enforcement and preserved administrator session.
- Disabled administrators excluded from safety counts; fresh acting-administrator validation.
- Conflicting service and HTTP actions; repeated and concurrent duplicate transitions.
- Member and administrator reactivation with original account data and fresh login.
- Member/unauthenticated denial, missing/invalid CSRF and nonexistent IDs for both endpoints.
- Confirmation, CSP, current-account/last-administrator controls and understandable feedback.
- Existing disabled-session destruction, unobserved-cookie revocation, legacy disabled records, reactivation and required fresh login.
- Actor/target/status/timestamp/request audit context, storage-write failure, partial audit failure and guarded error rendering.

The seven new real-service tests cover self-disable/session preservation; persisted account data, versions and actor/target audit identity; Redis session rejection after disable/enable; legacy disabled account reactivation; concurrent administrator requests; repeated administrator disable/reactivation; and actual CouchDB audit rejection after status commit.

## Audit behavior and explicit durability boundaries

Successful events are `user.disabled` and `user.enabled`. Existing AuditRecord fields `userId` and `username` identify the acting administrator; details contain `targetUserId`, `targetUsername`, `previousStatus`, `newStatus` and a truncated User-Agent. `createdAt` supplies an application timestamp and `ip` uses the existing request/proxy configuration. Passwords, hashes, cookies, CSRF/session secrets and database credentials are not added. Failed and unchanged actions do not claim successful transition audits.

The account save and audit insert are **not atomic**. A failed audit after a successful save returns 503 and an explicit partial-outcome message; no automatic rollback, outbox or audit replay is claimed. The operator log uses a fixed message without backend error details. Repeating the completed status is a no-op and cannot repair a missing event. A process crash between writes may leave an unaudited change; a transport failure may leave a write outcome uncertain. Operators must inspect persisted account/audit state. These limitations are documented for administrators.

Concurrency protection covers one Node process, one Nest singleton and status operations routed through this service. It does not coordinate multiple application instances, worker processes, independent services, replication or external database edits. Scaling requires separately approved distributed coordination. The confirmation preview is not a reservation. Revocation rejects subsequent protected requests; it does not cancel already-authorized in-flight responses/downloads.

An already-existing zero-active-administrator database is not repaired by this session. Bootstrap still rejects disabled administrators and member collisions rather than silently promoting/reactivating accounts. No existing local user was inspected or rewritten for recovery.

## Final verification

[Completed final source CI](https://github.com/justinwj/portal-bsc/actions/runs/42533033246), at `f1e3258b92a19a37f3bf2250dafd81e5c67854ff`: **success**. All three jobs and their steps were inspected. Both operating systems used Node **22.23.4** and npm **10.9.9**.

| Executed suite | Passed | Failed | Cancelled | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Linux unit/HTTP/tooling (105 existing + 34 new account contracts) | 139 | 0 | 0 | 0 |
| Real Redis/CouchDB, production HTTP/download/NAS (59 existing + 7 new account cases) | 66 | 0 | 0 | 0 |
| Production Docker/Compose persistence, bootstrap and startup | 11 | 0 | 0 | 0 |
| Windows tooling repeated independently | 23 | 0 | 0 | 0 |
| **All CI executions** | **239** | **0** | **0** | **0** |

There are **216 distinct tests**; Windows repeats the 23 tooling contracts. Every previously passing test remains enabled. Both new legacy-session tests, the guarded error-rendering test and the real CouchDB audit-rejection test passed.

Production TypeScript compilation, full source/test type checking, the actual production Docker image build, Compose configuration checks, fresh startup, bootstrap, read-only NAS checks and persistence/recreation checks passed. Image inspection reported `tests: []`, `entrypoints: true`, `assets: true`; actual image Node **22.23.4**, renderer **9.0.4**, glob **14.0.3**, minimatch **11.0.4**. Docker images were built for testing and were not published. Persistent test volumes were retained; no local NAS was deployed to or accessed for test data.

Both final local npm 10.9.9 audits exited **0**, with zero findings in full and production dependency graphs. `npm ls --all --json` exited **0**. No package version, lockfile, dependency override or security exception changed. CI retains full audit/peer validation and the production critical/high gate.

The same CI audit/peer checks and production security gate passed with zero known findings. Final `git diff --check` exited 0. All four original `.idea` file hashes match their starting snapshot; the three additions remain staged and outside session commits. No interactive Rider acceptance is claimed.

## Exact files changed

```text
README.md
docs/administrator-accounts.md
docs/development-session-7d.md
src/auth/auth.service.ts
src/common/couchdb.service.ts
src/common/dto/common.dto.ts
src/common/guards/admin.guard.ts
src/common/guards/auth.guard.ts
src/common/roles.ts
src/users/account-management.test.ts
src/users/users.controller.ts
src/users/users.service.ts
test/integration/00-production-couchdb.test.ts
test/integration/account-management.test.ts
views/admin-disable.hbs
views/admin-users.hbs
```

## Approved future requirements: documentation only

### Session 7E: self-registration and account lifecycle

- Public registration form, with administrator approval required.
- New registrations initially have no protected-file access; approved users receive the member role.
- Users can request account deletion; administrators approve or reject those requests.
- File retention/disposition requires explicit administrator review.
- Appropriate registration abuse prevention and audit controls.

### Session 7F: administrator-configured quotas

- Maximum active-user count.
- Default per-user quota in GB, with administrator overrides for individuals.
- Global portal storage limit in GB.
- Usage reporting and enforcement.
- Clear distinction between Portal-managed storage and data written directly through Synology SMB.

### Session 7G: uploads and quota enforcement

Authorized uploads and quota enforcement when committing files to Portal-managed storage. NAS read-only protections are unchanged in 7D; any future writable storage boundary needs its own review.

All three sessions require separate implementation authorization. No routes, forms, schemas, counters or upload handling for these future features were added.

## Remaining risks and manual acceptance

The single-instance and audit durability limitations above remain explicit. Existing lockouts require separate recovery approval. Automated HTTP checks exercise the new rendered controls and CSP, but interactive Rider, browser and assistive-technology acceptance were not performed or claimed. Session 7C's interactive Rider checklist remains pending user execution. This session stops after completed successful CI for independent review.
