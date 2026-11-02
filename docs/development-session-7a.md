# Development Session 7A — NestJS 11 / Express 5

Stage 1 implementation is verified. Rendering and development-tooling migrations have not begun. Independent review is required before Stage 2.

## Scope, baseline and commits

- Branch: `codex/portal-bsc-r1-fixes`.
- Starting reviewed SHA: `c72eecfc43676618c31dd0f1a3a47ef06ce84139`.
- Characterization SHA: `ec517250eed541dcb5a49273bc47adada6e1e940`.
- Final tested implementation SHA: `b9ee23f41cbf6d466beaa0f531e21a0f4c63f578`. The report-publication commit changes only this document; its SHA is provided in the handoff and Git history.
- Fetched origin and read both mandatory instruction files from `origin/master`. Reviewed the Session 6 report before changes. Original staged `.idea/.gitignore`, `.idea/encodings.xml`, and `.idea/indexLayout.xml` were preserved; `.idea/vcs.xml` was also left untouched. All four hashes match the starting snapshot.
- Local Windows: Node v24.19.0, npm 11.17.0. Dependency installation and lockfile generation/validation explicitly used npm **10.9.9** via `npm exec --yes --package=npm@10.9.9 -- npm ...`. Both CI jobs recorded Node **22.23.4** and npm **10.9.9**; the Docker image uses Node **22**. Docker is unavailable locally.
- Baseline before changes: actual npm 10.9.9 `npm ci` exit 0 (440 installed, 441 audited), `npm test` exit 0 (65 passed), `npm run build` exit 0. [Reviewed baseline CI](https://github.com/justinwj/portal-bsc/actions/runs/41403825627): **132 passed**, comprising 65 unit/HTTP, 58 real Redis/CouchDB and HTTP/NAS, and 9 Compose/container tests; 0 failures/cancellations/skips. Both jobs and production builds succeeded. No production code changed during baseline verification.

## Official version-specific review

The default Nest migration URL now describes **11 → 12**. It was not used as the implementation target. The [official version 11 guide](https://docs.nestjs.com/v11/migration-guide) explicitly covers **10 → 11**. The selected [Nest v11.2.8 release](https://github.com/nestjs/nest/releases/tag/v11.2.8) and npm maintainer manifests were checked for runtime/peer requirements. No `latest` migration command, Nest 12, TypeScript 6, CLI upgrade, or codemod was adopted.

The [official Express 4 → 5 guide](https://expressjs.com/en/guide/migrating-5/) was reviewed for routing, parsers, promise/error propagation, response signatures, static assets, rendering and cookies. Assessment and verification:

| Change | Portal-BSC assessment and checks |
| --- | --- |
| Express 5 route grammar / named wildcards | Existing decorators use literals and named `:id` parameters, with pathless global middleware. No legacy wildcard/regex routes need rewriting. New tests check encoded IDs, exact matching, malformed encoded URLs, 404s and successful downloads. |
| Query parser defaults / getter | The application reads the scalar login error flag and never assigns req.query. No structured query API exists. Tests preserve the fixed login error message, non-reflection of query input and rejection of query-only credentials. No unnecessary extended-parser workaround was added. |
| Unparsed req.body can be undefined | CSRF already uses optional access. New tests exercise plain-text and empty JSON bodies with valid header tokens and require controlled 400s, not crashes. |
| Parsing and limits | Explicit extended:false form parsing is retained. Tests cover JSON login, malformed/oversized JSON, repeated/nested form keys and strict JSON DTO whitelisting. |
| Promise errors / response behavior | An external database rejection through an actual Nest route must return a generic 500 and keep serving. Existing and new real-service stream-error tests verify 404/500 handling, mid-stream aborts, headers, contents and audit semantics. |
| Session / CSRF / cookies / guards | Existing real HTTP and Redis tests exercise regeneration, secure cookies, authorization, CSRF failures, logout destruction, stale-session rejection and disabled accounts. No middleware or security settings changed. |
| Config 4 lookup precedence / dotenv | Config 4 changes internal/validated/process.env lookup precedence. Production source has no ConfigService.get consumers; configuration and bootstrap use process.env and existing validation. Startup, missing/invalid credentials, NAS failures and bootstrap cases passed in actual service/container tests. Direct dotenv 16 used by seed-admin was retained; config's required transitive dotenv is 17.4.1. |
| Nest module identity / lifecycle ordering | No custom module lifecycle hooks or global-module middleware registration depend on the changed ordering. Explicit CouchDB/NAS initialization remains in main.ts. Actual production startup/container/bootstrap tests passed. |
| Node / ESM dependencies | Nest 11 requires Node >=20. Common uses file-type 21 and load-esm; actual Node 22 builds and container startup passed. No application module-system conversion was needed. |

## Test-first characterization and honest RED/GREEN evidence

Before changing framework dependencies, ten HTTP tests were added in `src/csrf.http.test.ts`. They use actual application controllers/services, Nest routing, sessions, CSRF, guards, Handlebars and strict ValidationPipe; only external persistence is replaced. The HTTP helper gained raw-body support for parser tests. A controlled external database failure is confined to that test store.

New test names:

1. `authenticates JSON credentials with a session-bound CSRF header`
2. `returns a controlled 400 for unparsed body without authentication side effects`
3. `returns a controlled 400 for empty JSON body without authentication side effects`
4. `returns a controlled 400 for malformed JSON without authentication side effects`
5. `rejects non-scalar credential form input: username[role]=admin`
6. `rejects non-scalar credential form input: username=test-admin`
7. `preserves JSON DTO whitelisting for authenticated administrator submissions`
8. `rejects oversized JSON with 413 and continues serving requests`
9. `uses scalar query error flags without reflecting input or accepting query credentials`
10. `uses exact parameter routes and safely handles rejected async database calls`

An additional actual production-subprocess test in `test/integration/zz-file-downloads.test.ts`, `preserves download parameter decoding, exact route matching and malformed-URL error handling`, uses real Redis/CouchDB, real guards, a real temporary file and streamed HTTP bytes.

The initial characterization run was **74 passed / 1 failed**: a new query test incorrectly assumed the template reflected escaped query text. Source inspection showed it intentionally renders a fixed error message. The test was corrected to require that fixed message and absence of reflected input. This was a test-author assumption error, **not an application defect or migration RED**; no production code was changed to satisfy it and no pre-existing assertion was weakened. The corrected run was **75/75** locally. [Pre-migration characterization CI](https://github.com/justinwj/portal-bsc/actions/runs/41405859218) executed **143/143** (75 + 59 + 9), all passing before dependencies changed.

Security RED was independently recorded on the unchanged lockfile: eight distinct advisories, including three framework/file-type advisories addressed by this stage. Both normal audit commands exited 1. After the authorized coordinated upgrade, the same 75 local tests and production build passed immediately; no application behavior correction was needed. Security GREEN is the removal of those three actual advisory IDs plus the passing regression suite. No artificial HTTP failure was manufactured.

## Coordinated versions and minimal implementation

| Package | Reviewed installed version | Final installed version / declaration |
| --- | --- | --- |
| @nestjs/common | 10.4.22 | 11.2.8 / ^11.2.8 |
| @nestjs/core | 10.4.22 | 11.2.8 / ^11.2.8 |
| @nestjs/platform-express | 10.4.22 | 11.2.8 / ^11.2.8 |
| @nestjs/config | 3.3.0 | 4.0.4 / ^4.0.4 |
| express | 4.22.3 (plus Nest's 4.22.1) | 5.2.1, pinned to the platform adapter's declared version |
| @types/express | 4.17.25 | 5.0.6 / ^5.0.6 |
| file-type (transitive) | 20.4.1 | 21.3.4 |
| body-parser (transitive) | 1.20.9 override | 2.4.0, resolved from Express's supported ^2.2.1 range |
| Config transitive dotenv / dotenv-expand | 16.4.5 / 10.0.0 | 17.4.1 / 12.0.3 |

Runtime peer manifests require common/core/platform-express 11 together; config 4 explicitly supports common 11. The resolved runtime graph contains only Nest 11 and a single Express 5.2.1. Companion config's independent major 4 is correct; forcing its major to 11 would be incorrect. Rendering and CLI package version numbers are independent of Nest's runtime majors.

The obsolete global body-parser 1.x override was removed so Express 5 can use its supported, patched 2.4.0 parser. Other Session 6 security overrides were retained, including multer 2.5.0 (the Nest adapter pins vulnerable 2.4.0). No authentication, CSRF, guard, DTO, CouchDB, Redis, bootstrap, NAS, route, template, Dockerfile or Compose implementation changes were necessary. No compatibility shim was introduced; REFACTOR consisted of reviewing/removing the incompatible old parser override and confirming no additional workaround or source refactoring was needed.

Unchanged versions explicitly verified: Nest CLI 10.4.9, schematics 10.2.3, Angular Devkit 17.3.11, TypeScript 5.9.3, express-handlebars 9.0.1, handlebars 4.7.10, development glob 10.5.0, rendering glob 13.0.6. The CLI has no peer on the framework runtime packages; retaining it for this stage does not install a second runtime Nest major. No development-tooling migration or rendering migration was performed.

All existing changed-path lockfile versions (including required transitive changes):

| Lockfile path | Before | After |
| --- | --- | --- |
| node_modules/@borewit/text-codec | 0.2.2 | 0.2.3 |
| node_modules/@nestjs/common | 10.4.22 | 11.2.8 |
| node_modules/@nestjs/config | 3.3.0 | 4.0.4 |
| node_modules/@nestjs/config/node_modules/dotenv | 16.4.5 | 17.4.1 |
| node_modules/@nestjs/core | 10.4.22 | 11.2.8 |
| node_modules/@nestjs/platform-express | 10.4.22 | 11.2.8 |
| node_modules/@tokenizer/inflate | 0.2.7 | 0.4.1 |
| node_modules/@types/express | 4.17.25 | 5.0.6 |
| node_modules/@types/express-serve-static-core | 4.19.9 | 5.1.3 |
| node_modules/@types/serve-static | 1.15.10 | 2.2.0 |
| node_modules/accepts | 1.3.8 | 2.0.0 |
| node_modules/body-parser | 1.20.9 | 2.4.0 |
| node_modules/content-disposition | 0.5.4 | 1.1.0 |
| node_modules/cookie-signature | 1.0.6 | 1.2.2 |
| node_modules/cors | 2.8.5 | 2.8.6 |
| node_modules/dotenv-expand | 10.0.0 | 12.0.3 |
| node_modules/encodeurl | 2.0.0 | 2.0.1 |
| node_modules/express | 4.22.3 | 5.2.1 |
| node_modules/file-type | 20.4.1 | 21.3.4 |
| node_modules/finalhandler | 1.3.2 | 2.1.1 |
| node_modules/fresh | 0.5.2 | 2.0.0 |
| node_modules/media-typer | 0.3.0 | 1.1.1 |
| node_modules/merge-descriptors | 1.0.3 | 2.0.0 |
| node_modules/negotiator | 0.6.3 | 1.1.0 |
| node_modules/on-finished | 2.4.1 | 2.4.2 |
| node_modules/path-to-regexp | 3.3.0 | 8.4.2 |
| node_modules/range-parser | 1.2.1 | 1.3.0 |
| node_modules/raw-body | 2.5.3 | 3.0.2 |
| node_modules/send | 0.19.2 | 1.2.1 |
| node_modules/serve-static | 1.16.3 | 2.2.1 |
| node_modules/strtok3 | 10.3.5 | 10.6.3 |
| node_modules/type-is | 1.6.18 | 2.1.0 |

The full added/removed graph, integrity values and relocations are reviewable in package-lock.json; unrelated major upgrades were not selected. Lock generation and actual clean install both used npm 10.9.9. The final clean install exited 0 (451 installed / 452 audited), and full test-source type checking also passed.

## Before/after advisory inventory

Baseline `npm audit --json` and `npm audit --omit=dev --json` both exited **1**. Final npm 10.9.9 runs of the same commands also exited **1**, accurately reporting findings retained for later stages. Raw results and command logs are retained locally under ignored `tmp/session-7a/`; the complete inventory is below.

| Audit graph | Critical before → after | High before → after | Moderate before → after | Low before → after | Affected package entries before → after | Distinct advisories before → after |
| --- | --- | --- | --- | --- | --- | --- |
| Full | 0 → 0 | 1 → 1 | 9 → 5 | 4 → 4 | 14 → 10 | 8 → 5 |
| Production | 0 → 0 | 0 → 0 | 7 → 3 | 0 → 0 | 7 → 3 | 5 → 2 |
| Development-only affected names | 0 → 0 | 1 → 1 | 2 → 2 | 4 → 4 | 7 → 7 | 3 → 3 development-only IDs |

Counts from npm include parents with inherited findings; they are not counts of distinct vulnerabilities or proof of exploitation. All eight distinct baseline advisories are accounted for:

| Advisory / CVE | Severity; exposure; dependency chain | Before → after and status | Reachability / remaining risk |
| --- | --- | --- | --- |
| [GHSA-36xv-jgw5-4q75](https://github.com/advisories/GHSA-36xv-jgw5-4q75) / CVE-2026-35515 | Moderate; direct production @nestjs/core | 10.4.22 → 11.2.8; **resolved**, first patch 11.1.18 | SSE event injection; no SSE routes were found. Installed vulnerable package was verified, exploitation was not demonstrated. |
| [GHSA-5v7r-6r5c-r473](https://github.com/advisories/GHSA-5v7r-6r5c-r473) / CVE-2026-31808 | Moderate; production @nestjs/common → file-type | 20.4.1 → 21.3.4; **resolved**, first patch 21.3.1 | ASF detection infinite loop; no uploads/FileTypeValidator use in R1. |
| [GHSA-j47w-4g3g-c36v](https://github.com/advisories/GHSA-j47w-4g3g-c36v) / CVE-2026-32630 | Moderate; production @nestjs/common → file-type | 20.4.1 → 21.3.4; **resolved**, first patch 21.3.2 | ZIP decompression bomb; same unused detection path. |
| [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) / CVE-2026-118773 | Moderate; production express-handlebars → glob and development Nest CLI → glob | 13.0.6 / 10.5.0 retained; **open**, first patch 14.0.2 | Cancellation does not stop traversal. Paths/patterns are repository-controlled; no user-directed glob traversal endpoint found. Rendering/tooling migrations are outside Stage 1. |
| [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) / CVE-2026-118764 | Moderate; production express-handlebars → glob → minimatch; development CLI → glob/checker → minimatch | 10.2.6 / 9.0.9 / 3.1.5 retained; **open**, first patch 11.0.1 | Pattern amplification; no untrusted-pattern endpoint found. Do not force a major under older callers during this stage. |
| [GHSA-52f5-9888-hmc6](https://github.com/advisories/GHSA-52f5-9888-hmc6) / CVE-2025-54798 | Low; development CLI → inquirer → external-editor → tmp | 0.0.33 retained; **open**, first patch 0.2.4 | Symlink-based temporary path writes; not in production runtime, no request input configures it. |
| [GHSA-ph9p-34f9-6g65](https://github.com/advisories/GHSA-ph9p-34f9-6g65) / CVE-2026-44705 | High; same development tmp chain | 0.0.33 retained; **open**, first patch 0.2.6 | Prefix/postfix path traversal; isolated to development tooling, but untrusted checkouts/configuration remain a build trust risk. |
| [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) / CVE-2026-93753 | Low; development CLI → fork-ts-checker-webpack-plugin → deepmerge | 4.3.1 retained; **open**, no published patch | Prototype poisoning during config merge; no production use. Requires separately scoped maintained tooling solution. |

Remaining npm entries: production express-handlebars, rendering glob and rendering minimatch (moderate); development-only @nestjs/cli, fork-ts-checker-webpack-plugin (moderate), @angular-devkit/schematics-cli, external-editor, inquirer, deepmerge (low), and tmp (high). Shared glob/minimatch development copies are also flagged. No new distinct advisory appeared. Session 6 contains the earlier 43-advisory history; this report independently verifies the eight-advisory starting point for Stage 1.

## CI security gate and executed controls

The Node job now runs `npm audit --omit=dev --audit-level=high` after the suites. It has no continue-on-error, ignored exit, force/fix flag, or waived package. Its condition permits execution after another step fails, provided installation succeeded and the job was not cancelled. Existing tests, integration and Docker checks remain intact.

The [npm 10 audit documentation](https://docs.npmjs.com/cli/v10/commands/npm-audit/) confirms that audit-level changes the failure threshold while retaining lower-severity report output. Actual command-based verification with npm 10.9.9:

- Reviewed production lockfile: gate exit **0**, seven moderate package findings printed.
- Disposable lock-only Handlebars 4.7.9 fixture: gate exit **1**, critical advisories printed.
- Disposable lock-only body-parser 1.20.8 fixture: gate exit **1**, one high advisory printed.
- Migrated production lockfile: gate exit **0**, all three moderate package findings printed locally and in CI.

Vulnerable fixture dependencies were not installed or added to the application; only ignored disposable lockfiles were created, with install scripts disabled. No audit fix command was run. The gate detects currently known production critical/high findings; it is not a zero-vulnerability assertion or an exploitability assessment.

## Newly identified inherited development peer conflict

Additional npm 10.9.9 `npm ls --all` exited **1** with ELSPROBLEMS: existing schema-utils 4.8.2 declares optional webpack peer **^5.112.0**, while the Session 6 CLI security override supplies webpack **5.104.1**. Both checker/tooling versions and peer requirements are unchanged by Stage 1. This is a real declared development peer mismatch, not a runtime framework failure.

The reviewed baseline manifest/lockfile were copied to an isolated ignored directory; npm 10 `npm ls webpack --all --package-lock-only` reproduced the identical exit **1** without altering the application checkout. npm 11's same diagnostic exits 0 because of override handling, so the earlier npm 11 baseline ls result did not reveal it. npm 10.9.9 clean installation, compilation, all application suites and Docker builds still pass, and the selected runtime Nest/Express peer graph is coherent. This report therefore does **not** claim a completely clean development dependency tree. Resolving this inherited tooling issue is deferred to the explicitly separate tooling stage; no override, assertion or workflow was weakened to conceal it.

## Executed final verification and review limits

[Completed migration CI](https://github.com/justinwj/portal-bsc/actions/runs/41406332671), commit b9ee23f41cbf6d466beaa0f531e21a0f4c63f578: **success**. Both jobs and every workflow step completed successfully, including the new audit gate.

| Executed check | Result |
| --- | --- |
| Full unit/HTTP | 75 passed; 0 failed/cancelled/skipped |
| Real Redis/CouchDB and production HTTP/NAS | 59 passed; 0 failed/cancelled/skipped |
| Compose persistence and application-container smoke | 9 passed; 0 failed/cancelled/skipped |
| Total | **143 passed; 0 failed; 0 cancelled; 0 skipped** |
| Production TypeScript build | Passed locally and on Node 22 CI |
| Production Docker build | Passed; actual builder/runtime npm ci and compilation executed |
| Production dependency security gate | Passed; three moderate findings remain visible |
| Full / production audit | Both exit 1; 10 / 3 affected package entries, as inventoried |
| npm 10.9.9 clean install and full test-source type check | Passed |
| git diff --check | Passed |

All pre-existing assertions remained enabled and unchanged. HTTP tests verify authentication, CSRF, guards, strict DTO validation, role-specific rendering, logout and authorization. Real-service tests additionally verify Redis session persistence/destruction/unavailability, CouchDB authentication/all required databases/persistence/bootstrap failures and collisions, production NAS preflight, file streaming/errors and audit behavior. Compose checks verify credentials/private CouchDB networking, persistent records through restart/recreation, existing/read-only NAS binds, missing-bind rejection, bootstrap and fresh application startup. No volumes were deleted. No requested service/container suite was left unexecuted; they ran in CI because local Docker is unavailable.

Exact changed files:

1. `src/csrf.http.test.ts` — ten characterization tests, raw request helper and controlled external-store error.
2. `test/integration/zz-file-downloads.test.ts` — real HTTP download routing/decoding/error characterization.
3. `package.json` — coordinated runtime/config/types declarations and removal of the old parser override.
4. `package-lock.json` — corresponding npm 10.9.9 graph.
5. `.github/workflows/ci.yml` — production critical/high audit gate.
6. `docs/development-session-7a.md` — this report.

Remaining risks: five known advisories remain for later stages, including one development-only high; the inherited tooling peer conflict also remains. The tests cover the application's existing routes rather than every changed Express API or every NAS/network failure. Structured query parsing changes and config precedence are documented above; future routes/configuration changes must account for them. The security gate depends on current npm advisory data and registry availability. No base-image/OS vulnerability scan, production NAS access, DS925+ deployment/preflight, production proxy/ACL validation, image publication or merge occurred. Stage 1's successful CI establishes regression and production high/critical-gate evidence, not overall deployment readiness. Stop for independent review before Stage 2.
