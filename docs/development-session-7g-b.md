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
