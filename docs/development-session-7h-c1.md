# Session 7H-C1 — database publication removal and deployment reconciliation

**Repository corrections/testing only.** Starting HEAD `b552cdf78b2e412ff59de8edffb4542459c9817a` matched the expected commit on `codex/portal-bsc-r1-fixes`. Final implementation SHA **`4ce3a11a572cf2183bd7a11f21c3fccedea013c9`** passed [CI 44855315067](https://github.com/justinwj/portal-bsc/actions/runs/44855315067). The subsequent evidence-only commit records this completed run and clarifies manual readiness; its final branch SHA/CI are supplied in the review handoff because a commit cannot embed its own hash. Codex did not connect to either NAS, modify Serve/firewall/credentials, deploy/start NestJS on a NAS, recreate production containers, change persistent production data, publish an image or merge a branch.

Read `AGENTS.md` and `.github/copilot-instructions.md` from `origin/master`. Preserved all staged `.idea` additions and unrelated `docs/development-session-7c-options.md`. App business logic, npm manifests/lockfile, database authentication, Redis policy and Unix launcher/permissions are unchanged.

## Owner-supplied production evidence — November 20, 2026

Justin verified DS920+ DSM 7.4.1-90080 Update 1, Container Manager 24.0.2-1707, Docker 24.0.2, Compose 2.20.1 and Tailscale 1.104.7. Project `portal` uses `/volume1/docker/portal/compose.yaml` and existing network `portal_default`, shared by portal-nginx, portal-couchdb and portal-redis.

Before correction, remote TCP tests reached 8088/5984/6379 despite database loopback bindings. The owner removed database publications and recreated only those affected containers. Database PortBindings now report `{}`; remote 5984/6379 tests are False, CouchDB readiness is `{"seeds":{},"status":"ok"}` and Redis returns PONG. **8088 remains True. The live Nginx HTTP problem is unresolved; production authentication is prohibited until the separately approved Unix migration and actual denial verification succeed.** These are supplied observations, not Codex NAS tests.

## Baseline and RED → GREEN evidence

Workstation: Windows, Node 24.22.1, npm 11.19.1, Docker Desktop engine 29.9.3 and Compose 5.7.0. Completed CI used Node **22.23.5**/npm **10.9.9** and independently exercised Docker 24.0.2/Compose 2.20.1. Before changes, `npm ci`, typecheck, **556 local unit/HTTP/tooling tests** and production TypeScript build exited 0. Verified [starting CI 43829707734](https://github.com/justinwj/portal-bsc/actions/runs/43829707734) succeeded at the starting SHA: 1056 executions / 701 distinct cases, zero failures/cancellations/skips.

1. Added `test/persistence/compose-isolation.test.ts` before deployment configuration changes. Each case invokes actual `docker compose ... config --format json`, never just text search. **RED: 11 executed, 5 passed / 6 failed**, exit 1. Current database publications failed individual/combined/preservation checks and contaminated two merge-negative cases. The already-correct app overlay/network assertions were not made artificially failing.
2. Updated the existing Unix preservation test to require absent database publications and preserve **every other** database field. Ran before the configuration correction: **9 executed, 8 passed / 1 failed**, exit 1. This replaces the obsolete expectation that localhost publications should be preserved, without removing any mount/authentication/Redis assertions.
3. Removed only the CouchDB and Redis `ports` declarations from the approved Unix base. **GREEN: 11/11 normalized cases and 9/9 Unix-proxy cases**, both exit 0. No replacement loopback/alternate port, host networking, new network or named data volume.
4. Local regression: **556/556**, zero failures/cancellations/skips; typecheck and production build exit 0. Full and production npm audits report zero findings, exit 0; `npm ls --all` exits 0. Targeted existing deployment/Unix tooling: **18/18**, exit 0.
5. [First CI 44854840332](https://github.com/justinwj/portal-bsc/actions/runs/44854840332), source `c5dfefdcb687affe838283cdf9b2fcf3f1a0b0f4`: normalized compatibility, unit/HTTP, real-service and Windows jobs passed. Container suite executed **65: 64 passed / 1 failed**, zero cancellations/skips. The new case reached login after an HTTP-200 readiness check but had no Set-Cookie. That check could accept the still-active placeholder during the Nginx reload; HTTP 200 alone does not establish application readiness. Strengthened the wait to require the actual JSON health payload, valid status/timestamp and JSON content type. All login/cookie/session/authorization assertions remain; no production configuration or application behavior was changed to accommodate the fixture. [Corrected CI 44855315067](https://github.com/justinwj/portal-bsc/actions/runs/44855315067) passed **65/65 container tests** and every other job. The operations guide now explains the same readiness distinction.

## Effective Compose and preservation

Normalized approved base: nginx/couchdb/redis have no ports. Normalized approved base plus app: all four have no ports or alternate network mode; only `default` exists and resolves to `portal_default` for project `portal`. App URLs remain `http://couchdb:5984` and `redis://redis:6379`; these are internal container endpoints, not published host ports. No storage volume substitution occurs.

| Service | Normalized host publications | Internal access |
| --- | --- | --- |
| nginx | None | Restricted Unix socket only |
| couchdb | None | couchdb:5984 on existing default network |
| redis | None | redis:6379 on existing default network |
| app | None | app:3000 on existing default network |

The 11-case suite also parses the rejected original-base/app combination and controlled overrides reintroducing 8088, 5984 or 6379. Compose correctly retains such unsafe publications; the regression assertion rejects them. **Arbitrary additional Compose files can publish ports; this cannot be prevented by an empty list in the approved base.** Only the reviewed Unix base and app overlay are allowed. Normalize the exact operator file list privately before deployment and inspect every service, without logging expanded secrets.

Preserved fields include service/container identities, every CouchDB data/config bind, authentication environment, image/restart settings, Redis exact `--save "" --appendonly no` command, original Nginx config/legacy/log binds, restricted socket bind/health check, non-root app/storage policy and default-network behavior.

## Refactoring and documentation

Centralized the normalized no-publication assertion in the new suite and reused it in the Docker24/Compose2.20.1 CI job for base, overlay and merge-negative cases. Retained every existing test; marked historical TCP cases as rejected-profile characterization. No application behavior or dependency replacement.

Corrected the app overlay and environment comments to require only the complete Unix base. Marked the old infrastructure file as an unsafe historical fixture, not a deployment/rollback base. Removed obsolete operational instructions that suggested restoring TCP or combining the app with the original project. Updated guides record owner evidence, internal connectivity, network preservation and the remaining Nginx gate. The safe fallback retains the Unix placeholder and zero publications for all services; if that is unavailable, stop Nginx and use independent management rather than reopening ports. Retain stored data, authentication, audits, managed files and existing backup arrangements.

## Files modified

```text
.github/workflows/ci.yml
README.md
deploy/ds920/.env.example
deploy/ds920/compose.app.yml
deploy/ds920/compose.infrastructure.yml
deploy/ds920/compose.unix.yml
docs/development-session-7h-c1.md
docs/ds920-existing-configuration-review.md
docs/ds920-production-preparation.md
docs/tailscale-deployment-preparation.md
docs/unix-socket-deployment.md
test/persistence/compose-isolation.test.ts
test/persistence/ds920.test.ts
test/tooling/unix-proxy.test.cjs
```

## Completed verification

Inspected all four jobs and executed summaries in [CI 44855315067](https://github.com/justinwj/portal-bsc/actions/runs/44855315067) at the final implementation SHA. All jobs succeeded:

| Suite | Passed | Failed | Cancelled | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Linux unit/HTTP/tooling | 556 | 0 | 0 | 0 |
| Real Redis/CouchDB integration | 92 | 0 | 0 | 0 |
| Production Docker/Compose/persistence | 65 | 0 | 0 | 0 |
| Windows tooling | 79 | 0 | 0 | 0 |
| Windows upload/filesystem/sharing/formats | 263 | 0 | 0 | 0 |
| Docker24 native socket tests | 13 | 0 | 0 | 0 |
| Compose2.20.1 normalized configuration re-executions | 11 | 0 | 0 | 0 |
| **Total executions / 713 distinct cases** | **1079** | **0** | **0** | **0** |

Twelve new distinct cases: eleven normalized-configuration cases plus one actual internal-connectivity/rollback case. The eleven normalization cases also execute under the exact-version compatibility job. All previously passing tests remain enabled.

The real-container case removed only the disposable CouchDB diagnostic publication and recreated that test database, retaining its bind-backed records. The production app started with internal URLs, authenticated to CouchDB, read the existing user/audit records, performed Redis PING/SET/GET, persisted a login session across requests and downloaded the retained private bytes. Normalized and actual Docker inspections showed empty publications for nginx/couchdb/redis/app before rollback and afterward. Redis/Nginx were not recreated for database isolation; rollback preserved database IDs, credentials and data. The test-only TLS frontend has its own disposable listener and is not a fifth production service. No production records or NAS paths are instantiated.

Compatibility job: checked actual Docker server **24.0.2**, passed all 13 native socket tests against it, checksum-verified the official Compose **2.20.1** binary and passed all 11 normalization/merge checks under that client. Full real-service/production-app connectivity is exercised by the separate Docker job; the exact-version job does not claim a complete Synology application deployment. Vendor DSM kernel, package confinement and live network identity still need NAS acceptance.

Production TypeScript and both production Docker image builds (app and restricted Nginx) passed. Full and production npm audits, including the critical/high production gate, reported **zero known npm vulnerabilities** and exit 0. `npm ls --all` and `git diff --check` exited 0. Runtime dependencies and lockfile are unchanged; this is not an OS/image CVE clearance. No tests were skipped, disabled, deleted or weakened to obtain green.

The three staged `.idea` blob IDs and SHA-256 checksums remain identical to baseline and excluded from every session commit. Unrelated untracked work remains untouched.

## Remaining live Synology gates

Remaining NAS gates: independent review, controlled Nginx Unix migration, package UID/GID/ACL socket access, actual empty bindings and LAN/tailnet 8088 denial, retained database 5984/6379 denial, existing network ID, canonical HTTPS/certificate/proxy trust, restart persistence, later separately authorized app deployment and application acceptance. No interactive Rider or live NAS acceptance is claimed.
