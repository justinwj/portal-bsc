# Session 7G-B: managed uploads and selective sharing

Status: implementation in progress. No NAS deployment or interactive Rider acceptance is claimed.

Starting SHA: `0e64e21a8b424e1c0e23c8cc849543d4d0d5e751`, branch `codex/portal-bsc-r1-fixes`.

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
