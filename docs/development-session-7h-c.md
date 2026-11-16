# Session 7H-C — eliminate the published HTTP backend

Preparation only. Starting HEAD `f2347b4208a58a1da16e5d2cf8a5402bbb164152`, branch `codex/portal-bsc-r1-fixes`, matched the user-supplied commit. Ending implementation SHA **`7a82f9f496bd4fb86fe4d6ae3aa6714797212517`** passed [CI 43828649267](https://github.com/justinwj/portal-bsc/actions/runs/43828649267). A subsequent documentation-only commit records these completed results and clarifies future backup/install commands; its final HEAD and CI are supplied with the review handoff (a commit cannot embed its own hash). No NAS connection/deployment, live Serve/firewall/credential change, image publication, merge, database/volume/file deletion or bootstrap operation occurred.

Read `AGENTS.md` and `.github/copilot-instructions.md` from `origin/master`. Preserved staged `.idea` files and unrelated `docs/development-session-7c-options.md`. [Starting CI 43800189759](https://github.com/justinwj/portal-bsc/actions/runs/43800189759) completed successfully at the starting SHA: 1008 executions / 675 distinct tests, zero failures, cancellations or skips.

## Baseline and RED/GREEN

Workstation Windows, Node 24.22.1, npm 11.19.1, Docker Desktop engine 29.9.2. CI uses Node 22/npm 10.9.9; production app dependencies and lockfile remain unchanged. Baseline `npm ci`, typecheck, **547 tests** and production build exited 0. npm 11 emitted the inherited bcrypt install-script review diagnostic; installation and tests completed. No dependency upgrade or diagnostic suppression was performed.

1. Wrote `test/tooling/unix-proxy.test.cjs` before configuration implementation. Actual RED: **0 passed / 9 failed**, because the Unix renderer/complete Compose did not exist. Added the restricted transport/configuration candidate, shared only existing canonical-origin validation, and reran: **9 passed / 0 failed**. An intermediate run passed eight and failed one when initial file generation retained `8088:80`; corrected the complete file generation rather than weakening the no-published-port assertion. The fixture compares all three original Nginx mounts plus both unchanged dependency definitions.
2. Version-source review exposed Nginx's explicit 0666 chmod. Disposable **stock Nginx 1.30.5** with umask 077 produced **666** versus required 660, exit **1**. The native launcher pre-binds 0660 and passes an inherited descriptor to the unchanged Nginx binary. Custom image compilation initially failed on a missing `sys/time.h` include; corrected the include and built successfully.
3. Actual local Docker native suite first executed **13 cases: 11 passed / 2 failed**. One test sent duplicate curl Host headers instead of replacing a single forged value; one fixture's startup mkdir failed on restart. Corrected fixture request construction and made fixture directory initialization repeatable. No production assertions were relaxed. Rerun **13/13 passed**, including no TCP listeners, denied unrelated UID, permitted verified group, malformed forwarding rejection, reload, active collision refusal, unsafe filesystem rejection and SIGKILL stale-socket recovery.
4. Local regression after implementation: **556/556 unit/HTTP/tooling**; native container tests **13/13**; typecheck/build exit 0; full/production audits both **zero findings**, exit 0; `npm ls --all` exit 0. Local production app and custom socket Docker builds exited 0. CI subsequently passed all real-service/container/compatibility suites below; these are not live NAS tests.

No application business logic/security control changed. No tests were deleted, skipped or disabled. Refactor shares canonical HTTPS-origin validation, separates the two explicit response modes, and keeps all transport health/recovery logic independent of Portal authorization. Existing TCP-profile tests remain historical regression coverage, not an approved deployment profile.

## Architecture and operations

See [Unix transport deployment and rollback](unix-socket-deployment.md) for version-specific primary sources, options considered, exact future commands, preservation checklist, permissions, downtime, secure rollback and manual NAS gates. Recommended: existing Serve HTTPS -> restricted Unix socket -> existing Nginx -> internal app. Initial three-service placeholder mode requires no app; later app mode preserves streaming/authentication, quotas, sharing and read-only NAS protections.

The new custom Nginx image adds a small static launcher, no extra daemon or npm dependency, and retains the upstream Nginx 1.30.5 executable. The complete Compose removes Nginx publishing without newer merge/reset features, preserving original network, identities, all original binds and CouchDB/Redis settings. Root/Docker administration and socket-authorized host processes remain trusted. Synology package confinement and filesystem ACLs must be verified; no guessed trusted peer IP, package UID or network ID is supplied.

## Completed CI evidence

Inspected every job and its executed summaries in [completed CI 43828649267](https://github.com/justinwj/portal-bsc/actions/runs/43828649267), source `7a82f9f496bd4fb86fe4d6ae3aa6714797212517`:

| Execution group | Passed | Failed | Cancelled | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Linux unit/HTTP/tooling | 556 | 0 | 0 | 0 |
| Real Redis/CouchDB integration | 92 | 0 | 0 | 0 |
| Production Docker/Compose, including Unix tests | 53 | 0 | 0 | 0 |
| Windows tooling | 79 | 0 | 0 | 0 |
| Windows upload/filesystem/sharing/format tests | 263 | 0 | 0 | 0 |
| Docker **24.0.2** native socket re-executions | 13 | 0 | 0 | 0 |
| **Total executions / 701 distinct cases** | **1056** | **0** | **0** | **0** |

All four jobs succeeded. The exact-version job starts a disposable Docker 24.0.2 daemon, checks its actual server version, executes the 13 native socket cases against it, verifies the official Compose **2.20.1** binary checksum and parses the complete production candidate. The vendor-suffixed Synology Compose build/DSM kernel/package confinement remain unverified. No production image is published; only disposable runner artifacts are used.

The 53 container cases include all 36 existing cases, 13 native cases and four new real TLS/Unix/app transition cases. Actual checks include:

- No Docker Nginx PortBindings; connections to Nginx container TCP 80/8088 and CI host TCP 8088 fail with ECONNREFUSED, not an HTTP response. Unix socket mode/owner are 0660/root/verified test group; unrelated UID cannot connect, authorized group can.
- TLS certificate hostname validation, Serve-v1.104.7 Unix Host-rewrite contract, canonical scheme/host/client IP gates and correct persisted login audit IP. A real TLS Nginx frontend models Serve's documented behavior; **no actual Tailscale daemon, tailnet identity or Synology package is enrolled/tested in CI**.
- Actual production NestJS, CouchDB and Redis: Secure/HttpOnly/SameSite cookies, login, role denial, CSRF logout denial/success, Redis session destruction, private metadata denial, exact file bytes, selective sharing/revocation, no direct static NAS-file access. Existing upload/quota/hash/recovery cases remain passing; RO NAS and separate RW managed mounts remain unchanged.
- Nginx-only transport transition leaves CouchDB/Redis container IDs and existing account/audit records unchanged. Their prior recreation/persistence characterization still passes on disposable resources. Reload/restart and SIGKILL stale-socket recovery retain restrictions. Rollback stops only the test app and restores the Unix placeholder without reintroducing TCP or changing retained data.
- Production TypeScript and Docker app builds, socket-image build, full and production npm audits, high/critical production audit gate, dependency validation and whitespace checks passed. Both npm audits report **0 low/moderate/high/critical findings**, exit 0; `npm ls --all` exits 0. No npm package/lockfile/runtime business logic change. This is not an OS/container-image CVE clearance or interactive Rider acceptance.

## Exact changed files

```text
.github/workflows/ci.yml
Dockerfile.nginx-socket
README.md
deploy/ds920/compose.unix.yml
deploy/ds920/nginx.unix.conf.template
deploy/ds920/nginx.unix-proxy-location.conf
deploy/ds920/socket-launcher.c
docs/development-session-7h-c.md
docs/ds920-production-preparation.md
docs/tailscale-deployment-preparation.md
docs/unix-socket-deployment.md
scripts/render-tailscale-proxy.cjs
scripts/render-unix-proxy.cjs
test/persistence/ds920.test.ts
test/persistence/unix-socket.test.ts
test/tooling/unix-proxy.test.cjs
```

The three staged `.idea` blob IDs and SHA-256 checksums remain identical to baseline; they are excluded from both session commits. The unrelated options report remains untracked. Local private fixtures/records and all NAS data remain untouched.

## Remaining approval and manual acceptance

NAS acceptance remains unexecuted by design: actual Serve Unix access under package credentials/ACLs, LAN and tailnet 8088 refusal, no host listener, certificate/user grants, authoritative Container Manager project persistence, NAS boot/restart order, later NestJS deployment. Independent review must approve the custom launcher image and complete replacement Compose before any production action. If Synology socket access fails, stop for architecture review; no TCP fallback or permission broadening is approved. Existing database loopback ports are preserved and require separate actual exposure review; localhost must not be assumed sufficient. Interactive Rider/Office and DSM acceptance are not claimed. Production authentication remains blocked until the actual transport gates pass.
