# Session 7I — usability and member-wide visibility

Repository release candidate only. Starting HEAD `4be77e23f1c3f5ab7930138a17c6b224017b7e14`, branch `codex/portal-bsc-r1-fixes`, matched the owner-reported deployed source. Ending implementation SHA **`6bb3e618ec414181ac4217b02f041716b81d721f`**, verified by [CI 44980635687](https://github.com/justinwj/portal-bsc/actions/runs/44980635687). A subsequent evidence-only commit records results; its final HEAD and CI are supplied with the review handoff because a commit cannot embed its own hash. Read `AGENTS.md` and `.github/copilot-instructions.md` from `origin/master`. Existing staged `.idea` files and unrelated untracked options report are preserved. No NAS connection, production data/credential change, infrastructure recreation, Tailscale/network/port change, administrator reseed, image publication or merge occurred.

## Baseline

Before changes, `npm ci`, typecheck, **556 local tests** and production TypeScript build exited 0. Starting CI from Session 7H-C1 was 1079 executions / 713 distinct cases, zero failures/cancellations/skips. Windows workstation Node 24.22.1/npm 11.19.1; CI/production retain Node 22 and npm 10.9.9 compatibility. Runtime dependencies/lockfile, Dockerfile and protected Compose/network configuration remain unchanged.

## RED → GREEN

Added 21 actual Nest HTTP cases using sessions, guards, validation, CSRF, Handlebars, storage and real streamed downloads; only the external database is replaced in this local suite. Initial run: **3 passed / 18 failed**, zero cancellations/skips. Five policy-rendering failures, six browser/navigation/status failures and seven visibility failures exposed the missing behavior; existing API/CSRF and legacy-read behavior were not made artificially failing.

1. **Confirmation:** persisted backend state was already correct. Added conditional checked rendering and explicit Confirmed/Not confirmed status. Confirmed state is read on every page request, including fresh sessions. Tests preserve quota/max values, reject omitted/invalid submissions and expose audit-after-save failures without pretending the save rolled back. No automatic unconfirmation or quota-policy rewrite was introduced.
2. **Browser authentication:** page handlers carry explicit BrowserPage metadata. AuthGuard redirects only GET/HEAD HTML negotiation on those handlers to fixed `/login`. Wildcard/API/XHR requests, download/status endpoints and mutations retain JSON 401; authenticated authorization stays 403/404. Existing invalid-session destruction remains. New HTTP tests cover inactive/closed/pending/rejected/revoked accounts, CSRF, no redirect loops and fixed destinations.
3. **Visibility:** durable policy is stored as private/selected-members/all-members. Default applies only to new uploads; All members checks current active/approved account and owner/session state, never recipient-ID fanout. Existing v1 private records infer prior selected-recipient behavior when IDs exist. All/Private transitions clear recipient IDs/versions; owner control, quotas, immutable bytes and administrator audit requirements remain. New policies use owner-acl-v2 so the old binary cannot misinterpret them. Existing records do not migrate on read/startup.

Additional genuine RED checks: new policy-version test **0/1**, inconsistent v2 permissions **0/2**, and explicit-null mode validation **0/1**. Added version validation and fail-closed consistency checks; explicit null/malformed inputs now fail rather than becoming a default. Legacy idempotency fingerprints return existing private records unchanged. Six pure policy tests cover new modes, legacy inference and unknown-policy denial. Targeted HTTP suite **33/33**; browser upload JavaScript suite **9/9**. A further audit-renewal test failed 0/1 when restoring all-member access was mislabeled as revocation; the event selection was corrected and the 33-case HTTP suite passed again. Full managed-HTTP/policy regression **134/134**, zero failures/cancellations/skips; final full CI passed below.

An intermediate regression ran 583 cases, **577 passed / 6 failed**: the old label expectation and five browser doubles lacked the new UI contract. Updated terminology expectations to Selected members and added the real visibility form field to the DOM fixture; retained all prior authorization, error, retry and audit assertions. Existing private-data tests now explicitly request Private, keeping their denial/integrity assertions meaningful under the approved new default. No test was removed or disabled.

## Key decisions and compatibility

- Existing NAS role-based records remain unchanged/read-only. Managed file IDs, ownership, storage UUID, payload names/bytes, hashes, byte quotas and journal accounting remain intact. Only new uploads and explicit owner policy changes write v2; normal changes advance CouchDB revisions, while reads/restarts do not migrate legacy records.
- Legacy uploads/retries and recipient version snapshots remain supported. Owner suspension/closure blocks other readers; owner version changes need explicit renewal. Freshly reactivated users can access All members with a new current session; selected grants still require owner renewal.
- Visibility changes use the durable audit outbox and are idempotent. New explicit mode changes log file.visibility_changed; legacy selected/revoke submissions retain their existing events with previous/new visibility details. Admin non-owner reads require durable administrator-access audit, including all-member authorization. Audit/database/filesystem writes are not one atomic transaction; existing recovery semantics remain.
- **Rollback limitation:** old image `4be77e…` accepts only owner-acl-v1. It is retained, but is not a supported operational downgrade after v2 writes. Stop app and preserve all state for a compatible roll-forward rather than relabeling/deleting metadata or restoring only CouchDB. Independent review must consider this boundary before deployment. See [application-only upgrade/rollback proposal](session-7i-application-upgrade.md). No old-image rollback or live NAS acceptance is claimed executed.

## Refactoring and completed verification

The policy resolver is shared by validation, authorization, labels and audit classification. Controllers retain the existing single file-authorization path; no authorization logic is copied into templates/endpoints. Explicit page metadata separates rendered pages from status/download APIs without path regexes. Existing owner/recipient snapshot checks, byte accounting, storage integrity and durable outbox/recovery remain. Schema validation rejects inconsistent v2 grants; legacy inference is confined to old private records. This is a small policy/UI extension, not a new storage backend or account lifecycle.

Inspected every job and executed summaries in [first candidate CI 44980512040](https://github.com/justinwj/portal-bsc/actions/runs/44980512040), source `55777adb35b381af19c080297941c11128207b04`, and [corrected implementation CI 44980635687](https://github.com/justinwj/portal-bsc/actions/runs/44980635687), source `6bb3e618ec414181ac4217b02f041716b81d721f`. Both runs passed all four jobs; the latter includes the corrected renewal event/assertion.

| Execution group | Passed | Failed | Cancelled | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Linux unit/HTTP/tooling | 598 | 0 | 0 | 0 |
| Real Redis/CouchDB integration | 97 | 0 | 0 | 0 |
| Production Docker/Compose/persistence | 66 | 0 | 0 | 0 |
| Windows tooling | 82 | 0 | 0 | 0 |
| Windows upload/filesystem/sharing/formats | 296 | 0 | 0 | 0 |
| Docker24 socket compatibility | 13 | 0 | 0 | 0 |
| Compose2.20.1 normalized configuration | 11 | 0 | 0 | 0 |
| **Total executions / 761 distinct tests** | **1163** | **0** | **0** | **0** |

Final local regression **598/598**, typecheck/build and whitespace check passed. Local and CI full/production npm audits reported **zero known npm vulnerabilities**, exit 0; npm ls --all exited 0. CI observed Node 22.23.5/npm 10.9.9. Production TypeScript, app Docker image and restricted Nginx image builds passed. Runtime dependency manifests/lockfile and all infrastructure configuration are unchanged. This does not certify OS/image CVEs or live NAS/browser/Rider acceptance.

Five new real-service tests passed: persisted confirmation across new production processes/Redis sessions; browser/API differentiation with real session revocation; newly approved access with no ID fanout; exact legacy CouchDB revisions/IDs/ownership/hashes/journals across restart; and durable visibility audit changes without payload/quota duplication. The legacy fixture reproduces v1 private/selected documents and old fingerprints, including missing owner-grant fields on owner-private records. Post-read and post-restart snapshots remained deeply equal as JSON records, including `_rev`; this is not a claim about CouchDB's physical on-disk byte layout.

The new production-container case passed through actual TLS -> Unix Nginx -> production NestJS -> real CouchDB/Redis. It checks checkbox persistence, browser redirect/API 401, new default All members, member listings/exact attachment bytes, Private/Selected changes, app-only recreation, retained legacy-private denial and **zero published ports for all four services** with unchanged database container IDs. The TLS frontend models Serve in disposable CI; no actual Tailscale identity or live NAS connection is claimed.

## Exact files modified (25)

```text
README.md
docs/development-session-7i.md
docs/managed-uploads.md
docs/session-7i-application-upgrade.md
public/js/uploads.js
src/app.controller.ts
src/common/couchdb.service.ts
src/common/file-visibility.test.ts
src/common/file-visibility.ts
src/common/guards/auth.guard.ts
src/files/files.service.ts
src/files/managed-storage.service.ts
src/files/managed-upload.http.test.ts
src/files/upload.dto.ts
src/files/uploads.controller.ts
src/users/lifecycle.controller.ts
src/users/quota.controller.ts
src/users/users.controller.ts
test/integration/managed-uploads.test.ts
test/persistence/ds920.test.ts
test/persistence/persistence.test.ts
test/tooling/upload-browser.test.cjs
views/sharing.hbs
views/upload-settings.hbs
views/uploads.hbs
```

The three staged .idea blob IDs and SHA-256 checksums remain identical to baseline and excluded from every commit. The unrelated untracked options report remains untouched. No owner documents, local Portal records or production credentials were used.

## Remaining review and manual acceptance

Review the **v2 rollback boundary** before approving deployment. Prior image startup/downgrade after v2 writes is unsupported; a compatible roll-forward or separately approved consistent recovery plan is required. No automatic destructive downgrade is provided. Keeping the old image does not undo new policies/data.

Communicate the changed default and require users to close stale upload tabs/refresh before uploads resume. Old tabs/API clients that omit visibility will create new All members uploads; clients requiring Private must request it explicitly. This approved default change does not modify existing records or retained retries.

Manual checks remain: real-browser checkbox state after refresh/new session, HTML/API navigation on another approved computer, visibility selection and newly approved users, owner/recipient/admin audit behavior, private/selected compatibility, actual attachment filename/bytes and application-only restart on DS920+. Existing downloaded copies and authorized in-flight transfers cannot be recalled. Audit persistence and filesystem writes are not one transaction; durable outbox failures can return 503 after a metadata change and require inspection/retry. See the [app-only upgrade/verification/rollback proposal](session-7i-application-upgrade.md). No deployment, infrastructure/Tailscale changes or destructive production data operation is authorized by this candidate.
