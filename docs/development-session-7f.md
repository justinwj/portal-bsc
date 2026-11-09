# Development Session 7F: administrator capacity and quota policy

## Scope and commits

- Branch: `codex/portal-bsc-r1-fixes`.
- Reviewed starting SHA: `62cb81dbfce507a2a6ea80179966d5d2be1f5814`.
- RED HTTP/service/container contracts: `7e142920d235777bd452bcc59ed676993b8645ef`.
- GREEN implementation: `4061f43e9e9c74726d662b0abb79faa57ed07c5a`.
- Final source/refactor SHA: `90ea0041f05c6945b5ac437253dc5e8c1481db27`. Final report publication SHA is recorded by the final CI/handoff; a document cannot contain its own Git object hash.

Session 7F implements persistent administrator policy, active-user capacity enforcement, overrides and metadata-only usage reports. It adds no uploads, SMTP, permanent deletion, distributed coordination, production credential change, deployment, image publication or merge. No database, Docker volume or actual NAS file was deleted, moved, modified or truncated. Existing local user records were not used as fixtures or repaired.

## Baseline

Verified branch, HEAD and working tree; fetched origin; read `AGENTS.md` and `.github/copilot-instructions.md` from `origin/master`; reviewed Session 7E, account controls, bootstrap implementation and persistence tests. Original staged `.idea` additions, ignored `.idea/vcs.xml` and the unrelated options report are preserved. Explicit-path `commit --only` excludes unrelated staged files.

| Check | Actual result before production changes |
| --- | --- |
| npm 10.9.9 `ci` | Exit 0; 216 installed / 217 audited, zero findings |
| Type checking | Exit 0 |
| Full local suite | Exit 0; **181 passed**, 0 failed/cancelled/skipped |
| Production TypeScript build | Exit 0 |
| Full and production audits | Both exit 0, zero findings |
| npm 10.9.9 `ls --all --json` | Exit 0, no invalid/unresolved peers |
| [Reviewed Session 7E CI](https://github.com/justinwj/portal-bsc/actions/runs/42537778704) | Completed success at starting SHA; 265 distinct tests + 23 Windows repetitions = **288 passing executions**, no failures/cancellations/skips; production Docker build/startup passed |

Local Windows uses Node 24.19.0 / host npm 11.17.0. Install, audit and tree commands explicitly use npm **10.9.9**; Node 22 CI independently verifies production compatibility. Actual service/container tests run only against disposable CI services and retained test volumes. No package, lockfile, override or runtime dependency version changed.

## Bootstrap/recovery analysis before implementation

The established explicit CLI bootstrap creates a new administrator, preserves an existing active administrator/password, rejects member collisions and rejects disabled-administrator recovery without a separate policy. Applying the ordinary-management capacity check to that CLI would change this established behavior.

The implementation therefore preserves the privileged bootstrap path, rather than changing recovery policy: ordinary creation, approval and reactivation enforce capacity; explicit bootstrap still creates at capacity. It uses a private service creation path, not an HTTP bypass flag. The resulting count may exceed the policy and is displayed as Over capacity. No existing user is automatically disabled. Operators must raise the maximum or review eligible accounts; settings cannot be saved below the actual count. Existing disabled-admin/collision rules remain intact. No automatic repair, promotion or account reactivation was added.

This distinction was stated before implementation and tested locally; a further real production-CLI test verifies creation at capacity, the reported over-capacity state and preservation of the original hash on repeated bootstrap. It does not require changing the approved recovery policy. The exception and its implications are explicitly documented in [administrator instructions](capacity-and-quotas.md#explicit-bootstrap-exception-existing-recovery-policy-preserved).

## RED evidence

New local tests run actual Nest routes, sessions, AuthGuard/AdminGuard, CSRF, strict DTO validation, Handlebars and Helmet. Only the external persistence adapter is replaced. Database reads/writes clone documents, writes yield so races can overlap, and the test environment explicitly enables test-only memory sessions.

Initial HTTP RED: **46 tests, 3 passed / 43 failed**, zero cancelled/skipped. Failures demonstrate missing settings/override/reporting routes, capacity-free ordinary creation/approval/reactivation, absent validation/audits, missing mode distinctions, incomplete-metadata handling, policy failures and persistence behavior. Existing CSRF rejection and idempotent activation already worked; no failures were invented for those behaviors.

Four focused unit contracts were also written before the new parser/accounting module existed: **4 executed / 0 passed / 4 failed**. Their initial missing-module failures characterize missing new implementation; meaningful HTTP failures independently establish the required behavior.

[Independent RED CI](https://github.com/justinwj/portal-bsc/actions/runs/42547415692), before production changes:

| Suite | Passed | Failed | Cancelled | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Unit/HTTP/tooling including first 46 new cases | 184 | 43 | 0 | 0 |
| Real Redis/CouchDB including five new cases | 73 | 5 | 0 | 0 |
| Production Compose/container including three persistence cases | 11 | 3 | 0 | 0 |
| Windows tooling | 23 | 0 | 0 | 0 |
| **All executions** | **291** | **51** | **0** | **0** |

The real-service failures cover persistent exact settings/audits and fresh application startup, final-slot concurrency, override assignment/removal, scoped managed usage and invalid-input persistence. The three container failures establish missing policy/override persistence across normal startup, restart and recreation with retained storage. All pre-existing tests remained enabled and passed.

## GREEN implementation

Portal settings are stored as a schema-versioned `portal-settings` document in the existing `portal_users` database; overrides are optional on user records. No fifth database or bulk migration is introduced. Missing settings are represented as Not configured, not silently as Unlimited. Only an actual CouchDB 404 means absence. All other read errors and invalid policy fail closed, with no production memory/default fallback.

The administrator interface supports `not-configured`, `unlimited` and numeric values. GB uses BigInt decimal conversion at one-byte resolution, with no floating-point GB multiplication. Supported policy bytes are bounded by 9,007,199,254,740,991 and stored as canonical integer strings; active-user maxima are safe integer counts. Negative, malformed, fractional-byte, overflowing, exponent/NaN/Infinity, non-string and unwhitelisted inputs are rejected without settings writes. Zero is numeric, not Unlimited.

The existing singleton mutation queue now includes settings and override writes. Active capacity checks run inside it on ordinary creation, pending approval and disabled reactivation. They count active approved accounts including administrators and legacy active records, and exclude pending/rejected/disabled/closed accounts. Numeric maxima below the current count are rejected. Pending intake and idempotent already-active requests remain available. Concurrent activation and settings-reduction tests assert the count/policy invariant.

An individual override wins over the default. `inherit` removes it using null, because deleting a field from a partial user object would otherwise retain the old value during CouchDB merge. Identity, role, active state, hash and session version are preserved; update time changes normally. Policy documents are excluded from account targets and counts, preventing their accidental treatment as users.

Usage reads metadata only. It deduplicates managed file IDs, accounts globally once, uses existing ownership metadata for user attribution, retains disabled/closed owners' files in totals, and reports unknown owners without assigning them to an administrator. Legacy/unmarked and explicit external-NAS metadata are excluded and counted visibly. Invalid sizes/IDs, contradictory copies/scopes and unknown classifications produce lower bounds and Unknown remaining-capacity results. BigInt sums remain exact above Number.MAX_SAFE_INTEGER. No physical NAS scan or modification is performed.

The first targeted implementation had **47 passed / 3 failed** out of 50 (46 HTTP + 4 unit). Two failures were test setup errors, corrected without weakening the requirements: a disabled-session test needed a new anonymous CSRF token after its first rejection destroyed the session; a bootstrap over-capacity assertion was incorrectly placed after manually disabling another fixture administrator, bringing the count back within capacity. The third failure exposed ordinary status validation still accepting the new non-user policy document and was corrected with typed user lookup.

A rendered-form test then demonstrated an empty override-form CSRF token caused by incorrect Handlebars context depth: **1 executed / 0 passed / 1 failed**. Correcting the context produced a working rendered-token submission. Full local GREEN: **232 passed**, 0 failed/cancelled/skipped; type checking and production build passed.

[First GREEN CI](https://github.com/justinwj/portal-bsc/actions/runs/42548159023): all jobs passed, **232 local-suite + 78 real-service + 14 container + 23 Windows = 347 passing executions**, no failures/cancellations/skips. The three restart/recreation checks passed and retained the data volume.

## Refactoring evidence

Parsing, stored-policy validation, display formatting and exact usage arithmetic are centralized. QuotaService is a read/report helper; UsersService retains mutation and fresh actor validation under its existing queue. Controllers remain thin, templates receive derived limits and completeness flags, and audit values are canonical rather than reflecting raw request bodies.

Additional regressions found and corrected:

- **Conflicting duplicate scope:** unit run **5 passed / 1 failed** out of six showed a managed/external disagreement incorrectly looking complete. Classification now occurs after grouping IDs, and ambiguous copies contribute only to incomplete/lower-bound reporting.
- **JSON property order:** targeted HTTP **0 passed / 1 failed** showed semantically identical stored overrides causing an unnecessary write/audit. Stored overrides are now validated/canonicalized before comparison. Corrupt overrides are rejected rather than replaced by defaults.
- **Partial-commit title:** an enhanced existing audit-failure test failed because the error page title claimed "Settings not changed" even though the save succeeded. The title is now neutral, while the error text explicitly reports the committed settings and missing audit.

The final local suite passed **235 tests**, 0 failed/cancelled/skipped, with typecheck and production build exiting 0. Existing assertions remain enabled. Three older external-store fixtures explicitly return absent policy for their legacy scenarios; the production code does not treat a missing adapter method or backend error as absent policy. No old account/CSRF/lifecycle assertion was removed or relaxed.

## Final test coverage

- **Six unit cases:** exact GB/mode parsing; rejection/bounds; global/user deduplication and attribution; invalid-size completeness; contradictory scope handling; corrupt stored-policy rejection.
- **48 new HTTP cases:** administrator authorization and CSRF, validation/modes/bytes, active-count exclusions, create/approve/enable boundaries, pending intake, final-slot and settings-reduction races, idempotence, bootstrap policy, overrides/removal, metadata accounting and read/write/audit failures, plus actual rendered override-token submission.
- **Six real-service cases:** fresh-app settings/audit persistence; real final-slot activation race; persisted override removal without identity loss; managed-vs-legacy metadata; invalid requests/authentication-error propagation; actual production CLI bootstrap at capacity and repeated-hash preservation.
- **Three new container cases:** policy/override persistence in the production image; CouchDB/application restart; CouchDB/application recreation while retaining the same CouchDB volume.

## Final CI and security verification

[Completed final source CI](https://github.com/justinwj/portal-bsc/actions/runs/42549066906), at `90ea0041f05c6945b5ac437253dc5e8c1481db27`: **success**. All three jobs and their steps were inspected. Linux and Windows used Node **22.23.4** and npm **10.9.9**.

| Final suite | Passed | Failed | Cancelled | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Linux unit/HTTP/tooling: 181 existing + 54 new cases | 235 | 0 | 0 | 0 |
| Real Redis/CouchDB: 73 existing + 6 new cases | 79 | 0 | 0 | 0 |
| Docker/Compose persistence and startup: 11 existing + 3 new cases | 14 | 0 | 0 | 0 |
| Windows tooling independently repeated | 23 | 0 | 0 | 0 |
| **All executions** | **351** | **0** | **0** | **0** |

There are **328 distinct tests**; Windows repeats 23 tooling contracts. All prior 7D/7E and older security regressions remain enabled. Production TypeScript/Docker builds, type checking, startup/bootstrap, real CLI-at-capacity behavior, NAS read-only checks, Compose persistence/restart/recreation and quota/override reads from fresh service/application instances passed. The actual image runs Node **22.23.4** and reports `tests: []`, `entrypoints: true`, `assets: true`. No image was published and teardown retained the named CouchDB volume.

Both final npm 10.9.9 audits (`--json`, and `--omit=dev --json`) exited **0** with zero findings. `npm ls --all --json` exited **0**, with no invalid/unresolved peers. Packages, lockfile and overrides are unchanged. The existing full-audit/peer validation and production critical/high gate remain enabled.

The same CI audit/peer validation steps and production gate passed. Whitespace validation exited **0**. Original `.idea` hashes match the baseline, all three additions remain staged outside session commits, and unrelated files are preserved. No interactive Rider or screenshot acceptance is claimed.

## Audits and durability limits

`portal.settings_changed` records canonical previous/new settings; `user.quota_changed` includes the target user and previous/new override (null means inherited default). Both identify the fresh actor ID/username, timestamp and request context. No password/hash/cookie/CSRF/configuration credential is added. Identical submissions do not generate transition audits.

Settings/user writes and audit inserts are not atomic. A successful save followed by failed auditing returns HTTP 503 with an explicit partial-outcome message and fixed operator log; no rollback or audit replay is claimed. Unchanged retries do not recreate missing events. Transport failures may make write outcomes uncertain. Inspect saved state and audit records rather than assuming a failed response means nothing changed.

## Exact changed files

```text
README.md
docs/account-lifecycle.md
docs/administrator-accounts.md
docs/capacity-and-quotas.md
docs/development-session-7f.md
src/app.module.ts
src/common/couchdb.service.ts
src/common/dto/common.dto.ts
src/common/quota-policy.ts
src/common/quota-policy.test.ts
src/csrf.http.test.ts
src/users/account-management.test.ts
src/users/lifecycle.test.ts
src/users/quota.controller.ts
src/users/quota.service.ts
src/users/quotas.test.ts
src/users/users.controller.ts
src/users/users.service.ts
test/integration/quotas.test.ts
test/persistence/persistence.test.ts
views/admin-settings.hbs
views/layouts/main.hbs
```

## Semantics, security limits and manual acceptance

See [Capacity and storage quota controls](capacity-and-quotas.md) for exact input semantics, override precedence, accounting completeness, administrator instructions and a screenshot/keyboard/accessibility checklist. No Rider GUI, visual screenshot or assistive-technology pass was performed or claimed.

Storage is **policy/reporting only in 7F**. Uploads and commit-time enforcement remain for 7G. Nothing claims enforcement against the DS925+'s entire storage or direct SMB writes. Physical aliases and out-of-band file changes cannot be verified by metadata-only accounting. Not configured and Unlimited retain different policy meanings; no future unconfigured-upload policy is silently selected here.

Single-process serialization is not distributed coordination, a database uniqueness constraint or protection against independent writers. Explicit bootstrap may exceed the cap by design to preserve recovery policy. No existing account is disabled automatically. Existing lockouts, malformed policy recovery and future upload/storage-provenance enforcement need appropriate separate review.

Production CouchDB initialization/fail-fast behavior, administrator lockout prevention, legacy account handling, session revocation, registration/deletion workflows, NAS read-only protections and all prior security tests remain intact. Original staged `.idea` changes and unrelated local files are preserved. This session stops after final successful CI for independent review.
