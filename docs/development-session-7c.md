# Development Session 7C: direct TypeScript and development lifecycle

## Scope and commits

- Authorized branch: `codex/portal-bsc-r1-fixes`.
- Reviewed starting commit: `3b2786507a91c52a79d9198aebdbf877d3de1e4b`.
- RED tests: `99970c99c538ab136d66f22015bfb0a964de5b0d`.
- Implementation: `5e51a6c3a7086a172204ceb6e4277901e4bc7d74`.
- Final verified implementation: `5e51a6c3a7086a172204ceb6e4277901e4bc7d74`. The subsequent report publication commit is identified by the final workflow and handoff; a report cannot contain its own Git object hash.

Option 2 was explicitly approved. No application business logic, runtime dependency version, authentication, administrator policy, Redis/CouchDB handling, NAS protection, or deployment target was changed. No merge, deployment, image publication, production data access, credential change, or volume deletion was performed.

## Baseline

Verified branch, HEAD and status; fetched origin; read `AGENTS.md` and `.github/copilot-instructions.md` from `origin/master`; reviewed the Session 7B report and the existing options report. The pre-existing untracked `docs/development-session-7c-options.md` is preserved. It is not silently added to this session's commits.

The three staged `.idea` additions remain staged and are excluded from every session commit. Their original contents, and the ignored `.idea/vcs.xml`, have matching SHA-256 hashes after implementation. Commits use explicit file paths and `--only` to preserve the user's index.

Local environment: Windows, Node **24.19.0**, host npm **11.17.0**. Installation, lockfile generation, security audits and dependency-tree checks explicitly use **npm 10.9.9**, invoked with `npm exec --yes --package=npm@10.9.9 -- npm ...`. CI independently verifies the approved Node **22** environment. Docker is unavailable locally; no local Docker or real-service success is claimed.

Before changes:

| Check | Actual result |
| --- | --- |
| npm 10.9.9 `ci` | Exit 0; 452 installed, 453 audited |
| `npm test` | Exit 0; 82 passed, 0 failed/cancelled/skipped |
| `npm run build` | Exit 0 using Nest CLI 10.4.9 |
| Full audit | Exit 1; 9 affected packages: 1 high, 4 moderate, 4 low, 0 critical |
| Production audit | Exit 0; zero findings |
| npm 10.9.9 `ls --all --json` | Exit 1; inherited invalid webpack peer |
| [Accepted Session 7B CI](https://github.com/justinwj/portal-bsc/actions/runs/41426160668) | Completed success; 82 unit/HTTP + 59 real-service + 10 container = **151 passed**, no failures/cancellations/skips |

The peer conflict was `schema-utils@4.8.2` requiring optional webpack `^5.112.0`, with the CLI override providing webpack **5.104.1**. This diagnostic was recorded, not suppressed.

## Independent build comparison and production test artifacts

Two fresh builds used the original `tsconfig.build.json` with incremental compilation disabled and separate output directories at equal depth. Commands were `node node_modules/@nestjs/cli/bin/nest.js build --path <relative-config>` and `node node_modules/typescript/bin/tsc -p <config>`. The initial probe passed an absolute Windows config path to Nest CLI, which rejected that path; changing the probe to a repository-relative path reproduced the actual comparison. This was a probe setup error, not an application RED result.

Exact original output paths:

```text
C:\Users\justu\RiderProjects\portal-bsc\tmp\session-7c\baseline\nest
C:\Users\justu\RiderProjects\portal-bsc\tmp\session-7c\baseline\typescript
```

Both emitted **78 byte-identical files**. Every relative output path and SHA-256 hash is committed in [the build evidence](development-session-7c-build-hashes.json). Compiler: TypeScript **5.9.3** in both builds. Metadata, CommonJS, ES2021, declarations and source maps were already equivalent; no artificial failure was introduced for those correct behaviors.

However, both included nine unintended production artifacts:

```text
app.test.js                  app.test.js.map                  app.test.d.ts
csrf.http.test.js            csrf.http.test.js.map            csrf.http.test.d.ts
files/filesystem.test.js     files/filesystem.test.js.map     files/filesystem.test.d.ts
```

The actual old production Docker image contained all nine, independently confirmed by the RED CI image test. Build equivalence did not make these appropriate production artifacts.

The corrected configuration explicitly excludes `**/*.test.ts` as well as `**/*.spec.ts`, `test`, and `tmp`; `noEmitOnError` is enabled and production builds clean the owned `dist` first. A fresh direct build at `C:\Users\justu\RiderProjects\portal-bsc\tmp\session-7c\baseline\after` emits **69 files**, all byte-identical to the corresponding original files at the same output depth. The only difference is removal of those nine artifacts. The evidence JSON includes the retained and removed hashes. Source-map relative paths vary with output depth; equal-depth comparison avoids mistaking that expected path difference for a code change.

## RED, GREEN and refactoring evidence

Tests were committed and executed before replacing the toolchain:

- Initial local tooling RED: **17 executed, 2 passed, 15 failed**, 0 cancelled/skipped. Correct entrypoint/maps and executable Nest decorator metadata checks already passed. Failures demonstrated production test emission, JavaScript emission despite TS2322, lack of a stale-output cleaner, and the missing compilation-aware watch/debug runner.
- [Independent RED CI](https://github.com/justinwj/portal-bsc/actions/runs/41432644941): completed failure. Existing 82 unit/HTTP and 59 real-service checks passed. Container suite: **10 passed, 1 failed**, 0 cancelled/skipped. Only `ships runtime entrypoints, maps and assets without compiled application tests` failed, listing all nine artifacts. Across that run: **151 passed, 1 failed**.
- First implementation: original **17 tooling tests passed** locally. Added lifecycle characterizations subsequently expanded this to 22.
- One added test initially expected a callback for rewriting byte-identical source. TypeScript correctly avoided rebuilding, so the test timed out (20 passed, 1 failed). It was corrected to change a checking-only compiler option, producing an actual completed compilation with identical output. This is a test assumption correction, not an application defect.
- An exploratory forced-termination assertion also expected private snapshot deletion after every process was abruptly killed. Processes and ports were released, but the directory could remain. Snapshot deletion is now asserted on normal shutdown; all force-kill process, descendant, port and debugger-pause assertions remain. A hard-killed process cannot guarantee execution of a filesystem cleanup handler. This limitation is explicit rather than concealed as a fixed guarantee.
- Final local regression: **104 passed**, 0 failed/cancelled/skipped (82 unchanged application tests + 22 tooling tests). Production build and application/test-source type checking exited 0.

Refactoring centralized process-tree termination and added a separate **undebugged** ownership guard, so pausing the application debugger cannot pause parent-death cleanup. Concurrent runtime failure, rebuild and shutdown share one termination promise. Test fixtures stop their owned processes before removing temporary directories. Compiler fixtures use fresh output directories; readiness accounts for independent stdout and ownership IPC pipes. No existing application assertion was removed, skipped, disabled or weakened.

## Build and orchestration design

`npm run build` invokes the existing TypeScript **5.9.3** compiler through a small cleaner. It verifies that the output is exactly this repository's `dist`, rejects a symlinked output directory, removes only that generated directory, then propagates the compiler exit status. `npm run typecheck` separately checks application and all TypeScript tests without emission, preserving checking coverage after excluding test code from production.

The removed Nest configuration specified only the source root and schematics collection. It contained no asset copying, plugins, path rewrites, bundling, or other build transformation to retain. Docker still explicitly copies `dist`, `views`, `public`, and runtime dependencies. Its obsolete Nest/build-config copies were removed. Production startup and bootstrap commands are unchanged.

`npm run start:dev` and `start:debug` use TypeScript's compiler watch API. Each full program is checked before emission into a new private snapshot. Only successful, complete output may be launched; the running generation cannot observe partial writes to its own output. On an error the old application stops, no failed generation starts, and a subsequent successful compile recovers automatically.

A serialized coordinator terminates the old process tree before starting the latest complete generation. Identical emitted bytes do not restart. Superseded and deleted files cannot leak through stale snapshots. The owner remains addressable until tree termination, including after application failure on Windows. Unix uses a dedicated process group; Windows uses `taskkill /PID <owned-pid> /T /F`. No global process-name kill is used.

Debug mode adds `--enable-source-maps` and `--inspect=127.0.0.1:9229`; a numeric `--inspect=<port>` selects another predictable loopback port. Public host arguments are rejected. Inspector availability is checked before launch. An undebugged guardian owns the application and reacts to watcher IPC disconnection even when the application is paused. Runtime crashes and startup/compiler errors are reported; errors are not hidden behind a successful build status.

There are **no new dependencies**. The compiler API and Node standard library supply orchestration. Design references: [TypeScript compiler watch API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API#writing-an-incremental-program-watcher) and [Node 22 child-process ownership, IPC and Windows signal behavior](https://nodejs.org/download/release/latest-v22.x/docs/api/child_process.html).

### Added automated contracts

| Group | Tests and behavior |
| --- | --- |
| Production compilation: 6 | Main/bootstrap entrypoints and maps; executable decorator metadata; no test artifacts; nonzero/error with no invalid emission; stale-output cleanup; independent test-source checking |
| Watch lifecycle: 12 | Initial complete compile; one valid-edit restart; error stops/recovery; initial error/recovery; rapid edits/no overlap; normal descendant/port/snapshot cleanup; forced watcher death cleanup; repeated port reuse; runtime crash/recovery; identical-output no restart; deleted-source removal; interruption cleanup |
| Debugging: 4 | Live inspector protocol attachment and TypeScript-mapped stacks before/after restart; public address rejection; occupied inspector rejection; forced watcher death while the application is actually debugger-paused |
| Actual Docker image: 1 | Runtime entrypoints/maps/assets present and application test artifacts absent |

Orchestration tests use isolated temporary projects, real processes, HTTP/TCP listeners, inspector WebSockets, compiler diagnostics and completion events. They do not mock the compiler, OS process lifecycle or debugger. Condition polling has deadlines; arbitrary sleeps are not used to infer successful completion. Port allocation is tracked, and only fixture-owned directories/processes are cleaned.

## Dependency and security results

Removed direct development dependencies: **@nestjs/cli 10.4.9** and **tsconfig-paths 4.2.0**. Removed obsolete overrides for Angular devkit's ajv/picomatch, fast-uri, and CLI glob/webpack. Existing runtime overrides for multer **2.5.0**, lodash **4.18.1**, and qs **6.16.1** remain untouched.

Retained installed development packages: TypeScript **5.9.3**, ts-node **10.9.2** (tests and source bootstrap still use it), js-yaml **4.3.2** (Compose assertions), @types/express **5.0.6**, @types/express-session **1.19.0**, @types/node **22.20.4**, @types/uuid **10.0.0**. No NestJS CLI 12 upgrade, forced transitive override, runtime migration, replacement renderer, audit exception or ignored peer diagnostic was introduced. The npm 10.9.9 lockfile remains version 3.

Installed/audited dependency count decreased from **453 to 217** (216 packages installed by fresh `ci`). Every retained production lockfile package has the same version as the starting commit. The accepted rendering chain remains express-handlebars **9.0.4** -> glob **14.0.3** / minimatch **11.0.4**.

The nine affected-package reports corresponded to **five distinct advisories**, all introduced by the development CLI graph:

| Advisory | Baseline package and chain | Exposure and remediation |
| --- | --- | --- |
| [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4), moderate | @nestjs/cli -> glob **10.5.0** | Development filesystem traversal/cancellation behavior; vulnerable instance removed with CLI. Patched production glob **14.0.3** retained. |
| [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), moderate | CLI -> glob -> minimatch **9.0.9**; CLI -> fork-ts-checker-webpack-plugin -> minimatch **3.1.5** | Development matching resource exhaustion; vulnerable instances removed. Patched renderer minimatch **11.0.4** retained. |
| [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4), low | CLI -> fork-ts-checker-webpack-plugin **9.0.2** -> deepmerge **4.3.1** | Returned-object prototype poisoning; no patched version listed in the advisory when reviewed. Removed unused CLI/plugin/deepmerge chain. |
| [GHSA-52f5-9888-hmc6](https://github.com/advisories/GHSA-52f5-9888-hmc6), low | CLI -> inquirer **8.2.6** / schematics CLI -> inquirer **9.2.15** -> external-editor **3.1.0** -> tmp **0.0.33** | Local temporary-file symlink behavior; entire unused prompt/editor chain removed. |
| [GHSA-ph9p-34f9-6g65](https://github.com/advisories/GHSA-ph9p-34f9-6g65), high | Same tmp **0.0.33** chain | Unsanitized prefix/postfix traversal; advisory patch floor **0.2.6**. Removed instead of overriding a no-longer-required CLI dependency. |

Advisory presence was established by actual audits; no remote application exploit is claimed. These packages were development-only and absent from the production audit. No new advisory appeared in the final audits.

| npm 10.9.9 check | Before | After local verification |
| --- | --- | --- |
| Full audit | Exit 1; 0 critical / 1 high / 4 moderate / 4 low | **Exit 0; zero findings** |
| Production audit | Exit 0; zero findings | **Exit 0; zero findings** |
| `npm ls --all` | Exit 1; webpack peer mismatch | **Exit 0; no invalid/unresolved peers** |

Webpack, schema-utils, schematics, inquirer, external-editor, tmp, deepmerge and fork-ts-checker-webpack-plugin are no longer installed. No security exception or diagnostic suppression is used. CI retains the production high/critical gate and adds full-audit and peer validation plus a separate Windows tooling job.

## Final independent verification

Implementation verification: [GitHub Actions run 41437541090](https://github.com/justinwj/portal-bsc/actions/runs/41437541090), completed **success** at `5e51a6c3a7086a172204ceb6e4277901e4bc7d74`. All three jobs and all verification steps were inspected.

| CI job / suite | Passed | Failed | Cancelled | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Linux Node 22: unchanged unit/HTTP | 82 | 0 | 0 | 0 |
| Linux Node 22: compilation/watch/debug contracts | 22 | 0 | 0 | 0 |
| Linux Node 22: actual Redis/CouchDB, production HTTP/download and NAS integration | 59 | 0 | 0 | 0 |
| Linux Docker/Compose: persistence, bootstrap, startup, NAS and image inspection | 11 | 0 | 0 | 0 |
| Windows Node 22: same compilation/watch/debug contracts repeated | 22 | 0 | 0 | 0 |
| **Total executed across CI jobs** | **196** | **0** | **0** | **0** |

There are **174 distinct tests** (104 + 59 + 11); Windows independently repeats the 22 tooling contracts. Both operating systems ran Node **22.23.4**, npm **10.9.9**. Linux and Windows `ci`, type checking, production compilation, full audit and dependency-tree validation passed. The separate production audit/security gate passed with zero findings. No workflow test suite was skipped or replaced.

The production Docker job completed successfully: **11 passed**, 0 failed/cancelled/skipped. It built the runtime image, started the production stack with real services, verified administrator bootstrap and persistence/recreation, enforced the read-only NAS bind, and inspected the actual image: `tests: []`, `entrypoints: true`, `assets: true`. Actual container Node: **22.23.4**, renderer **9.0.4**, glob **14.0.3**, minimatch **11.0.4**. Compose configuration, authenticated startup, first and repeated bootstrap, container recreation with retained data, file downloads, and filesystem protections remain covered by the executed container and integration suites.

Local final `npm test`: **104 passed**, 0 failed/cancelled/skipped. `typecheck`, production build, both npm 10.9.9 audits, `npm ls --all`, and `git diff --check` exited 0. Real Redis/CouchDB and container checks execute in disposable GitHub Actions resources, not locally or against Synology.

## Exact session files

```text
.github/workflows/ci.yml
Dockerfile
README.md
docs/development-session-7c.md
docs/development-session-7c-build-hashes.json
docs/development-workflow.md
nest-cli.json (deleted)
package.json
package-lock.json
scripts/build.cjs
scripts/dev.cjs
scripts/dev-child.cjs
scripts/process-tree.cjs
scripts/run-tests.cjs
test/tooling/build.test.cjs
test/tooling/support.cjs
test/tooling/watch.test.cjs
test/persistence/persistence.test.ts
tsconfig.build.json
tsconfig.check.json
```

## Rider acceptance and remaining limitations

Interactive Rider terminal/run-configuration operation, attachment, breakpoint resolution and Stop-button behavior **have not been executed through Rider's GUI**. Justin must complete the exact [Rider acceptance checklist](development-workflow.md#rider-acceptance--justin-must-execute-and-record-these-checks). Automated Windows/Linux inspector and source-map checks support, but do not substitute for, that acceptance.

Normal shutdown removes owned snapshots. Force-killing the whole process tree may leave ignored private `tmp/portal-dev-*` directories; process and port cleanup are still tested. Remove leftovers only after confirming the corresponding runner is stopped. Detached, independently managed application descendants are outside the ownership contract and must not be launched by this runner.

Audits describe the advisories known at verification time, not a permanent security clearance. No Synology deployment or production NAS verification occurred. This session stops for independent review; Rider's interactive acceptance remains pending.
