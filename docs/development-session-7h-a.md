# Session 7H-A — DS920+ production deployment preparation

**Updated after the supplied original configuration:** see the [reconciliation review](ds920-existing-configuration-review.md) and follow-up below. The initial missing-YAML/external-network/TLS-only assumptions in the historical evidence are superseded. Current preparation preserves `8088:80`, inherits the original default network and leaves HTTPS/DSM trust undecided. No NAS was accessed.

**Latest owner inspection:** Justin has confirmed that DSM's Reverse Proxy list on `jwj_NAS_1` is empty. No Portal hostname, HTTPS source/destination, certificate assignment or trusted proxy address is configured. DSM HTTPS termination to the existing HTTP backend on 8088 is the owner-preferred option to evaluate. HTTPS, enforceable backend restrictions, observed trusted-source/header behavior and certificate management remain outstanding; no rule or trust behavior has been implemented.

Preparation/testing only. No connection to `jwj_NAS_1`, DS920+, DS925+, their file shares, databases or management interfaces. No image transfer, deployment, container replacement on a NAS, image publication, credential rotation, merge or backup-task configuration occurred. Session 7H-B remains separately gated.

## Starting state and baseline

- Branch: `codex/portal-bsc-r1-fixes`.
- Starting SHA: `a024aa380169fb71a9aca0ab8692002035d09845`.
- Final verified configuration/test SHA: `08ab97b606d1a47bdb941c72a88f0910585798f2`. This report and the operator documents are published in a documentation/template-only descendant; its exact publication SHA is supplied in the final handoff, avoiding a self-referential hash inside its own content.
- Read `AGENTS.md` and `.github/copilot-instructions.md` from fetched `origin/master`; reviewed Dockerfile, all repository Compose files, Nginx snippet, Sessions 7G-B/C1 and managed-upload operations documentation.
- Preserved staged `.idea/.gitignore`, `.idea/encodings.xml`, `.idea/indexLayout.xml` (same staged blobs and SHA-256), unrelated untracked `docs/development-session-7c-options.md`, local records and private test documents.
- Workstation: Windows, Node `24.22.1`, npm `11.19.1`, Docker Engine `29.9.2`, Compose `5.6.1`. Supported production/CI runtime remains Node **22**; inspected CI reported Node `22.23.4`, npm `10.9.9`. A local built runtime executed `v22.23.5`, including a successful Compose invocation by its full immutable image ID with `pull_policy: never`. No package or lockfile change was made.
- Baseline `npm ci`, `npm run typecheck`, `npm test`, `npm run build`: exit 0. **511 local tests passed, zero failed/cancelled/skipped**. No production code changed during baseline verification.
- Starting [CI 43768715291](https://github.com/justinwj/portal-bsc/actions/runs/43768715291) completed successfully: 511 Linux unit/HTTP/tooling, 92 real-service, 20 Compose/container, 34 Windows tooling repeats and 263 Windows upload/format repeats: **920 executions / 623 distinct tests**. Production Docker, builds, audits and dependency validation passed.

## Deployment proposal and preservation boundary

The generic repository Compose defines a named CouchDB volume. Applying that definition to the existing populated NAS would be unsafe. The new app-only Compose addition inherits the original three services without redefining CouchDB/Redis or any existing persistence. It explicitly references a verified existing external network, immutable locally loaded image, separate protected environment values, non-root app UID/GID and two pre-existing bind paths. Legacy is read-only; managed storage is separately writable. Both reject automatic host-path creation. No app host port, NAS build, image pull or automatic administrator bootstrap is configured.

The complete Nginx main-config candidate provides TLS and an application-only proxy route, forwarding-header replacement, a decimal 1 GB body ceiling and streaming transfers without retrying writes. No static NAS route exists. The current Nginx NAS mount is unnecessary for this candidate, but removal from the actual project still requires inspecting the original YAML. Log paths/permissions and TLS/host-port mappings must be reconciled with that original definition.

The original NAS YAML/nginx.conf were **not supplied or present in this repository**. They were requested, along with DSM reverse-proxy topology. Consequently this is a tested **candidate**, not a claim that the exact production merged configuration, current CouchDB credential or installed Synology Compose version has been reviewed. Existing paths/project/container facts are user-reported. No administrator account or actual credential was accessed or changed.

## RED → GREEN evidence

`test/tooling/ds920-deployment.test.cjs` was written before the deployment files. Initial execution exited 1: **0 passed / 5 failed**, all caused by absent DS920 configuration files. The five tests cover preservation of existing services/volumes, internal non-root networking, explicit isolated binds/credentials/identity, complete TLS/trusted-header behavior, and bounded proxy streaming without static-file bypass. After adding the candidate files: **5/5 passed**, zero failures/cancellations/skips. This is missing deployment-configuration RED, not an invented application failure.

`test/persistence/ds920.test.ts` uses real Docker, Nginx TLS, CouchDB and Redis with temporary loopback ports, a disposable external network, synthetic files/accounts, and bind-backed CouchDB data/config. It does not use the NAS or owner documents. It checks that app-only operations preserve CouchDB/Redis container IDs and pre-existing user hashes/history, and exercises actual sessions, CSRF, private downloads, sharing/revocation, quotas and restart/recreation recovery through Nginx. The original 20 container cases remain enabled.

First [CI 43781548464](https://github.com/justinwj/portal-bsc/actions/runs/43781548464), source `768e949848e4754a159efac07c03f2966e0e4885`: existing application/real-service/Windows suites passed. Container suite executed **28 cases: 24 passed / 4 failed**, plus a failing cleanup hook. Investigation identified an incorrect new unauthenticated-status expectation (the real guard correctly returns **401**, not 302), a stale temporary CouchDB port following recreation, and host cleanup permission mismatch for CouchDB-owned disposable bind files. The test now follows the existing guard contract, rediscovers the temporary port and retains the database fixture until its hosted VM expires, without changing ownership or removing volumes/databases. These are fixture corrections, not application fixes or disabled assertions.

Second [CI 43782399852](https://github.com/justinwj/portal-bsc/actions/runs/43782399852), source `7e9da88db1707892168ec43df2aa1be312afdd78`: **26/28 container cases passed**. The remaining refusal of uploads after a proxied download remained reproducible; a separate read-only ledger check was consistent.

Trace [CI 43782764725](https://github.com/justinwj/portal-bsc/actions/runs/43782764725), source `3f0daf2`: again **26/28** container cases passed. Temporary test-only tracing delegated to the real stream pipeline and recorded `ERR_STREAM_PREMATURE_CLOSE`, followed by `FilesService.noteDownloadFailure` / managed-storage invalidation. This located the failure at the proxy connection lifecycle, rather than missing quota metadata. Production code was not instrumented or changed. A sixth configuration contract then produced **5 passed / 1 failed** before adding an upstream keepalive pool with dynamic DNS; targeted retest **6/6 passed**. The candidate now requires open-source Nginx >=1.27.3, pending verification of the existing NAS image; no NAS image upgrade was performed.

GREEN [CI 43783122996](https://github.com/justinwj/portal-bsc/actions/runs/43783122996), source `dafa1f645458b72848aa52df3114829324c2aa08`: all three jobs succeeded; **28/28 container cases passed**, including the previously failing quota/recovery cases. The same policy/authorization assertions remain. No NestJS business logic, download integrity handling, database authentication, session behavior or quota/recovery algorithm was changed. The correction is the proxy upstream lifecycle.

REFACTOR removed all temporary read-only diagnostic commands and stream tracing from the test, and removed the unused cleanup import. Final local typecheck/build and **517/517 unit/HTTP/tooling tests** passed after removal. The trace-free container test runs the unmodified application entrypoint against the plain candidate; no dependency or middleware is replaced.

## Verification results

Executed final trace-free CI totals:

| Suite | Passed | Failed | Cancelled | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Linux complete unit/HTTP/tooling | 517 | 0 | 0 | 0 |
| Actual Redis/CouchDB integration | 92 | 0 | 0 | 0 |
| Production Docker/Compose/startup/persistence | 28 | 0 | 0 | 0 |
| Additional Windows tooling/configuration executions | 40 | 0 | 0 | 0 |
| Additional Windows upload/content executions | 263 | 0 | 0 | 0 |
| **Total executions** | **940** | **0** | **0** | **0** |

The first three rows represent **637 distinct cases**; Windows repeats 303. This session adds six configuration and eight real container cases. Builds, existing bootstrap tests, managed uploads, CSRF, authorization, account lifecycle, sharing, disk/quota recovery and legacy read-only checks remain enabled. No tests were skipped/deleted or security assertions relaxed.

Local Docker production build exited 0. GREEN CI production Docker build and TypeScript builds on Linux/Windows passed. Real services and retained bind-backed CouchDB recreation were executed on disposable GitHub resources. Full npm audit, production audit/high-critical gate and `npm ls --all` exited 0: **0 critical/high/moderate/low vulnerabilities**. Local independent audits and dependency validation also exited 0. `git diff --check` passed.

Final trace-free [CI 43783578474](https://github.com/justinwj/portal-bsc/actions/runs/43783578474) completed successfully for `08ab97b606d1a47bdb941c72a88f0910585798f2`. All three jobs and the counts above were inspected. The disposable proxy reported **Nginx 1.30.6**; the NAS version remains unknown. This rerun includes actual fresh application/container recreation, exact-byte downloads through TLS, retained CouchDB binds, private access and selective-sharing revocation without diagnostic patches. No production readiness or NAS acceptance is inferred from the disposable stack.

## Exact repository changes

- `deploy/ds920/compose.app.yml` — additive application candidate; existing services/storage inherited.
- `deploy/ds920/nginx.conf` — complete TLS/streaming/keepalive/DNS candidate.
- `deploy/ds920/.env.example` — blank protected-environment template, no real credentials.
- `test/tooling/ds920-deployment.test.cjs` — six cross-platform configuration contracts.
- `test/persistence/ds920.test.ts` — eight actual four-container integration cases with pre-existing bind data.
- `docs/ds920-production-preparation.md` — provisioning, image/transfer, TLS, AV, backup/restore, rollback and acceptance proposal.
- `docs/ds925-production-readiness.md` — historical-target clarification.
- `README.md` — current primary/backup roles and configuration links.
- `docs/development-session-7h-a.md` — this evidence/report.

No production application source, Dockerfile, generic Compose, dependency manifest/lockfile or CI workflow was changed. Existing test discovery runs the new tests automatically. No new package/service or production credentials were introduced.

## Operator documentation and outstanding decisions

See [DS920+ preparation](ds920-production-preparation.md) for the workstation-only build/save/checksum/load proposal, immutable image manifest, existing-project preservation, protected credentials, managed marker/ACL/disk-headroom checks, TLS topology, scheduled Antivirus Essential scope and safe extensionless acceptance, coherent Hyper Backup to DS925+, representative restore and app/Nginx-only rollback. All target-side checks are pending; no prior scan on a different NAS establishes DS920+ coverage. Scheduled scanning is not clean-before-download and files above Synology's documented 2,048 MB limit are excluded.

Before 7H-B review: obtain original redacted YAML/nginx.conf and actual mounts/network/ports; privately verify effective CouchDB authentication and whether any placeholder remains; choose HTTPS hostname/certificate/renewal and optional DSM trust topology; verify non-root identities, canonical separate storage path/UUID/headroom and Container Manager bind rejection; confirm DS920+ antivirus/extensionless coverage and coherent DS925+ versioned backup/restore. No actual NAS path for new managed storage or service identity has been invented. No recovery/standby automation is implemented.

The existing managed-download error handler conservatively invalidates managed upload admission after a caught stream/read failure. That protection was retained, including its operational recovery implications for failed/cancelled transfers. The proxy correction addresses the demonstrated normal-completion error; it does not certify every possible network failure or weaken integrity checks. The optional DSM topology can aggregate rate limiting until trusted original-client forwarding is separately verified. Scan quarantine can make storage inconsistent; backup consistency and tested restore remain operator obligations.

Interactive Rider, DSM/Container Manager, AV scanning, NAS provisioning, native Office/CAD visual checks, physical NAS restore and real deployment acceptance were not performed. Existing pending visual-acceptance status remains unchanged. Return for independent review; do not begin 7H-B from this report alone.

## Supplied-configuration reconciliation follow-up

Follow-up starting point: published `169cfd06351d87750b2c8057988c27a9c70803c8`. Justin subsequently supplied the complete original placeholder config and redacted three-service Compose, confirming `8088:80`, all five binds, loopback CouchDB/Redis bindings, Redis command and implicit default network. The **latest** inventory states DSM Portal reverse proxy, hostname, certificate and trusted source are unverified; no contrary inference is made from the running Nginx container.

The app addition now inherits `default` instead of defining a separately named external network. Expected conventional name `portal_default` is explicitly **not live-verified**. The reference infrastructure preserves all existing identities, restart policies, paths, modes, ports and commands. Credentials become required protected references; short binds become long binds with missing-source rejection. These are review declarations, not instructions to recreate existing services. The separate HTTP main config keeps host/container mapping 8088:80 and worker limit 1024. It retains upstream keepalive, streaming, quotas/auth boundaries and sanitized forwarding. The existing unused Nginx NAS mount is retained read-only, avoiding a mount-driven container recreation. The old TLS config is an unselected alternative.

HTTP proposal RED executed **8 cases: 6 passed / 2 failed** before the HTTP file existed; GREEN **8/8**. Actual [CI 43785114294](https://github.com/justinwj/portal-bsc/actions/runs/43785114294), source `814fbf7d448aa15535cb2ad6ffb421c8e071473c`, passed **945 executions** (519 Linux, 92 real-service, 29 container, 42 Windows tooling, 263 Windows upload/content). This preceded receipt/reconciliation of the full original files.

Reconciliation RED executed **9 cases: 6 passed / 3 failed**: the old external-network declaration did not match the supplied implicit network, the HTTP candidate changed worker limit 1024 to 512, and the infrastructure/placeholder references were absent. After correction: **9/9** contracts and typecheck passed. Full local regression/build then passed **520 tests**, zero failed/cancelled/skipped.

Actual [CI 43786016880](https://github.com/justinwj/portal-bsc/actions/runs/43786016880), source `8cc5c4055c2bd964777fbed968e74865c7fd8205`, exposed **29/30 container cases passing**, with one genuine reload failure: after starting the supplied placeholder and reloading the proxy in the same container, a later reload reported an empty PID file. Existing Linux/real-service/Windows jobs passed. A local disposable `nginx:stable-alpine` inspection showed compiled PID path `/run/nginx.pid`, while the candidates explicitly used `/var/run/nginx.pid`. On the tested image these alias the same location; [Nginx source](https://github.com/nginx/nginx/blob/master/src/core/ngx_cycle.c) compares old/new PID path strings, creates the new file and removes the old one when they differ. This explains the observed loss after the first reload. The NAS binary was not inspected.

PID compatibility RED executed **9 cases: 8 passed / 1 failed** before the correction. Both candidates now omit explicit `pid`, matching the supplied original and preserving the running daemon's compiled default. Targeted GREEN **9/9**. No application code, cookie security or database behavior changed. The actual container test now starts the original placeholder before app, verifies app joins the same implicit network, validates the proposed literal NAS configuration without starting it, and reloads TLS then HTTP in the **same Nginx container** with unchanged bindings. Plain HTTP and spoofed HTTPS headers must not obtain a production session cookie.

Final reconciled configuration/test SHA: `9b2ff729fc4cb7a4c735a7b3878b17e938a44ffe`. [CI 43786792357](https://github.com/justinwj/portal-bsc/actions/runs/43786792357) completed successfully; all three jobs and executed summaries were inspected. **948 passing executions / 642 distinct tests**: 520 Linux unit/HTTP/tooling, 92 real Redis/CouchDB, 30 Docker/Compose/container, 43 additional Windows tooling/configuration, 263 additional Windows upload/content. **Zero failures, cancellations or skips.** Docker/production TypeScript builds, both security audits/high-critical gate and peer/dependency validation passed. Final local 520-test regression, typecheck, build, both audits and `npm ls --all` exited 0; all vulnerability severities are zero. `git diff --check` passed. The tested Nginx image was 1.30.6; the NAS version remains unverified.

The documentation publication descendant records the reconciled files and adds only an explicit unselected-alternative comment to the TLS candidate; its exact SHA is supplied in the handoff. NAS-side deployment acceptance remains pending independently of CI. The rollback procedure is prepared for review, not executed on either NAS. No managed root, DSM rule, certificate, image transfer or authentication configuration was provisioned.

Follow-up files: `README.md`, `deploy/ds920/.env.example`, `deploy/ds920/compose.app.yml`, `deploy/ds920/compose.infrastructure.yml`, `deploy/ds920/nginx.conf`, `deploy/ds920/nginx.http-proposal.conf`, `deploy/ds920/nginx.original-placeholder.conf`, `docs/ds920-existing-configuration-review.md`, `docs/ds920-production-preparation.md`, this report, `test/persistence/ds920.test.ts`, `test/tooling/ds920-deployment.test.cjs`. No dependency/package-lock changes or production credentials are included. Staged `.idea` files and unrelated options report remain preserved.

## Owner-confirmed empty DSM reverse-proxy list

After reconciliation, Justin reported a direct DSM inspection confirming the empty list and absence of Portal-specific hostname/rule/certificate/trust configuration. This supersedes the historical unverified-status statements above; it does not claim a Codex NAS inspection. Documentation now records the preferred DSM HTTPS → protected 8088 HTTP → existing Nginx → app topology for evaluation, including firewall/loopback alternatives, the separate approval required for any container-recreating rebind, effective remote-denial tests, observed exact proxy sources, spoofed-header rejection, certificate/renewal decisions and future TDD acceptance. The executable Compose, header rules and application behavior remain unchanged; only a comment in the HTTP candidate is updated. No artificial RED test is introduced for this documentation-only update. No DSM rule, certificate, DNS record, firewall or NAS setting was created or modified.
