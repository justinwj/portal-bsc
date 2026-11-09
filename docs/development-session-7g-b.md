# Session 7G-B: managed uploads and selective sharing

Status: B1/B2/B3 implemented and independently verified in GitHub Actions. **474 distinct tests / 627 passing executions; zero failed, cancelled or skipped.** No NAS deployment or interactive Rider acceptance is claimed. Return for independent review before any operational deployment.

Starting SHA: `0e64e21a8b424e1c0e23c8cc849543d4d0d5e751`, branch `codex/portal-bsc-r1-fixes`.

Final verified implementation/test SHA: **`2d60dc39c344c39eda2289286d4a9756188fd0b1`**. This evidence report is published in a documentation-only descendant; the final publication SHA is provided in the handoff, avoiding a self-referential commit hash inside its own content. Runtime code is unchanged by that publication.

| Increment | Commit |
| --- | --- |
| Initial executable RED HTTP cases | `50312a21a34a91efa2faf43ac083cc536a189ef0` |
| B1 reserved streaming pipeline/recovery | `d55950f5c8e79d298273155898c2449e00812796` |
| B2 selective sharing/downloads | `568514a3def7170144200b23634fe9f268cced19` |
| B3 fault coverage, production configuration and operations guide | `0dc6e16283ca59c31f5a96f2f369f6559d5d0e09` |
| Canonical Windows temporary fixture correction | `2d60dc39c344c39eda2289286d4a9756188fd0b1` |

## Baseline and preservation

Read instructions from `origin/master:AGENTS.md` and `.github/copilot-instructions.md`. Preserved the three staged `.idea` additions and unrelated untracked 7C options document. `npm.cmd ci`, `npm.cmd run typecheck`, `npm.cmd test`, and `npm.cmd run build` exited 0. Existing local suite: **235 passed, 0 failed/cancelled/skipped**. Starting-commit [CI 42553155112](https://github.com/justinwj/portal-bsc/actions/runs/42553155112) was queried and completed successfully (351 executions).

## B1 RED

Before any production change, `node --test --test-reporter=tap --require ts-node/register src/files/managed-upload.http.test.ts` executed **24 tests: 0 passed, 24 failed, 0 cancelled/skipped**. Actual missing routes return 404 instead of an upload page (200), policy confirmation (303), quota rejection (409), and accepted intents/streams. Tests exercise actual Nest routes, sessions, CSRF, guards and strict validation, replacing only external CouchDB with a revision-checking temporary store and using isolated real directories.

An initial test compilation error involving fetch's Buffer typing was corrected before this RED execution; a compiler failure is not counted as upload behavior evidence.

## Approved-policy interpretation

Managed files default to private. Administrators require an explicit owner grant, like other approved recipients; no administrator role bypass or self-granted inspection capability is introduced. Sharing and completed downloads are audited. Scheduled Synology scanning is an explicitly accepted risk, not a pre-download gate; every upload remains `not-scanned` by Portal.

Unconfigured existing quotas require an explicit administrator action. The recommended 10 GB/user, 100 GB/global and 1 GB/file are offered for confirmation, never silently written over existing settings. Unsafe storage configuration fails startup; safe configured storage can serve the administration interface while upload admission remains closed pending policy confirmation.

## B1 implementation and refinement evidence

The first 24 HTTP cases became **24/24 GREEN**. A subsequent fault suite executed 36 cases, **31 passed / 5 failed**: cleanup removed a pre-existing promotion collision and staging collision; recovery accepted leftover bytes on aborted records; admission accepted unknown physical staging; expired reservations were not reclaimed. Cleanup now persists device/inode identity before streaming, validates all candidates before unlinking, preserves collision data, blocks unknown leftovers, and expires unused known intents. Retest: **36/36 passed**.

Policy refinement: **39/41 passed, 2 failed** established that explicit recommended-default confirmation could not initialize an absent settings document and per-file overflow returned 400 rather than 413. Corrected without overwriting configured values. Accounting characterization: **46/47 passed, 1 failed**, showing aborted upload journals were counted as used bytes; only verified-aborted journals are now excluded while other states retain charges. Combined targeted suite: **88/88 passed**.

The initial full regression attempt hit two TypeScript entry-point errors because session augmentation was imported only by HTTP tests. An explicit type-only session import corrected that dependency. No failing suite was disabled. Final B1 local verification: `npm.cmd run typecheck`, `npm.cmd run build`, `npm.cmd test` all exited 0; **317 passed, 0 failed/cancelled/skipped**. Docker/real-service verification remains for B3; none is claimed at this point.

Document-family tests use small synthetic ZIP/CFB/database/OneNote signature fixtures. They verify admission rules and macro-container treatment, not interoperability in installed Office applications. Recognized containers are never unpacked or executed. Malformed containers, mismatched Office families, non-macro extensions with VBA parts and disallowed executable add-ins are rejected.

## B2 RED/GREEN

Expanded real HTTP coverage executed **58 tests: 46 passed / 12 failed** before sharing implementation. Failures demonstrated unavailable owner downloads, missing sharing UI/endpoint, recipient validation, selective grants/revocation and account-version invalidation. All setup sharing operations are asserted, so a missing endpoint cannot make a denial test pass vacuously. Existing private-member/admin denial and legacy NAS tests already passed and no artificial RED was added.

GREEN: **58/58 targeted passed**. Full local regression with typecheck and production build: **334 passed, 0 failed/cancelled/skipped**. Managed authorization now uses immutable ownership and selected version-bound recipients, never broad role grants. Sharing updates and upload events persist an outbox with the metadata revision; delivery uses fixed event IDs and clears only after durable acknowledgement. Administrator recipient access requires a pre-disclosure audit; persistence failure rejects access. Legacy role rules remain unchanged. Completed-transfer auditing retains its separately documented post-transfer limitation.

## B3 fault-driven corrections and refactor

All rows describe executed tests before the corresponding correction. HTTP tests are in [managed-upload.http.test.ts](../src/files/managed-upload.http.test.ts), using the real Nest application/session/CSRF/guards/validation and isolated directories; only external persistence is substituted there. Real-service verification is reported separately.

| RED evidence | Cause and GREEN correction |
| --- | --- |
| 58/63 HTTP passed | Corrupt bytes could receive 200; changed storage identity was not rechecked on reads; access labels/feedback and object-budget enforcement were missing. Verify SHA-256 before headers, recheck root/marker and add the missing controls. 63/63 passed. |
| 63/65 HTTP passed | Owner downloads lacked a durable start event; failed policy audit hid a saved-policy outcome. Require pre-transfer audit and explicitly report partial policy commits. 65/65 passed. |
| 65/70 HTTP passed | Private/missing error text differed; ordinary disconnect unnecessarily blocked admission; uncertain close released charges; equal/nested declared host roots were accepted. Unify not-found responses, distinguish verified abort from uncertain handles and compare host roots. 70/70 passed. |
| 76/80 HTTP/accounting passed | Committed/reserved reporting and malformed/aborted-state handling were incomplete; managed path resolution used the legacy root. Separate totals, validate journal states and route managed paths correctly. 80/80 passed. |
| 71/74 expanded HTTP passed | Unexpected missing staging released charges and cleanup lacked a durable unlink checkpoint. Preserve a charged quarantine state and persist `cleanup-pending` before removal. One third failure was a test waiting on the response instead of the later completed-audit signal; the fixture now waits on that actual event. 74/74 passed. |
| 40/41 content tests passed | Valid short filesystem reads were treated as complete buffers. Loop bounded reads until EOF/requested length. 41/41 passed. |
| 77/85 final HTTP/configuration passed | Corrupt/missing/changed payloads did not always close admission; checkout storage, dot-prefixed host overlap and build-context data were insufficiently isolated; repeated ACL mutations could accumulate pending audits; a queued share used a stale commit revision. Close admission on inconsistency, reject checkout roots, correct containment, exclude local uploads from Docker context, drain outbox before another ACL edit and reload current metadata under the coordinator. 85/85 passed. |
| 8/9 actual service tests passed | SIGTERM exited with an active journal still `receiving`. Enable Nest shutdown hooks so managed workers abort/close/clean before exit. 9/9 passed against real Redis/CouchDB. |

Examples retain descriptive names: `refuses a corrupt managed payload before sending successful download headers`, `keeps bytes charged and requires restart after an uncertain file-handle close`, `records cleanup-pending before unlink so a failed final metadata write can recover absent files`, and `serializes a sharing decision queued during upload finalization without a stale audit write`. Assertions were not removed or made permissive.

Refactoring formatted and separated the new storage, DTO, route and content-validation implementations without adding packages. Structural comparison of emitted JavaScript ASTs before/after the readability change matched; this is not a byte-identical-output claim. The full post-refactor suite executed **367/367**, with zero failures/cancellations/skips. Typecheck and clean production build exited 0 again after refactoring.

## Implemented data and transaction model

- Existing four databases remain; storage registration/upload policy live in `portal_users`, schema-v2 managed journals/ACLs in `portal_files`. No existing account/file data migration or bootstrap-policy change.
- Each user-scoped idempotency key derives one stable intent ID. Full declared-byte charge is persisted before exclusive staging creation; device/inode identity is persisted before streaming. Names on disk are opaque UUIDs, never original filename paths.
- Upload state progresses through reserved/receiving/prepared/committed. Verified cleanup persists cleanup-pending, removes/syncs only proven matching partials, then acknowledges aborted before releasing charge. Unknown/colliding/missing/uncertain bytes remain charged and can require reviewed recovery.
- Count/hash bounded streamed bytes, validate the declared document family, sync the file, revalidate live Redis session/account/current quotas, publish without replacement on the same filesystem, persist commit plus audit outbox, verify readback and deliver audit before returning success. Strict CouchDB writes require synchronous 201 acknowledgements; no memory fallback.
- Startup reconciles records, storage identity, directory entries and committed hashes before admission; known pending work is recovered and deterministic outbox events replay. No filesystem/CouchDB atomic transaction or power-loss certification is claimed.
- Existing UsersService coordination now also covers managed reservations, policy decisions, finalization and sharing. This is one app process/single writer, not a distributed lock. Streaming occurs outside the mutation queue.
- Owner/private access and current selected-recipient grants replace role grants only for new managed records. Session-version transitions invalidate recipient/owner grants. Existing role-based legacy downloads and read-only NAS protections are preserved. No administrator bypass, recipient resharing, public link, preview or file deletion.
- All managed downloads require a persisted start event; another owner's administrator access requires a separate pre-disclosure event. Upload/share outboxes have stable IDs. Completed download/history and policy/account audits retain explicitly documented separate-write limitations.

## Formats, quota policy and operational bounds

The **38-extension allowlist** is:

```text
xlsx xls xlsm xlsb xlt xltx xltm xlam
docx doc docm dot dotx dotm
pptx ppt pptm pps ppsx ppsm pot potx potm
accdb mdb vsdx vsdm vsd one onepkg mpp pub msg
txt pdf jpg jpeg png
```

`.xlam` is the explicitly requested macro-based add-in; executable XLL/DLL/COM, scripts, legacy XLA/PPA/PPAM and arbitrary ZIPs remain rejected. ZIP directory/family/header validation is bounded, and legacy containers use practical signatures. It does not prove full document validity or malware safety. All Office bytes are served as attachments without execution/extraction. Password-encrypted OOXML, ZIP64 and unusually large container directories are compatibility limitations requiring manual review, not silently accepted unknown containers.

Recommended setup offers 10,000,000,000 user bytes, 100,000,000,000 global bytes and 1,000,000,000 bytes per file, with explicit administrator confirmation. Existing policies/overrides are preserved. Not configured blocks admission; Unlimited is explicit; integer arithmetic preserves exact boundaries. Finalization rereads changed policies, current sessions and all charges. Each managed file charges its owner/global total once regardless of sharing. Closed/disabled owners' retained data remains charged. SMB/legacy files are outside managed-upload quotas.

Pending intents: 16 global/two per owner; receiving streams: two global/one per owner. Idle/total deadlines are 60 seconds/60 minutes. Known unused intents expire after ten minutes on the next admission. Configurable object budget defaults to 1,000 per owner; durable journal budgets are 10,000 per owner/50,000 total. Exhaustion fails safely and requires review; no automatic permanent record pruning was introduced. Disk free-space headroom and an allowance for outstanding bytes do not reserve capacity against other host writers.

## Real-service, crash and build evidence

Docker was available during this session, unlike earlier sessions. All new local services were disposable and isolated, with test-only credentials and no host-published Redis/CouchDB ports. Test containers used non-root UID/GID 1000:1000. Named data volumes were retained, never deleted.

| Execution | Actual result |
| --- | --- |
| Original real-service suite on disposable Redis 7/CouchDB 3 | 79 passed, zero failed/cancelled/skipped |
| First expanded real-service attempt | 83/86 passed, three crash gates failed because the proxy selected PUT while Nano used POST; corrected only the proxy method matching |
| Managed crash-recovery subset | 7/7 passed after that fixture correction |
| Expanded managed subset initial setup attempt | 0 executed, 9 cancelled by setup: incorrectly supplied deleted-document tombstone revisions; reverted that unnecessary fixture change. This is not counted as application RED or a pass. |
| Managed real-service SIGTERM RED/GREEN | 8/9, then 9/9 after shutdown-hook correction |
| Final complete real-service suite, fresh isolated services, final source | **88 passed, 0 failed/cancelled/skipped**, exit 0 |
| Final local post-refactor unit/HTTP/tooling suite | **367 passed, 0 failed/cancelled/skipped**, exit 0 |
| Final `npm run typecheck`, `npm run build`, `git diff --check` | Each exit 0 |
| Production Docker runtime build | Exit 0; image built locally, not published |
| Actual runtime inspection | Node **22.23.4**, UID/GID **1000:1000**, zero compiled test/spec artifacts; main/seed entrypoints, upload/sharing views and browser asset present |
| Full audit, production-only audit, dependency tree in Node 22 builder | npm **10.9.9**: all three exit 0; **zero vulnerabilities** at every severity, no invalid peers |

Real-service cases cover restart retrieval, selective sharing/revocation, exact competing reservations, macro-enabled opaque bytes, actual Redis session destruction and grant non-resurrection, graceful SIGTERM, and SIGKILL before/after real CouchDB prepared/commit acknowledgements. Fault injection uses an actual HTTP proxy around real CouchDB writes, plus filesystem failure injection in isolated HTTP tests; it does not replace Redis/CouchDB integration with mocks.

The host additionally used Node 24.19.0/npm 11.17.0 for local Windows checks; the supported Node 22/npm 10.9.9 path was separately executed inside Docker and is required in CI. No package manifest/lockfile or dependency version changed; no package was added.

## GitHub Actions verification

First independent run: [42576453952](https://github.com/justinwj/portal-bsc/actions/runs/42576453952), source `0dc6e16283ca59c31f5a96f2f369f6559d5d0e09`. Linux **367/367** unit/HTTP/tooling and **88/88** real-service tests passed; production image/Compose **19/19** passed, including actual non-root managed writes, retained read-only NAS access and restart/recreation persistence. Both audits and peer validation passed in the Linux job.

The run correctly failed on Windows: tooling **32/32** passed, but upload/content execution was **41 passed / 80 failed**, zero cancelled/skipped. Every HTTP case failed its setup at the strict canonical-root check; content-family cases passed. The temporary test root was not canonicalized before configuration. Corrected only the fixture to resolve the actual temporary directory before use and log any disposable-path normalization; production symlink rejection remains unchanged. Local retest **121/121** passed. The successful rerun's diagnostics confirmed Windows expanded `C:\Users\RUNNER~1` into `C:\Users\runneradmin`; this was a disposable fixture alias, not a reason to permit symlink roots.

Final completed implementation run: [42576878840](https://github.com/justinwj/portal-bsc/actions/runs/42576878840), SHA `2d60dc39c344c39eda2289286d4a9756188fd0b1`. Inspected every job's steps and test/audit summaries:

| Executed suite | Passed | Failed | Cancelled | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Linux full unit/HTTP/tooling | 367 | 0 | 0 | 0 |
| Real Redis/CouchDB integration | 88 | 0 | 0 | 0 |
| Production Docker/Compose persistence/startup | 19 | 0 | 0 | 0 |
| Additional Windows tooling executions | 32 | 0 | 0 | 0 |
| Additional Windows managed HTTP/content executions | 121 | 0 | 0 | 0 |
| **Total executions** | **627** | **0** | **0** | **0** |

The first three rows cover **474 distinct cases**; Windows repeats 153 of those. The initial baseline was 328 distinct/351 executions. Added 146 distinct cases: 80 managed HTTP, 41 content validation, two accounting, nine browser/configuration tooling, nine real-service and five container cases. Existing cases remain enabled.

All jobs completed successfully. Typecheck/production build passed on Linux and Windows. The production image built, started, bootstrapped the disposable administrator and served real managed/legacy downloads; retained payloads, hashes, ownership and policy survived actual restarts and container recreation. The existing production high/critical gate passed. Full/production audits reported **0 critical, 0 high, 0 moderate, 0 low**, and `npm ls --all` exited 0 on Linux and Windows. No package/override changes or advisory exceptions were introduced.

## Exact changed files

Relative to the starting commit, the session changes only:

```text
.dockerignore
.env.example
.github/workflows/ci.yml
Dockerfile
README.md
docker-compose.app.yml
docker-compose.uploads.yml
docs/account-lifecycle.md
docs/capacity-and-quotas.md
docs/development-session-7g-b.md
docs/development-session-7g-design.md
docs/ds925-production-readiness.md
docs/managed-uploads.md
public/js/uploads.js
src/app.controller.ts
src/app.module.ts
src/audit/audit.service.ts
src/common/couchdb.service.ts
src/common/quota-policy.test.ts
src/common/quota-policy.ts
src/files/files.controller.ts
src/files/files.service.ts
src/files/managed-storage.service.ts
src/files/managed-upload.http.test.ts
src/files/upload-types.test.ts
src/files/upload-types.ts
src/files/upload.dto.ts
src/files/uploads.controller.ts
src/main.ts
src/users/quota.service.ts
src/users/users.service.ts
test/fixtures/documents.ts
test/integration/managed-uploads.test.ts
test/integration/support.ts
test/persistence/persistence.test.ts
test/tooling/managed-storage-config.test.cjs
test/tooling/upload-browser.test.cjs
views/admin-settings.hbs
views/file-detail.hbs
views/files.hbs
views/layouts/main.hbs
views/sharing.hbs
views/upload-settings.hbs
views/uploads.hbs
```

These are **44 files**, checked against the actual starting-to-final Git diff. The staged `.idea/.gitignore`, `.idea/encodings.xml`, `.idea/indexLayout.xml` and unrelated untracked `docs/development-session-7c-options.md` are excluded. Original `.idea` file hashes and staged blob IDs were verified unchanged. No existing local user records, production credentials or NAS files were altered; no volume was deleted or image published. Only positively identified disposable fixture metadata/partial files were cleaned by tests.

Local session-owned Redis/CouchDB containers were stopped after verification. Eight test data volumes remain intentionally retained (prefixes `portal-7gb-couch[-full|-crash|-final]-data-*` and corresponding Redis names); no `down -v`, volume deletion or prune operation was used. GitHub's disposable Compose cleanup also verifies that its named database volume remains after `down`.

## Remaining risks and manual acceptance

- [Managed uploads, sharing and recovery](managed-uploads.md) contains the exact administrator/user flow, DSM provisioning and ACL checks, scheduled Antivirus Essential installation/folder/schedule verification, existing backup coverage and isolated restore checklist, and Windows/Rider/browser acceptance steps.
- Scheduled Smart Scan is the owner's accepted R1 policy, **not** pre-download scanning. Portal never labels content clean. Files larger than **2,048 MB** are outside Antivirus Essential's documented scan limit; initial 1 GB maximum is below that limit. Confirm extensionless objects are scanned. If AV quarantines/moves a committed object, logical charges remain and Portal fails closed until reviewed recovery. No AV service or NAS job was added.
- No real NAS, DSM ACL/Compose version, antivirus installation/schedule, backup restore, Office application interoperability, interactive Rider, visual or accessibility acceptance was performed. No deployment readiness claim substitutes for those checks. Client macro safety remains the recipient's responsibility.
- Power failure/physical disk durability is not certified. One 20 TB SHR HDD provides persistence, not redundant drive protection. Full hash checks can delay startup/downloads on modest hardware; measure before expanding storage/concurrency.
- Unknown/missing/colliding physical data, inode changes on a restored pending upload, uncertain handle closure and unsupported old managed provenance require explicit operator review. No automatic adoption, policy reset, irreversible disposition or distributed coordination was introduced.
- A shared recipient cannot redistribute a grant through Portal, but can copy downloaded bytes. Revocation applies to subsequent requests, not already downloaded copies/in-flight streams. Safe percent-encoded attachment names need actual browser review for non-ASCII usability.
- The sample reverse proxy needs an explicit reviewed body-size/timeout/buffering configuration for the selected upload maximum. No existing production proxy or NAS configuration was changed.

Stop after completed CI and independent review. No merge, NAS deployment, image publication, cloud/SMTP service, permanent account/file deletion or later development phase is authorized here.
