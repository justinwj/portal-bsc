# Session 7H-C1 — database publication removal and deployment reconciliation

**Repository corrections/testing only.** Starting HEAD `b552cdf78b2e412ff59de8edffb4542459c9817a` matched the expected commit on `codex/portal-bsc-r1-fixes`. Final source/evidence commits and completed CI results will be recorded after verification. Codex did not connect to either NAS, modify Serve/firewall/credentials, deploy/start NestJS on a NAS, recreate production containers, change persistent production data, publish an image or merge a branch.

Read `AGENTS.md` and `.github/copilot-instructions.md` from `origin/master`. Preserved all staged `.idea` additions and unrelated `docs/development-session-7c-options.md`. App business logic, npm manifests/lockfile, database authentication, Redis policy and Unix launcher/permissions are unchanged.

## Owner-supplied production evidence — November 20, 2026

Justin verified DS920+ DSM 7.4.1-90080 Update 1, Container Manager 24.0.2-1707, Docker 24.0.2, Compose 2.20.1 and Tailscale 1.104.7. Project `portal` uses `/volume1/docker/portal/compose.yaml` and existing network `portal_default`, shared by portal-nginx, portal-couchdb and portal-redis.

Before correction, remote TCP tests reached 8088/5984/6379 despite database loopback bindings. The owner removed database publications and recreated only those affected containers. Database PortBindings now report `{}`; remote 5984/6379 tests are False, CouchDB readiness is `{"seeds":{},"status":"ok"}` and Redis returns PONG. **8088 remains True. The live Nginx HTTP problem is unresolved; production authentication is prohibited until the separately approved Unix migration and actual denial verification succeed.** These are supplied observations, not Codex NAS tests.

## Baseline and RED → GREEN evidence

Workstation: Windows, Node 24.22.1, npm 11.19.1, Docker Desktop engine 29.9.3 and Compose 5.7.0. CI retains Node 22/npm 10.9.9 and independently exercises Docker 24.0.2/Compose 2.20.1. Before changes, `npm ci`, typecheck, **556 local unit/HTTP/tooling tests** and production TypeScript build exited 0.

1. Added `test/persistence/compose-isolation.test.ts` before deployment configuration changes. Each case invokes actual `docker compose ... config --format json`, never just text search. **RED: 11 executed, 5 passed / 6 failed**, exit 1. Current database publications failed individual/combined/preservation checks and contaminated two merge-negative cases. The already-correct app overlay/network assertions were not made artificially failing.
2. Updated the existing Unix preservation test to require absent database publications and preserve **every other** database field. Ran before the configuration correction: **9 executed, 8 passed / 1 failed**, exit 1. This replaces the obsolete expectation that localhost publications should be preserved, without removing any mount/authentication/Redis assertions.
3. Removed only the CouchDB and Redis `ports` declarations from the approved Unix base. **GREEN: 11/11 normalized cases and 9/9 Unix-proxy cases**, both exit 0. No replacement loopback/alternate port, host networking, new network or named data volume.
4. Local regression: **556/556**, zero failures/cancellations/skips; typecheck and production build exit 0. Full and production npm audits report zero findings, exit 0; `npm ls --all` exits 0. Real services, container tests and exact-version compatibility results pending at this source checkpoint.

## Effective Compose and preservation

Normalized approved base: nginx/couchdb/redis have no ports. Normalized approved base plus app: all four have no ports or alternate network mode; only `default` exists and resolves to `portal_default` for project `portal`. App URLs remain `http://couchdb:5984` and `redis://redis:6379`; these are internal container endpoints, not published host ports. No storage volume substitution occurs.

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

## Verification still to record

Full real-service/container/Windows CI, normalized configuration under exact Docker24/Compose2.20.1, production Docker builds and final CI links/counts pending. The added real-container case removes the disposable CouchDB diagnostic publication, restarts only that test database, starts the production app with internal URLs and checks authenticated CouchDB reads, Redis PING/SET/GET and session persistence, retained private download bytes, and actual empty bindings for all four services. No production record is used.

Remaining NAS gates: independent review, controlled Nginx Unix migration, package UID/GID/ACL socket access, actual empty bindings and LAN/tailnet 8088 denial, retained database 5984/6379 denial, existing network ID, canonical HTTPS/certificate/proxy trust, restart persistence, later separately authorized app deployment and application acceptance. No interactive Rider or live NAS acceptance is claimed.
