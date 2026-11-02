# Development Session 7B — Rendering dependency security

Stage 7B covers the supported rendering dependency update and its verification. Development-tooling remediation remains deferred to Stage 7C. A clean production npm audit is a dependency snapshot, not deployment approval or a comprehensive security assessment.

## Baseline and commits

- Branch: `codex/portal-bsc-r1-fixes`.
- Starting reviewed SHA: `447ac123a0480fcd7594ef33d61ce1aeb1cee2f2`.
- Characterization SHA: `45ec7e573a5f4bd4f1048fa9f322758380c7f7a9`.
- Rendering implementation SHA: `dabccb6a649a44dd15c13c525a263518b1aa81b6`. The subsequent report-only publication commit is identified in the handoff and Git history.
- Verified branch, HEAD and status; fetched origin; read `AGENTS.md` and `.github/copilot-instructions.md` from `origin/master`; reviewed the Stage 7A report. The three existing staged `.idea` files and the original `.idea/vcs.xml` were preserved. All four SHA-256 hashes match the starting snapshot.
- Local Windows: Node v24.19.0 and npm 11.17.0. Installation, lock generation, audits and dependency diagnostics explicitly used npm **10.9.9**, invoked through `npm exec --yes --package=npm@10.9.9 -- npm ...`. Local Docker is unavailable; actual service/container checks ran in GitHub Actions.
- Baseline `npm ci` exited **0** (451 installed, 452 audited), `npm test` exited **0** (75 passed, 0 failed/cancelled/skipped), and `npm run build` exited **0** before files changed.
- [Completed reviewed Stage 7A CI](https://github.com/justinwj/portal-bsc/actions/runs/41407285578): **143 passed** — 75 unit/HTTP, 59 real-service/production HTTP/NAS, 9 Compose/container — with zero failures, cancellations or skips. Both jobs, the production TypeScript/Docker builds and the production security gate passed.

## Characterization before dependency changes

Existing tests already exercised real Nest routes, session authentication, strict DTO validation, CSRF form/header tokens, administrator/member navigation, the registered `eq` helper, authorized file details, metadata denials, logout/session destruction, file downloads and error/audit behavior. Those assertions remained enabled and unchanged.

Seven missing HTTP rendering checks were added to the existing actual-application harness in `src/csrf.http.test.ts`:

1. `renders the login page with the configured layout, discovered partial and working CSRF form`
2. `renders admin helpers and authorized file records without leaking other roles' metadata`
3. `renders member helpers and authorized file records without leaking other roles' metadata`
4. `HTML-escapes untrusted file metadata in lists, details and layout titles`
5. `HTML-escapes untrusted usernames on the dashboard and administrator page`
6. `returns a controlled rendering error for a missing template without leaking server paths`
7. `returns a controlled rendering error for a invalid partial without leaking server paths`

Only external persistence is replaced in this harness. Actual controllers, services, guards, sessions, CSRF, ValidationPipe, `configureViews`, express-handlebars and Handlebars execute over HTTP. Additional file records use ID-accurate map lookup, including private administrator/member files, a public file and an empty-role private file.

Production has no partial templates, and its dashboard currently displays navigation rather than file records. No dashboard feature or product partial was added. For partial discovery and failure coverage, the harness copies the production templates into its own temporary directory, appends a disk-partial include only to that copy, and invokes the production `configureViews` synchronously with that fixed root before serving requests. The original working directory is immediately restored. Tests temporarily remove a copied login template or corrupt the copied partial, then restore them and verify successful subsequent rendering. No rendering component is mocked and no production template is modified. Cleanup validates the temporary root and prefix before recursive removal.

These checks verify layout markup, helper true/false behavior inside a discovered partial, working login CSRF, authorized file-list records and details, denial without metadata leakage, default escaping of titles/descriptions/categories/types/hashes/usernames, and generic HTTP 500 responses without filesystem paths or internals. Dashboard role/navigation behavior and absence of unauthorized metadata remain covered without inventing a new file-list feature there.

A new Compose test, `runs the production container on Node 22 at or above the rendering engine patch floor`, executes Node inside the actual running production application container. It verifies the Node 22 major and minimum 22.23.4 patch floor and prints the resolved renderer/glob/minimatch versions and engine declarations from that container.

Before upgrading dependencies:

- Local full unit/HTTP suite: **82 passed**, 0 failed/cancelled/skipped; production build and full test-source type check passed.
- [Completed characterization CI](https://github.com/justinwj/portal-bsc/actions/runs/41424080800): **151 passed** — 82 unit/HTTP + 59 real-service + 10 container — with 0 failed/cancelled/skipped. Both jobs and builds succeeded.
- The old renderer already passed every characterization test. No functional defect, compatibility shim or artificial HTTP RED was introduced. Security RED is the actual vulnerable production dependency graph below.

## Security RED and upstream review

Commands ran with npm 10.9.9 against the unchanged rendering lockfile after characterization tests were written:

| Command | Before exit | Before result |
| --- | ---: | --- |
| `npm audit --json` | 1 | 10 affected package entries: 0 critical, 1 high, 5 moderate, 4 low |
| `npm audit --omit=dev --json` | 1 | 3 affected production package entries, all moderate; 2 distinct advisories |
| `npm ls --all` | 1 | Existing webpack/schema-utils peer conflict; not suppressed |
| Additional `npm ls --all --json` | 1 | Dependency paths and the same peer problem captured |

Raw audit/diagnostic output is retained locally under ignored `tmp/session-7b/`. The full advisory inventory is recorded below, including retained development findings. npm affected-package counts include inherited parent findings and differ from distinct advisory counts.

Official advisories and maintainer manifests were independently checked:

- [GHSA-3g3m-2fjr-6pw4 / CVE-2026-118773](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4): glob `>=9.0.0 <=14.0.1`; first patch **14.0.2**. Cancellation can leave filesystem traversal running. Portal-BSC uses repository-controlled template discovery paths, with no user-directed glob traversal endpoint identified; installation was verified, exploitation was not demonstrated.
- [GHSA-g3hv-75wg-m249 / CVE-2026-118764](https://github.com/advisories/GHSA-g3hv-75wg-m249): minimatch `<11.0.1`; first patch **11.0.1**. Pattern amplification can exhaust resources. No user-controlled glob-pattern API was found; this does not make an installed vulnerable version patched.
- The [maintainer's v9.0.4 release](https://github.com/express-handlebars/express-handlebars/releases/tag/v9.0.4) and [v9.0.1 → v9.0.4 comparison](https://github.com/express-handlebars/express-handlebars/compare/v9.0.1...v9.0.4) were reviewed. Runtime source API files do not change in that tag comparison; it updates dependency declarations, Node requirements and release metadata. Upstream build/development dependencies were not adopted into this repository.
- `npm view express-handlebars@9.0.4` declares glob `^14.0.3`, handlebars `^4.7.10`, graceful-fs `^4.2.11`, and Node `>=22.23.4`. Glob 14.0.3 declares minimatch `^11.0.2`; the installed supported result is minimatch 11.0.4. No global glob/minimatch override was introduced.

## Before/after rendering trees and GREEN

```text
Before (production):
portal-bsc
└─ express-handlebars 9.0.1
   ├─ glob 13.0.6
   │  ├─ minimatch 10.2.6
   │  └─ path-scurry 2.0.2
   ├─ handlebars 4.7.10
   └─ graceful-fs 4.2.11

After (production):
portal-bsc
└─ express-handlebars 9.0.4
   ├─ glob 14.0.3
   │  ├─ minimatch 11.0.4
   │  │  └─ @isaacs/nonrecursive-glob-match 1.0.3 (new)
   │  └─ path-scurry 3.0.0
   ├─ handlebars 4.7.10 (unchanged)
   └─ graceful-fs 4.2.11 (unchanged)
```

Exact dependency changes:

| Package / lock location | Before | After |
| --- | --- | --- |
| Direct express-handlebars declaration | ^9.0.1 | ^9.0.4 |
| Installed express-handlebars | 9.0.1 | 9.0.4 |
| Rendering glob | 13.0.6 | 14.0.3 |
| Rendering minimatch | 10.2.6 | 11.0.4 |
| Rendering path-scurry | 2.0.2 | 3.0.0 |
| @isaacs/nonrecursive-glob-match | absent | 1.0.3 |

The rendering glob/minimatch versions are outside the reviewed vulnerable ranges. Only the renderer declaration and its supported transitive graph changed in the manifests/lockfile. Other existing lockfile package entries, including their metadata, were verified unchanged. Nest common/core/platform-express remain 11.2.8, config remains 4.0.4, Express remains 5.2.1 and Express typings remain 5.0.6.

GREEN locally: all **82 tests passed**, 0 failed/cancelled/skipped; the production TypeScript build passed. npm 10.9.9 clean install exited **0** (452 installed, 453 audited), verifying lockfile compatibility. Production audit exited **0** with zero known vulnerabilities; the unchanged production critical/high gate also exited **0**. No application behavior defect or rendering workaround was needed.

REFACTOR review found no rendering compatibility code to remove. The `eq` registration, fixed template/layout/partial paths and default escaping configuration remain unchanged. Request data cannot select template discovery directories or view names; route render calls still use fixed names. All Session 6 overrides were reviewed and retained: none targeted the rendering subtree or became obsolete through this update. Their remaining framework/security/tooling purposes were not expanded into Stage 7C changes.

## Audits and remaining Stage 7C inventory

| Audit graph | Critical before → after | High before → after | Moderate before → after | Low before → after | npm package entries before → after | Distinct advisory IDs before → after |
| --- | --- | --- | --- | --- | --- | --- |
| Full | 0 → 0 | 1 → 1 | 5 → 4 | 4 → 4 | 10 → 9 | 5 → 5 |
| Production | 0 → 0 | 0 → 0 | 3 → 0 | 0 → 0 | 3 → 0 | 2 → 0 |

Final full audit exits **1** because development findings remain. Final production audit and the existing `npm audit --omit=dev --audit-level=high` gate exit **0**. Both rendering-related IDs are resolved in **production**; they remain in the full graph through unchanged development dependencies. Do not interpret this as every installed glob/minimatch copy being patched or the development graph being clean.

| Advisory | Remaining version / dependency chain | Status and risk |
| --- | --- | --- |
| [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) | Development @nestjs/cli 10.4.9 → glob 10.5.0 | Moderate; production resolved. Cancellation/traversal resource risk remains in trusted build tooling. First patch 14.0.2 requires a supported tooling solution. |
| [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) | Development CLI → glob 10.5.0 → minimatch 9.0.9; CLI → fork-ts-checker-webpack-plugin 9.0.2 → minimatch 3.1.5 | Moderate; production resolved. Pattern resource exhaustion remains in tooling; first patch 11.0.1 must not be forced under older callers without review. |
| [GHSA-52f5-9888-hmc6 / CVE-2025-54798](https://github.com/advisories/GHSA-52f5-9888-hmc6) | Development CLI → inquirer → external-editor 3.1.0 → tmp 0.0.33 | Low; retained symlink-based temporary-path write risk. First patch 0.2.4 crosses the parent's pre-1.0 compatibility range. |
| [GHSA-ph9p-34f9-6g65 / CVE-2026-44705](https://github.com/advisories/GHSA-ph9p-34f9-6g65) | Same development tmp chain | High; retained prefix/postfix path traversal risk. First patch 0.2.6 requires separately approved tooling remediation. No production runtime path uses this package. |
| [GHSA-gcqx-w48m-w2h4 / CVE-2026-93753](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) | Development CLI → fork-ts-checker-webpack-plugin 9.0.2 → deepmerge 4.3.1 | Low; retained prototype poisoning in config merges. No published patch; maintained tooling strategy remains necessary. |

These five advisory IDs are the complete before/after distinct inventory; no new advisory appeared. Remaining npm affected package entries are @nestjs/cli, @angular-devkit/schematics-cli, fork-ts-checker-webpack-plugin, external-editor, inquirer, deepmerge, glob, minimatch and tmp, all development-only. Untrusted source/configuration can still cross a build-tool trust boundary; production-only status is not a general exploitability waiver.

The inherited npm 10 peer conflict is unchanged: schema-utils 4.8.2 declares optional webpack peer `^5.112.0`, while the existing CLI override supplies webpack 5.104.1. Before and after `npm ls --all` exit **1** with the same `invalid: webpack@5.104.1` ELSPROBLEMS diagnostic. The JSON problems arrays match. CLI 10.4.9, webpack 5.104.1, both affected schema-utils 4.8.2 nodes and every override remain unchanged. This did not prevent installation, compilation or rendering verification. No diagnostic was suppressed, dependency forced, tooling upgraded or graph-clean claim made.

## Node.js compatibility

- Renderer minimum: Node **>=22.23.4** (previously >=22.22.2).
- Glob 14.0.3: `18 || 20 || >=22`; minimatch 11.0.4: `20 || >=22`. Node 22.23.4 satisfies the reviewed engine declarations.
- The characterization run already executed inside the actual running production container and recorded Node **22.23.4** with the old rendering chain. The production `node:22-alpine` image therefore needed no patch adjustment to meet the new floor; the approved Node 22 major, Dockerfile and Actions Node selection remain unchanged.
- Local Node 24 results are not production Node 22 evidence. The production-container test and complete Node 22 CI jobs supply that evidence for the updated image.
- Both migrated CI jobs recorded Node **22.23.4** and npm **10.9.9**. The running migrated application container printed the following actual resolved versions, satisfying the reviewed engine requirements:

```json
{"node":"22.23.4","renderer":{"version":"9.0.4","engines":{"node":">=22.23.4"}},"glob":{"version":"14.0.3","engines":{"node":"18 || 20 || >=22"}},"minimatch":{"version":"11.0.4","engines":{"node":"20 || >=22"}}}
```

## Verification and files

[Completed rendering migration CI](https://github.com/justinwj/portal-bsc/actions/runs/41424713253), implementation commit `dabccb6a649a44dd15c13c525a263518b1aa81b6`: **success**. Both jobs and every workflow step completed successfully, including the production critical/high gate. No skipped job or failure was concealed.

| Actual executed verification | Result |
| --- | --- |
| Full unit/HTTP suite | **82 passed**, 0 failed, 0 cancelled, 0 skipped |
| Real Redis/CouchDB, production HTTP/file download/NAS suite | **59 passed**, 0 failed, 0 cancelled, 0 skipped |
| Compose persistence and application-container suite | **10 passed**, 0 failed, 0 cancelled, 0 skipped |
| Total | **151 passed, 0 failed, 0 cancelled, 0 skipped** |
| Production TypeScript build | Passed locally and on Node 22 CI |
| Production Docker runtime image build | Passed, including actual builder and runtime npm ci |
| Running production application/container smoke and engine floor | Passed on Node 22.23.4 with the migrated renderer |
| Production audit / existing critical-high gate | Both exit 0; zero known production npm vulnerabilities |
| Full audit | Exit 1; nine development-only affected package entries, five advisory IDs |
| npm 10.9.9 clean install / test-source type check | Passed |
| npm 10.9.9 npm ls --all | Exit 1; inherited webpack peer conflict unchanged |
| git diff --check | Exit 0 |

The real-service suite retained session persistence/destruction and Redis failure checks, CouchDB authentication/database/bootstrap checks, actual authorization/file-download/stream-error/audit coverage and NAS startup protections. The Compose suite retained all persistence/restart/recreation, missing-bind rejection and read-only mount tests. The additional container version probe executed in the running application service. Local Docker/service verification was unavailable and was performed with actual disposable CI services instead; no requested suite remained unexecuted.

Exact Stage 7B changed files:

1. `src/csrf.http.test.ts` — seven missing rendering checks, ID-accurate additional fixtures and isolated on-disk template/partial setup.
2. `test/persistence/persistence.test.ts` — actual production-container Node/version/engine check.
3. `package.json` — express-handlebars ^9.0.4.
4. `package-lock.json` — supported rendering dependency resolutions.
5. `docs/development-session-7b.md` — evidence and remaining risks.

No production templates, rendering configuration, authentication, CouchDB, Redis, administrator bootstrap, NAS controls, Dockerfile, Compose configuration or CI gate were modified. No existing assertion was weakened, skipped, disabled or deleted. No merge, deployment, image publication, volume deletion, production NAS access or credential modification occurred. Stage 7C has not begun.

Remaining limitations: the five development advisories and inherited peer conflict require separately scoped Stage 7C review. No exhaustive exploit assessment, OS/base-image vulnerability scan, actual DS925+ preflight, production proxy/ACL review or NAS-storage validation was performed. The existing filesystem/host trust limitations documented in earlier sessions still apply. npm audit results depend on the registry's advisory data at verification time; a zero production dependency snapshot does not establish overall deployment readiness. Stop for independent Stage 7B review.
