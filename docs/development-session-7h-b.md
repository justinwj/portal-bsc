# Session 7H-B — Tailscale HTTPS deployment preparation

**Preparation only; no NAS access or deployment.** No containers on a NAS were started/restarted, no image published, no rule/certificate/firewall/DNS/credential changed, no volumes/data removed, and no branch merged. DS920+ remains primary. DS925+ offsite backup/DR is R2. Actual NAS compatibility and live access acceptance remain gated as described below.

## Repository and baseline

Requested starting SHA: `287677e89d1599198d9729d15d6a571d6819261b`. Actual preserved HEAD: `6164479e6de56e07e1927cce720f5bb338c1999c`, its single previously authorized documentation-only descendant recording Justin's empty DSM reverse-proxy list. No reset/overwrite was performed. Branch: `codex/portal-bsc-r1-fixes` only. Read `AGENTS.md` and Copilot instructions from `origin/master`.

Preserved the three staged `.idea` additions and their blob IDs/hashes, ignored Rider metadata, unrelated untracked `docs/development-session-7c-options.md`, existing local records and private sample volumes/files. No production credentials were read or committed.

Workstation baseline: Windows, Node `24.22.1`, npm `11.19.1`, Docker `29.9.2`; CI/production remain Node **22**, CI npm **10.9.9**. `npm ci`, typecheck, **520 local tests**, and production TypeScript build exited 0 before implementation. [Starting CI 43791642665](https://github.com/justinwj/portal-bsc/actions/runs/43791642665) had passed all three jobs: **948 executions / 642 distinct cases**, zero failures/cancellations/skips.

## Feasibility and authorization limits

Reviewed official [Synology integration](https://tailscale.com/docs/integrations/synology), [Serve CLI](https://tailscale.com/docs/reference/tailscale-cli/serve), [HTTPS](https://tailscale.com/docs/how-to/set-up-https-certificates), [sharing](https://tailscale.com/docs/features/sharing), [grants](https://tailscale.com/docs/features/access-control/grants/grants-explained) and [current Serve proxy source](https://github.com/tailscale/tailscale/blob/main/ipn/ipnlocal/serve.go). These support a conditional preparation design, not a claim that the installed Synology build supports it. The official Synology guide's outdated/unsupported Package Center warning makes package source/version review material. No automatic package maintenance is performed.

Because NAS connections are prohibited, installed DSM/Tailscale versions and `serve --help` were requested from Justin. **No such outputs have been supplied during this preparation.** Therefore actual Serve feasibility and selection of a NAS command remain **unverified/blocked on owner-provided inspection**. The [operations guide](tailscale-deployment-preparation.md) provides exact **conditional modern-CLI candidates**, with an explicit STOP gate before any use, and a fallback requiring separate architecture approval if Serve proves unsuitable. No Linux command is assumed supported on the NAS.

Actual hostname, certificate issuance/state, network ID, trusted peer, firewall effect and tailnet policy are unknown. All test domains, addresses, accounts and certificates are explicitly synthetic. No actual `*.ts.net` hostname, proxy address or certificate state is invented.

## Prepared behavior

- New unselected Nginx template, rendered offline from canonical `PORTAL_PUBLIC_ORIGIN` and exact observed peer IPs. No hostname is added to app logic; changing domains is configuration-only, while a non-tailnet domain would need separately reviewed TLS-provider support.
- Existing Nginx container/config bind/logs/8088:80 and all CouchDB/Redis identities, commands, persistence and network remain unchanged. No new Nginx mount, app publication, DSM rule, Funnel or public forwarding. Actual backend isolation remains mandatory before applying trust.
- The proxy requires exact trusted peer, verified HTTPS metadata, canonical Host/forwarded Host, one valid normalized client IP and no Funnel marker. It strips raw forwarding/identity/capability headers before the existing Portal trust boundary. It preserves streaming/pooling/DNS, cookie/CSRF controls and independent Portal account approval/authorization. Network identity never grants Portal membership or admin rights.
- Dependency-free renderer rejects invalid/control-character origins and broad/malformed peers; optional UTF-8 exclusive output avoids PowerShell encoding and overwriting existing files. It has no remote or deployment operation.
- Placeholder-only sharing policy fragment grants explicit users only the named NAS's HTTPS service, with denial assertions for backend/DSM/database/owner-computer paths. Local tests only inspect structure. Actual tailnet policy-engine validation, merged broad-rule review, sharing and remote connections are **not executed**.
- Operations/acceptance documentation covers the four owner computers, separate external accounts, NAS-only sharing, full FQDN, revocation, manual access matrix, certificate/privacy checks, version-gated commands, startup/background persistence, proxy-source observation, backup and scoped rollback. No new cloud application integration or dependency is added.

## RED → GREEN → REFACTOR evidence

1. `test/tooling/tailscale-proxy.test.cjs` executed **23 cases, 0 passed / 23 failed** before renderer/template implementation. Cases cover canonical configuration, future-domain configuration, exact IPv4/IPv6 peers, malformed/missing settings, safe header gates and empty output on failure. Implemented the minimal renderer/template: **23/23 GREEN**.
2. Additional control-character and policy cases executed **25 cases, 23 passed / 2 failed**: URL parsing normalized an embedded control character, and the policy fragment did not exist. Rejecting controls and adding the fragment produced GREEN after correcting a test helper's assumption that every policy test contains a `deny` array. Required denial assertions remained; **25/25 passed**.
3. Windows-safe output tests executed **27 cases, 25 passed / 2 failed** before output support. Added `--output` with UTF-8, exclusive creation and no stdout output. **27/27 passed**; an existing file remains byte-identical and no partial config is emitted on validation failure.
4. [First CI 43798026861](https://github.com/justinwj/portal-bsc/actions/runs/43798026861), source `6a2887e`, executed the real container suite **35 cases: 34 passed / 1 failed**. All new proxy-chain security cases passed, but the restart case timed out. Docker reassigns the fixture's requested ephemeral published port on restart; the test was still using the old port. Redis/data/auth/template were not weakened. Rediscovering the temporary port fixed that fixture; [CI 43798777520](https://github.com/justinwj/portal-bsc/actions/runs/43798777520), source `9b44dc6`, passed **35/35 container cases**.
5. Added actual upload/hash/private-access/quota characterization through the proxy contract. [CI 43799099389](https://github.com/justinwj/portal-bsc/actions/runs/43799099389), source `56174b1e3e44e4d6b26def5e33ef1be143565487`, passed **36/36 container cases** and all other suites. No artificial RED was added to already-correct application behavior.

Refactor gives origin cases unique names, keeps rendering local/dependency-free and reuses real fixtures/session helpers. No assertions, tests or security controls were removed/disabled. App business logic and production dependency manifests/lockfile are unchanged.

## Actual automated verification

Inspected all jobs and executed summaries for source `56174b1e3e44e4d6b26def5e33ef1be143565487` in [CI 43799099389](https://github.com/justinwj/portal-bsc/actions/runs/43799099389):

| Suite | Passed | Failed | Cancelled | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Linux complete unit/HTTP/tooling | 547 | 0 | 0 | 0 |
| Real Redis/CouchDB integration | 92 | 0 | 0 | 0 |
| Docker/Compose/container | 36 | 0 | 0 | 0 |
| Additional Windows tooling/configuration | 70 | 0 | 0 | 0 |
| Additional Windows upload/format | 263 | 0 | 0 | 0 |
| **Total executions** | **1008** | **0** | **0** | **0** |

**675 distinct cases**, with 333 additional Windows executions. The session adds 27 tooling cases and six real container proxy-contract cases. The complete existing account lifecycle, administrator bootstrap, sessions, filesystem, upload/quota and persistence suites remain enabled. Real services and production Docker build executed on disposable GitHub resources; no NAS was used. Production TypeScript builds, full/production security audits and dependency validation passed in CI. Final local regression after refactoring: **547 passed, zero failed/cancelled/skipped**; typecheck, production build, both audits and `npm ls --all` exited 0. **Zero critical/high/moderate/low npm findings**, no dependency upgrades or exceptions. `git diff --check` passed.

The new container tests use actual TLS with a trusted synthetic CA/SAN, two real Nginx proxies, production Nest routes/middleware, Redis sessions, CouchDB audits and temporary managed storage. They verify valid/invalid certificate hostname, Secure/HttpOnly/SameSite cookies, CSRF logout/session destruction, member/admin guards, private/shared/revoked downloads, status/session revocation, byte/hash/quota-preserving upload, normalized audited client IP, hostile direct-host/container traffic, malformed forwarding, Funnel marker denial and proxy/app restart recovery. They preserve the original Nginx container ID. The front proxy **models the reviewed Serve header contract**; it is not a running Tailscale daemon or proof of Tailscale user authorization.

## Exact changed files

- `scripts/render-tailscale-proxy.cjs`
- `deploy/ds920/nginx.tailscale.conf.template`
- `deploy/ds920/tailscale.env.example`
- `deploy/ds920/tailscale-policy.json.example`
- `test/tooling/tailscale-proxy.test.cjs`
- `test/persistence/ds920.test.ts`
- `docs/tailscale-deployment-preparation.md`
- `docs/development-session-7h-b.md`
- `README.md`
- `docs/ds920-existing-configuration-review.md`
- `docs/ds920-production-preparation.md`
- `docs/ds925-production-readiness.md`
- `docs/development-session-7h-a.md`

Final publication SHA is provided in the handoff, avoiding a self-referential hash. The source/configuration verified above is unchanged by documentation publication and test-title refactoring; its publication workflow is checked before handoff.

## Unexecuted acceptance and remaining blockers

Installed NAS compatibility/version/help, real Serve command, HTTPS enablement/certificate issuance/renewal, live firewall isolation and source/header observation, actual tailnet policy validation/sharing/revocation, owner LAN/other-location/Zenbook/external-user checks, public/non-tailnet reachability tests, physical NAS reboot, DSM/AV/backup/restore and interactive Rider/native Office/CAD checks were **not performed**. Their manual acceptance procedures are in the operations guide. No owner credentials, tailnet auth keys or actual network values were available or requested for CI.

Do not claim Tailscale network clearance, Synology compatibility or production deployment readiness from these proxy-contract tests. If backend isolation cannot be proven while preserving the approved infrastructure, or Serve is unsupported, stop for a reviewed maintenance/architecture decision. Never widen proxy trust, silently rebind/recreate Nginx, disable cookie security or substitute Funnel/another service to obtain access. Return for independent review; no deployment or further phase is authorized by this report.
