# Development Session 6 — HTTP authorization and dependency security

Compatible remediation is verified. Further remediation is stopped pending approval of major/breaking dependency and tooling changes. This report does not grant security clearance or deployment readiness.

## Baseline and authorization checkpoint

- Starting commit: `e2395a93010b7ddc24a29b5a0f5460694c3c3724`; branch: `codex/portal-bsc-r1-fixes`. Remote instructions were read from `origin/master`; no production code changed during baseline verification.
- Original staged `.idea/.gitignore`, `.idea/encodings.xml`, and `.idea/indexLayout.xml` were preserved. No unrelated files are included in Session 6 commits.
- Local Windows: Node `v24.19.0`, npm `11.17.0`; Docker unavailable. `npm ci` exit 0 (441 installed, 442 audited), `npm test` exit 0 (65 passed; 0 failed/cancelled/skipped), `npm run build` exit 0. CI uses Node 22 and disposable real services.
- Reviewed Session 5 [baseline run](https://github.com/justinwj/portal-bsc/actions/runs/41398656236): 65 unit/HTTP + 54 real Redis/CouchDB integration + 9 Compose/container = **128 passed**, 0 failed/cancelled/skipped. Both jobs and the production image build succeeded.
- HTTP checkpoint commit: `65135de63af61187254e7ce7694e91d43da6eb9a`. Only `test/integration/zz-file-downloads.test.ts` changed. [Completed checkpoint CI](https://github.com/justinwj/portal-bsc/actions/runs/41401605400): **132 passed** (65 + 58 + 9), 0 failed/cancelled/skipped; TypeScript and Docker builds passed. Local regression: 65/65, build and full test-source type-check passed.

The four new real HTTP tests executed the compiled Nest application with real Redis sessions and CouchDB-backed authorization: `hides unauthorized admin file details from member without exposing metadata`; `hides unauthorized empty file details from admin without exposing metadata`; `renders authorized file details for admin`; `renders authorized file details for member`. Both denials returned 404 without ID, title, unique description, stored/original filename, or hash. Authorized pages returned HTML with the expected metadata and download link. Existing implementation passed immediately: characterization coverage, **no manufactured RED and no production correction**. This CI checkpoint completed before dependency investigation/changes.

## Security RED — independently captured audit

Commands ran against the unchanged reviewed lockfile after the HTTP checkpoint. `npm audit --json` exit **1**; `npm audit --omit=dev --json` exit **1**; `npm ls --all` exit **0** (no invalid/extraneous dependency errors). An additional `npm ls --all --json` exited 0 to trace dependency paths. Raw command output and all 43 advisory API responses were captured locally under ignored `tmp/session-6/`; findings and identifiers are recorded below. No audit fix command was run.

| Audit graph | Critical | High | Moderate | Low | Total affected packages |
| --- | ---: | ---: | ---: | ---: | ---: |
| Full baseline | 1 | 9 | 15 | 4 | 29 |
| Production baseline (`--omit=dev`) | 1 | 5 | 9 | 0 | 15 |

These reproduce the previously reported 29. npm counts affected package entries, including parents with inherited findings; there are **43 distinct GHSA advisories**, not 29 distinct advisories. Fourteen affected package names occur only in the development graph; glob is shared but has an additional development-only high finding. Therefore severity-by-severity subtraction of these two tables is not a valid development-only advisory count. Parent entries without their own advisory are listed separately below.

## Advisory inventory and intended actions

Installed versions below are from the baseline lockfile, filtered by each npm advisory range. All advisory-bearing packages are **transitive**, except direct production `@nestjs/core`. Production/development classification, exact introducing chains, reachability, patched versions and major-migration decisions apply per advisory in each package section. Reachability statements are source-review assessments, not exploitation proofs or security clearance.

### @nestjs/core

Production, direct. The advisory affects SSE event type/id serialization. There are no @Sse routes or EventSource flows in Portal-BSC; this precondition was not found. No exploit demonstrated. Nest 10 has no published patched release; 11.1.18 is the first patched version. A coordinated Nest major migration needs approval.

Introducing chains (baseline):

- `@nestjs/core@10.4.22`
- `@nestjs/platform-express@10.4.22 > @nestjs/core@10.4.22`

| Advisory | Severity | Installed affected version(s) | First published patch for the installed line / required new line | Final status |
| --- | --- | --- | --- | --- |
| [GHSA-36xv-jgw5-4q75](https://github.com/advisories/GHSA-36xv-jgw5-4q75) / CVE-2026-35515 | moderate | 10.4.22 | 11.1.18 | Open; correction requires approval / no patch (see options below) |

### ajv

Development only, transitive through Angular Devkit schema validation. No production JSON-schema/$data validation endpoint. Attacker-controlled build schemas could matter in an untrusted checkout; application DTO validation uses class-validator instead. Plan a scoped same-major 8.18.0 override for the pinned Devkit copy.

Introducing chains (baseline):

- `@nestjs/cli@10.4.9 > @angular-devkit/core@17.3.11 > ajv@8.12.0`

| Advisory | Severity | Installed affected version(s) | First published patch for the installed line / required new line | Final status |
| --- | --- | --- | --- | --- |
| [GHSA-2g4f-4pwh-qvx6](https://github.com/advisories/GHSA-2g4f-4pwh-qvx6) / CVE-2025-69873 | moderate | 8.12.0 | 8.18.0 | Resolved in final audit by compatible update (versions below) |

### body-parser

Production, transitive through Nest platform-express and Express. JSON and URL-encoded request parsing run before controller authentication, making malformed compressed bodies a relevant exposed boundary; exploit execution was not attempted. Default limits are used, so the invalid-limit configuration precondition was not found. Plan a same-major 1.20.9 override because Nest pins 1.20.4.

Introducing chains (baseline):

- `@nestjs/platform-express@10.4.22 > body-parser@1.20.4`
- `@nestjs/platform-express@10.4.22 > express@4.22.1 > body-parser@1.20.4`
- `express@4.22.3 > body-parser@1.20.8`

| Advisory | Severity | Installed affected version(s) | First published patch for the installed line / required new line | Final status |
| --- | --- | --- | --- | --- |
| [GHSA-v422-hmwv-36x6](https://github.com/advisories/GHSA-v422-hmwv-36x6) / CVE-2026-12590 | low | 1.20.4 | 1.20.6 | Resolved in final audit by compatible update (versions below) |
| [GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828) / CVE-2026-111181 | high | 1.20.4, 1.20.8 | 1.20.9 | Resolved in final audit by compatible update (versions below) |

### deepmerge

Development only, transitive through the CLI type-checker plugin. No production use. Trusted build configuration is merged; attacker-controlled source/configuration would be a build trust-boundary risk. No patched version is published in the advisory. Replacing/upgrading the introducing tooling needs separate approval; no local patch or assertion suppression is proposed.

Introducing chains (baseline):

- `@nestjs/cli@10.4.9 > fork-ts-checker-webpack-plugin@9.0.2 > deepmerge@4.3.1`

| Advisory | Severity | Installed affected version(s) | First published patch for the installed line / required new line | Final status |
| --- | --- | --- | --- | --- |
| [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) / CVE-2026-93753 | low | 4.3.1 | No published patch | Open; correction requires approval / no patch (see options below) |

### fast-uri

Development only, transitive through CLI schema-utils/Ajv. URI normalization is used in schema tooling, not as Portal-BSC authorization or redirect validation. No external request reaches this tooling in the runtime image. Plan a same-major 3.1.9 update.

Introducing chains (baseline):

- `@nestjs/cli@10.4.9 > @angular-devkit/core@17.3.11 > ajv-formats@2.1.1 > ajv@8.20.0 > fast-uri@3.1.8`
- `@nestjs/cli@10.4.9 > webpack@5.97.1 > terser-webpack-plugin@5.6.1 > schema-utils@4.5.0 > ajv@8.20.0 > fast-uri@3.1.8`

| Advisory | Severity | Installed affected version(s) | First published patch for the installed line / required new line | Final status |
| --- | --- | --- | --- | --- |
| [GHSA-w74x-v6f9-j3xg](https://github.com/advisories/GHSA-w74x-v6f9-j3xg) / CVE-2026-110306 | moderate | 3.1.8 | 3.1.9 | Resolved in final audit by compatible update (versions below) |
| [GHSA-xhq7-xmqj-769h](https://github.com/advisories/GHSA-xhq7-xmqj-769h) / CVE-2026-110095 | low | 3.1.8 | 3.1.9 | Resolved in final audit by compatible update (versions below) |
| [GHSA-wjr9-j795-jxcr](https://github.com/advisories/GHSA-wjr9-j795-jxcr) / CVE-2026-110180 | moderate | 3.1.8 | 3.1.9 | Resolved in final audit by compatible update (versions below) |
| [GHSA-333x-w4r6-6crp](https://github.com/advisories/GHSA-333x-w4r6-6crp) / CVE-2026-110725 | low | 3.1.8 | 3.1.9 | Resolved in final audit by compatible update (versions below) |

### file-type

Production, transitive through @nestjs/common. The affected ASF/ZIP detection is used by FileTypeValidator, which Portal-BSC does not instantiate. Release 1 has no upload endpoint or FileInterceptor. No exploit path identified. Patches require file-type 21 versus installed 20, and Nest pins 20.4.1. Defer the major/framework migration for approval.

Introducing chains (baseline):

- `@nestjs/common@10.4.22 > file-type@20.4.1`

| Advisory | Severity | Installed affected version(s) | First published patch for the installed line / required new line | Final status |
| --- | --- | --- | --- | --- |
| [GHSA-5v7r-6r5c-r473](https://github.com/advisories/GHSA-5v7r-6r5c-r473) / CVE-2026-31808 | moderate | 20.4.1 | 21.3.1 | Open; correction requires approval / no patch (see options below) |
| [GHSA-j47w-4g3g-c36v](https://github.com/advisories/GHSA-j47w-4g3g-c36v) / CVE-2026-32630 | moderate | 20.4.1 | 21.3.2 | Open; correction requires approval / no patch (see options below) |

### follow-redirects

Production, transitive through nano/axios. Outbound CouchDB requests carry credentials to an operator-configured URL; the redirect transport is used, but array/cross-realm sensitive-header options are not configured by application code. A malicious/compromised redirecting endpoint remains a relevant credential boundary; no exploit demonstrated. Plan the compatible 1.16.2 patch (fixes all three).

Introducing chains (baseline):

- `nano@10.1.3 > axios@1.20.0 > follow-redirects@1.16.0`

| Advisory | Severity | Installed affected version(s) | First published patch for the installed line / required new line | Final status |
| --- | --- | --- | --- | --- |
| [GHSA-q3jh-wrc6-jgq8](https://github.com/advisories/GHSA-q3jh-wrc6-jgq8) / CVE-2026-111756 | high | 1.16.0 | 1.16.1 | Resolved in final audit by compatible update (versions below) |
| [GHSA-8r9p-f939-6h3c](https://github.com/advisories/GHSA-8r9p-f939-6h3c) / CVE-2026-111755 | high | 1.16.0 | 1.16.1 | Resolved in final audit by compatible update (versions below) |
| [GHSA-mrwp-f3q8-3g9p](https://github.com/advisories/GHSA-mrwp-f3q8-3g9p) / CVE-2026-116689 | high | 1.16.0 | 1.16.2 | Resolved in final audit by compatible update (versions below) |

### glob

Production through express-handlebars template discovery and development through the Nest CLI. Template paths are repository-controlled; users cannot choose glob patterns or directory trees. Portal-BSC does not invoke the glob shell-command CLI, and no cancellable user-directed glob walk was found. Plan the CLI 10.5.0 security backport for shell injection. Full cancellation remediation requires a glob major (14.0.2+); defer that migration. express-handlebars 9.0.4 is an upstream patch option that adopts glob 14, but also raises the Node 22 patch floor; document and obtain approval before adopting the transitive major.

Introducing chains (baseline):

- `@nestjs/cli@10.4.9 > glob@10.4.5`
- `express-handlebars@9.0.1 > glob@13.0.6`

| Advisory | Severity | Installed affected version(s) | First published patch for the installed line / required new line | Final status |
| --- | --- | --- | --- | --- |
| [GHSA-5j98-mcp5-4vw2](https://github.com/advisories/GHSA-5j98-mcp5-4vw2) / CVE-2025-64756 | high | 10.4.5 | 10.5.0 | Resolved in final audit by compatible update (versions below) |
| [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) / CVE-2026-118773 | moderate | 13.0.6, 10.4.5 | 14.0.2 | Open; correction requires approval / no patch (see options below) |

### handlebars

Production, transitive through express-handlebars. Rendering is actively used, but only repository template strings are compiled; no user AST/template compilation, inline precompiled script output, or allowProtoMethodsByDefault:true configuration was found. Those advisory preconditions were not found; this is not evidence that the installed compiler is safe in all uses. Plan the compatible 4.7.10 security patch for all three advisories.

Introducing chains (baseline):

- `express-handlebars@9.0.1 > handlebars@4.7.9`

| Advisory | Severity | Installed affected version(s) | First published patch for the installed line / required new line | Final status |
| --- | --- | --- | --- | --- |
| [GHSA-xw65-4hp5-5hc7](https://github.com/advisories/GHSA-xw65-4hp5-5hc7) / CVE-2026-106444 | moderate | 4.7.9 | 4.7.10 | Resolved in final audit by compatible update (versions below) |
| [GHSA-8r5x-fm3f-whwj](https://github.com/advisories/GHSA-8r5x-fm3f-whwj) / CVE-2026-106446 | critical | 4.7.9 | 4.7.10 | Resolved in final audit by compatible update (versions below) |
| [GHSA-p8wg-vrv2-v86f](https://github.com/advisories/GHSA-p8wg-vrv2-v86f) / CVE-2026-106445 | critical | 4.7.9 | 4.7.10 | Resolved in final audit by compatible update (versions below) |

### ip-address

Production, transitive through express-rate-limit. The limiter consumes req.ip, so address parsing is used before authentication. Express/proxy address processing constrains that input, but no exploitability claim is made; proxy configuration remains relevant. Plan the compatible 10.7.4 patch.

Introducing chains (baseline):

- `express-rate-limit@8.7.0 > ip-address@10.7.2`

| Advisory | Severity | Installed affected version(s) | First published patch for the installed line / required new line | Final status |
| --- | --- | --- | --- | --- |
| [GHSA-rxp7-6hxx-x8q5](https://github.com/advisories/GHSA-rxp7-6hxx-x8q5) / CVE-2026-111997 | moderate | 10.7.2 | 10.7.4 | Resolved in final audit by compatible update (versions below) |

### lodash

Production through @nestjs/config and development through the CLI/inquirer/node-emoji. ConfigService uses get/has/set; no application use of template/imports, unset, or omit was found. No demonstrated path to the affected functions with untrusted input. Plan a same-major 4.18.0 override because config pins 4.17.21; it fixes both pollution advisories and template injection.

Introducing chains (baseline):

- `@nestjs/cli@10.4.9 > @angular-devkit/schematics-cli@17.3.11 > inquirer@9.2.15 > lodash@4.17.21`
- `@nestjs/cli@10.4.9 > inquirer@8.2.6 > lodash@4.17.21`
- `@nestjs/cli@10.4.9 > node-emoji@1.11.0 > lodash@4.17.21`
- `@nestjs/config@3.3.0 > lodash@4.17.21`

| Advisory | Severity | Installed affected version(s) | First published patch for the installed line / required new line | Final status |
| --- | --- | --- | --- | --- |
| [GHSA-r5fr-rjxr-66jc](https://github.com/advisories/GHSA-r5fr-rjxr-66jc) / CVE-2026-4800 | high | 4.17.21 | 4.18.0 | Resolved in final audit by compatible update (versions below) |
| [GHSA-f23m-r3pf-42rh](https://github.com/advisories/GHSA-f23m-r3pf-42rh) / CVE-2026-2950 | moderate | 4.17.21 | 4.18.0 | Resolved in final audit by compatible update (versions below) |
| [GHSA-xxjr-mmjv-4gpg](https://github.com/advisories/GHSA-xxjr-mmjv-4gpg) / CVE-2025-13465 | moderate | 4.17.21 | 4.17.23 | Resolved in final audit by compatible update (versions below) |

### minimatch

Production through template discovery and development through CLI glob/type-checker tooling. No user-supplied glob patterns or optimizationLevel configuration are exposed. npm flags installed major lines 3, 9 and 10, although the advisory description specifically demonstrates 10.2.6. The published patch is 11.0.1, requiring major migrations; defer rather than force a potentially incompatible export/API onto older callers.

Introducing chains (baseline):

- `@nestjs/cli@10.4.9 > fork-ts-checker-webpack-plugin@9.0.2 > minimatch@3.1.5`
- `@nestjs/cli@10.4.9 > glob@10.4.5 > minimatch@9.0.9`
- `express-handlebars@9.0.1 > glob@13.0.6 > minimatch@10.2.6`

| Advisory | Severity | Installed affected version(s) | First published patch for the installed line / required new line | Final status |
| --- | --- | --- | --- | --- |
| [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) / CVE-2026-118764 | moderate | 10.2.6, 9.0.9, 3.1.5 | 11.0.1 | Open; correction requires approval / no patch (see options below) |

### multer

Production, transitive through Nest platform-express. Portal-BSC has no multipart/upload interceptors or upload routes; affected multipart parsing and async fileFilter behavior are not registered. Installed does not mean demonstrated reachable. Plan the same-major 2.5.0 override for the Nest-pinned 2.0.2 dependency; no upload feature is added.

Introducing chains (baseline):

- `@nestjs/platform-express@10.4.22 > multer@2.0.2`

| Advisory | Severity | Installed affected version(s) | First published patch for the installed line / required new line | Final status |
| --- | --- | --- | --- | --- |
| [GHSA-xf7r-hgr6-v32p](https://github.com/advisories/GHSA-xf7r-hgr6-v32p) / CVE-2026-3304 | high | 2.0.2 | 2.1.0 | Resolved in final audit by compatible update (versions below) |
| [GHSA-v52c-386h-88mc](https://github.com/advisories/GHSA-v52c-386h-88mc) / CVE-2026-2359 | high | 2.0.2 | 2.1.0 | Resolved in final audit by compatible update (versions below) |
| [GHSA-5528-5vmv-3xc2](https://github.com/advisories/GHSA-5528-5vmv-3xc2) / CVE-2026-3520 | high | 2.0.2 | 2.1.1 | Resolved in final audit by compatible update (versions below) |
| [GHSA-72gw-mp4g-v24j](https://github.com/advisories/GHSA-72gw-mp4g-v24j) / CVE-2026-5079 | high | 2.0.2 | 2.2.0 | Resolved in final audit by compatible update (versions below) |
| [GHSA-3p4h-7m6x-2hcm](https://github.com/advisories/GHSA-3p4h-7m6x-2hcm) / CVE-2026-5038 | moderate | 2.0.2 | 2.2.0 | Resolved in final audit by compatible update (versions below) |
| [GHSA-wc9g-mqfw-jrwm](https://github.com/advisories/GHSA-wc9g-mqfw-jrwm) / CVE-2026-77078 | high | 2.0.2 | 2.3.0 | Resolved in final audit by compatible update (versions below) |
| [GHSA-qvfw-j98x-7q72](https://github.com/advisories/GHSA-qvfw-j98x-7q72) / CVE-2026-77063 | low | 2.0.2 | 2.3.0 | Resolved in final audit by compatible update (versions below) |
| [GHSA-535w-7cp7-47q4](https://github.com/advisories/GHSA-535w-7cp7-47q4) / CVE-2026-82333 | high | 2.0.2 | 2.3.0 | Resolved in final audit by compatible update (versions below) |
| [GHSA-q7qp-rjg7-q26m](https://github.com/advisories/GHSA-q7qp-rjg7-q26m) / CVE-2026-113872 | high | 2.0.2 | 2.5.0 | Resolved in final audit by compatible update (versions below) |

### picomatch

Development only, transitive through Angular Devkit. Build/schema patterns are trusted repository input; no production pattern endpoint. Plan a scoped same-major 4.0.4 override for the pinned 4.0.1 copy. Other installed 2.3.2 copies are already patched.

Introducing chains (baseline):

- `@nestjs/cli@10.4.9 > @angular-devkit/core@17.3.11 > picomatch@4.0.1`

| Advisory | Severity | Installed affected version(s) | First published patch for the installed line / required new line | Final status |
| --- | --- | --- | --- | --- |
| [GHSA-3v7f-55p6-f55p](https://github.com/advisories/GHSA-3v7f-55p6-f55p) / CVE-2026-33672 | moderate | 4.0.1 | 4.0.4 | Resolved in final audit by compatible update (versions below) |
| [GHSA-c2c7-rcm5-vvqj](https://github.com/advisories/GHSA-c2c7-rcm5-vvqj) / CVE-2026-33671 | high | 4.0.1 | 4.0.4 | Resolved in final audit by compatible update (versions below) |

### qs

Production through Express/body-parser and nano. Query parsing and CouchDB query serialization are used. Application URL-encoded bodies use extended:false; no comma:true parsing, comma-format stringify, or parse-to-stringify round trip of untrusted objects was found. Nested query input still warrants maintained parsing dependencies; exploitability was not demonstrated. Plan 6.16.1 across pinned/ranged copies using a same-major override.

Introducing chains (baseline):

- `@nestjs/platform-express@10.4.22 > body-parser@1.20.4 > qs@6.14.2`
- `@nestjs/platform-express@10.4.22 > express@4.22.1 > qs@6.14.2`
- `express@4.22.3 > body-parser@1.20.8 > qs@6.16.0`
- `express@4.22.3 > qs@6.16.0`
- `nano@10.1.3 > qs@6.14.2`

| Advisory | Severity | Installed affected version(s) | First published patch for the installed line / required new line | Final status |
| --- | --- | --- | --- | --- |
| [GHSA-q8mj-m7cp-5q26](https://github.com/advisories/GHSA-q8mj-m7cp-5q26) / CVE-2026-8723 | moderate | 6.14.2 | 6.15.2 | Resolved in final audit by compatible update (versions below) |
| [GHSA-x5fp-wj9c-mxmx](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx) / CVE-2026-82562 | moderate | 6.14.2 | 6.16.0 | Resolved in final audit by compatible update (versions below) |
| [GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g) / CVE-2026-82417 | moderate | 6.14.2 | 6.16.0 | Resolved in final audit by compatible update (versions below) |
| [GHSA-6pq8-jhm2-2vcw](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw) / CVE-2026-110816 | moderate | 6.16.0, 6.14.2 | 6.16.1 | Resolved in final audit by compatible update (versions below) |

### tmp

Development only, transitive through inquirer/external-editor. Nest schematic prompts may launch an editor, but production does not include this tooling. Application request input does not configure prefix/postfix/dir. Moving 0.0.33 to 0.2.6 crosses pre-1.0 minor compatibility boundaries and the parent range; defer for approval rather than assume compatibility.

Introducing chains (baseline):

- `@nestjs/cli@10.4.9 > inquirer@8.2.6 > external-editor@3.1.0 > tmp@0.0.33`

| Advisory | Severity | Installed affected version(s) | First published patch for the installed line / required new line | Final status |
| --- | --- | --- | --- | --- |
| [GHSA-52f5-9888-hmc6](https://github.com/advisories/GHSA-52f5-9888-hmc6) / CVE-2025-54798 | low | 0.0.33 | 0.2.4 | Open; correction requires approval / no patch (see options below) |
| [GHSA-ph9p-34f9-6g65](https://github.com/advisories/GHSA-ph9p-34f9-6g65) / CVE-2026-44705 | high | 0.0.33 | 0.2.6 | Open; correction requires approval / no patch (see options below) |

### webpack

Development only, transitive through the Nest CLI and its checker plugin. No experiments.buildHttp or HttpUriPlugin configuration is present, and ordinary production compilation uses the existing Nest configuration. No exposed application route. Plan a scoped same-major 5.104.1 security update, retaining existing build behavior.

Introducing chains (baseline):

- `@nestjs/cli@10.4.9 > fork-ts-checker-webpack-plugin@9.0.2 > webpack@5.97.1`
- `@nestjs/cli@10.4.9 > webpack@5.97.1`
- `@nestjs/cli@10.4.9 > webpack@5.97.1 > terser-webpack-plugin@5.6.1 > webpack@5.97.1`

| Advisory | Severity | Installed affected version(s) | First published patch for the installed line / required new line | Final status |
| --- | --- | --- | --- | --- |
| [GHSA-8fgc-7cc6-rx7x](https://github.com/advisories/GHSA-8fgc-7cc6-rx7x) / CVE-2025-68458 | low | 5.97.1 | 5.104.1 | Resolved in final audit by compatible update (versions below) |
| [GHSA-38r7-794h-5758](https://github.com/advisories/GHSA-38r7-794h-5758) / CVE-2025-68157 | low | 5.97.1 | 5.104.0 | Resolved in final audit by compatible update (versions below) |

### Inherited package findings

These entries have no distinct advisory of their own in this audit; remediation follows their introducing leaf advisories above. This accounts for the remaining npm package totals without inventing advisory identifiers.

| Package | Installed version | Exposure | Inherited from |
| --- | --- | --- | --- |
| @angular-devkit/core | 17.3.11 | Development only, transitive | ajv, picomatch |
| @angular-devkit/schematics | 17.3.11 | Development only, transitive | @angular-devkit/core |
| @angular-devkit/schematics-cli | 17.3.11 | Development only, transitive | @angular-devkit/core, @angular-devkit/schematics, inquirer |
| @nestjs/cli | 10.4.9 | Development only, direct | @angular-devkit/core, @angular-devkit/schematics, @angular-devkit/schematics-cli, @nestjs/schematics, fork-ts-checker-webpack-plugin, glob, inquirer, webpack |
| @nestjs/common | 10.4.22 | Production, direct | file-type |
| @nestjs/config | 3.3.0 | Production, direct | lodash |
| @nestjs/platform-express | 10.4.22 | Production, direct | @nestjs/core, body-parser, multer |
| @nestjs/schematics | 10.2.3 | Development only, transitive | @angular-devkit/core, @angular-devkit/schematics |
| express-handlebars | 9.0.1 | Production, direct | glob |
| external-editor | 3.1.0 | Development only, transitive | tmp |
| fork-ts-checker-webpack-plugin | 9.0.2 | Development only, transitive | deepmerge, minimatch |
| inquirer | 9.2.15, 8.2.6 | Development only, transitive | external-editor |

## Controlled remediation plan and approval boundary

Apply only same-major security patches/minors: ranged Handlebars/follow-redirects/ip-address updates; explicit overrides for pinned body-parser 1.20.9, multer 2.5.0, lodash 4.18.0, and qs 6.16.1; development-only Ajv 8.18.0, picomatch 4.0.4, fast-uri 3.1.9, glob 10.5.0 and webpack 5.104.1. Scoped overrides are needed where Nest/Devkit pins exact old versions. They are temporary, reviewable maintenance obligations; remove them when supported parent releases carry the fixes. No forced major override, dependency replacement, authentication/security workaround, or production source change is authorized or needed for these compatible updates.

Stop the remaining corrections for review: Nest 10→11+ (SSE fix), file-type 20→21+, glob 10/13→14+, minimatch 3/9/10→11+, tmp 0.0→0.2, and unpatched deepmerge/tooling replacement. Do not accept npm audit's Nest 12/CLI 12 recommendation automatically: CLI 12 still declares minimatch 10.2.6, and a blind latest-major upgrade does not establish a clean graph. Options and verification results will be recorded below before requesting approval.

## GREEN — compatible remediation and exact versions

Security evidence is the real audit transition, not invented application-test failures: **43 → 8 distinct advisories** (production **30 → 5**). Thirty-five baseline advisories are absent from the final audit. No new advisories were reported. All critical/high production findings were removed. Eight advisories remain open, including a development-only high; they are not waived or hidden. The per-advisory inventory above records the final status of every baseline advisory.

| Graph / stage | Critical | High | Moderate | Low | npm affected packages | Distinct advisories |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Full before | 1 | 9 | 15 | 4 | 29 | 43 |
| Full after | 0 | 1 | 9 | 4 | 14 | 8 |
| Production before | 1 | 5 | 9 | 0 | 15 | 30 |
| Production after | 0 | 0 | 7 | 0 | 7 | 5 |
| Development-only affected names before | 0 | 3 | 7 | 4 | 14 | 13 development-only advisories |
| Development-only affected names after | 0 | 1 | 2 | 4 | 7 | 3 development-only advisories |

Development-only name rows exclude package names also in production. The full graph additionally assigns glob high severity before remediation because of the CLI-only advisory; its production copy was moderate. Advisory counts are distinct IDs, independent of inherited npm package counts. The development-only high remaining is tmp path traversal, not a production package.

Final `npm audit --json` and `npm audit --omit=dev --json` both exited **1**, correctly reporting the remaining findings. Final `npm ls --all` exited **0**. The commands ran again after the final lockfile correction. Audit results are time-sensitive snapshots, not proof of exploit absence.

The first advisory-database patch for Lodash was 4.18.0; npm deprecated it as a bad release. The [maintainer advisory](https://github.com/lodash/lodash/security/advisories/GHSA-r5fr-rjxr-66jc) and [4.18.1 release notes](https://github.com/lodash/lodash/releases) identify 4.18.1 as the usable patched release. The intermediate 4.18.0 selection was replaced before committing. This database/maintainer discrepancy is recorded rather than assuming an audit-only green is sufficient. ip-address resolved to compatible 10.7.5 (beyond the first fixed 10.7.4).

Direct dependency version ranges were retained. `package.json` adds explicit same-major security overrides for pinned dependencies, scoped to their introducing parent where practical. `package-lock.json` records ranged security patches and the required resolved graph. Application source, authentication, CSRF, guards, DTO validation, bootstrap policy, Redis/CouchDB configuration, and NAS controls were not changed.

| Existing lockfile path | Before | After |
| --- | --- | --- |
| node_modules/@angular-devkit/core/node_modules/ajv | 8.12.0 | 8.20.0 |
| node_modules/@types/estree | 1.0.9 | 1.0.10 |
| node_modules/baseline-browser-mapping | 2.11.26 | 2.11.34 |
| node_modules/body-parser | 1.20.4 | 1.20.9 |
| node_modules/browserslist | 4.29.3 | 4.29.5 |
| node_modules/caniuse-lite | 1.0.30001813 | 1.0.30001820 |
| node_modules/electron-to-chromium | 1.5.441 | 1.5.472 |
| node_modules/es-module-lexer | 1.7.0 | 2.3.2 |
| node_modules/fast-uri | 3.1.8 | 3.1.9 |
| node_modules/follow-redirects | 1.16.0 | 1.16.2 |
| node_modules/glob | 10.4.5 | 10.5.0 |
| node_modules/handlebars | 4.7.9 | 4.7.10 |
| node_modules/ip-address | 10.7.2 | 10.7.5 |
| node_modules/lodash | 4.17.21 | 4.18.1 |
| node_modules/multer | 2.0.2 | 2.5.0 |
| node_modules/node-releases | 2.0.57 | 2.0.63 |
| node_modules/picomatch | 4.0.1 | 4.0.4 |
| node_modules/qs | 6.14.2 | 6.16.1 |
| node_modules/terser-webpack-plugin/node_modules/schema-utils | 4.5.0 | 4.8.2 |
| node_modules/update-browserslist-db | 1.3.3 | 1.3.4 |
| node_modules/watchpack | 2.5.2 | 2.6.3 |
| node_modules/webpack | 5.97.1 | 5.104.1 |
| node_modules/webpack-sources | 3.6.0 | 3.7.0 |

Added lockfile nodes:

- `node_modules/acorn-import-phases@1.0.4`
- `node_modules/webpack/node_modules/ajv@8.20.0`
- `node_modules/webpack/node_modules/ajv-formats@3.0.1`
- `node_modules/webpack/node_modules/ajv-keywords@5.1.0`
- `node_modules/webpack/node_modules/schema-utils@4.8.2`

Removed/consolidated lockfile nodes:

- `node_modules/concat-stream@2.0.0`
- `node_modules/express/node_modules/body-parser@1.20.8`
- `node_modules/express/node_modules/qs@6.16.0`
- `node_modules/mkdirp@0.5.6`
- `node_modules/typedarray@0.0.6`
- `node_modules/xtend@4.0.2`

The webpack minor/security release itself declares es-module-lexer ^2.0.0 and introduces acorn-import-phases; these are its supported transitive dependencies, not a forced breaking API override. npm 10 synchronization also refreshes the listed compatible build-only dependencies. No direct major migration or dependency replacement was performed.

## REFACTOR and reproducibility evidence

- After the compatible update, the 65 unit/HTTP tests and production TypeScript build passed. No behavior failure was invented for advisory-only corrections.
- Override scope was reviewed. Devkit Ajv reuses patched 8.20.0 already present in the baseline graph, avoiding an unnecessary downgrade of an existing patched copy to 8.18.0. Regression tests and build passed again. No application refactoring was needed.
- Dependency declarations were reviewed: uuid / @types/uuid appear unused because source uses node:crypto randomUUID. They are not implicated in these findings and were retained to avoid unrelated cleanup; no dependencies were replaced.
- [First dependency CI run](https://github.com/justinwj/portal-bsc/actions/runs/41402948966), commit `f32687c02cc69647ae498982cf1a2369cdf35c7f`, **failed** in both jobs at npm ci. No suites or Docker build executed in that run. npm 11 accepted the lockfile locally, while npm 10 rejected ten stale build dependency resolutions (including schema-utils, browserslist, watchpack, webpack-sources and their dependency graph) with EUSAGE. This is a lockfile compatibility defect, not an application HTTP failure.
- Genuine RED reproduction: `npm exec --yes --package=npm@10.9.9 -- npm ci --ignore-scripts --dry-run` exited **1** with the same invalid lock entries. GREEN: regenerate with `npm exec --yes --package=npm@10.9.9 -- npm install --package-lock-only --ignore-scripts`; the identical validation then exited **0**. An actual npm 10.9.9 `npm ci` also exited **0**, followed by 65/65 passing local tests and a successful production build. No legacy-peer-deps/force flags or workflow weakening were used.
- Lockfile correction commit: `d1abeff7850527ee573de2a7a0315c1334b6adec`. Final real-service and image evidence is recorded below.

## Remaining advisories and approval decision

| Open advisory | Exposure / retained version | Options and recommendation |
| --- | --- | --- |
| GHSA-36xv-jgw5-4q75 | Production Nest core 10.4.22, moderate; no SSE routes found | First patch 11.1.18. Prefer a separately approved coordinated Nest 11 update (currently 11.2.8), matching common/core/platform-express, config 4.0.4, direct Express 5 and corresponding types. Do not mix Nest majors. |
| GHSA-5v7r-6r5c-r473; GHSA-j47w-4g3g-c36v | Production file-type 20.4.1, moderate; no FileTypeValidator/upload flow found | Patches 21.3.1 and 21.3.2. Nest 11.2.8 common already declares 21.3.4. Prefer the coordinated framework update over forcing a major under Nest 10. |
| GHSA-3g3m-2fjr-6pw4 | Production glob 13.0.6 and development glob 10.5.0, moderate; trusted patterns | Patch 14.0.2. Upstream express-handlebars 9.0.4 declares glob ^14.0.3 and handlebars ^4.7.10, but adopts a transitive major and raises Node minimum from 22.22.2 to 22.23.4. Seek explicit approval for that adoption and a separate CLI/tooling solution; do not silently override old callers. |
| GHSA-g3hv-75wg-m249 | Production minimatch 10.2.6; development 3.1.5 and 9.0.9, moderate; no untrusted glob-pattern endpoint | Patch 11.0.1. Glob 14 supports minimatch 11, but old glob/checker callers need independent compatibility review. No forced major override was applied. |
| GHSA-52f5-9888-hmc6; GHSA-ph9p-34f9-6g65 | Development tmp 0.0.33, low/high; external editor tooling, not runtime | Patches 0.2.4 and 0.2.6. This crosses pre-1.0 compatibility boundaries and external-editor's ^0.0.33 range. Prefer supported introducing-tool upgrades, with explicit approval and schematic/editor verification. |
| GHSA-gcqx-w48m-w2h4 | Development deepmerge 4.3.1, low; checker config merging | No published patch; latest package is still 4.3.1. Latest checker 9.1.0 still declares deepmerge ^4.2.2 and minimatch ^3.0.4. Wait for a maintained correction or approve a tested tooling replacement; do not declare this resolved by merely bumping CLI. |

Investigated alternatives: Nest CLI 11.0.24 still uses glob 13.0.6 and checker 9.1.0. CLI 12.0.11 removes that checker/webpack chain but declares vulnerable minimatch 10.2.6 and TypeScript ~6.0.2. Neither major should be adopted blindly. A separately scoped lean TypeScript build replacing Nest CLI could remove development-only schematic/editor/checker dependencies, but would alter build/start/watch workflows and requires characterization and approval. A local fork/backport would create ongoing security-maintenance responsibility; it is not implemented here.

Recommended approval scope: coordinate the runtime Nest 11/Express 5/config migration first; adopt the maintainer-supported rendering patch with its glob/minimatch and Node-floor changes; investigate and approve a maintained build-tool solution separately. Compatibility risks include Express route/query-parser semantics, request typings, Nest lifecycle/configuration behavior, config 4's dotenv dependency changes, glob/minimatch exports/options, and CLI/TypeScript/watch/schematic behavior. Repeat the entire existing HTTP/security, service and container suite and both audits after each approved step.

Sources: every inventory row links the official GitHub advisory database entry; all 43 JSON entries and their maintainer references were retrieved during this review. Additional primary references: [Nest 11 migration guide](https://docs.nestjs.com/migration-guide), [Nest 11.1.18 security release](https://github.com/nestjs/nest/releases/tag/v11.1.18), [Handlebars 4.7.10](https://github.com/handlebars-lang/handlebars.js/releases/tag/v4.7.10), [body-parser 1.20.9](https://github.com/expressjs/body-parser/releases/tag/1.20.9), [multer 2.5.0](https://github.com/expressjs/multer/releases/tag/v2.5.0), and npm registry maintainer manifests queried with npm view for the versions above. No exploitation testing or production-system probing was performed.

## Final executed verification and handoff

- Starting SHA: `e2395a93010b7ddc24a29b5a0f5460694c3c3724`.
- Final tested implementation/dependency SHA: `d1abeff7850527ee573de2a7a0315c1334b6adec`. The subsequent report-publication commit changes only this document; its SHA is supplied in the handoff and Git history.
- [Completed final implementation CI](https://github.com/justinwj/portal-bsc/actions/runs/41403197230): **success**. Every step in both jobs completed successfully; no jobs were ignored.

| Executed suite/check | Result |
| --- | --- |
| Full unit/HTTP suite, Node 22 | 65 passed, 0 failed, 0 cancelled, 0 skipped |
| Real Redis/CouchDB plus production HTTP/NAS suite | 58 passed, 0 failed, 0 cancelled, 0 skipped |
| Production Compose persistence/container suite | 9 passed, 0 failed, 0 cancelled, 0 skipped |
| Total | **132 passed, 0 failed, 0 cancelled, 0 skipped** |
| Production TypeScript build, local and CI | Passed |
| Production Docker runtime image build | Passed in CI; builder npm ci --include=dev and runtime npm ci --omit=dev executed |
| Compose configuration, persistence and startup smoke | Passed on actual disposable Linux Docker resources |
| Final local npm 10.9.9 clean install, tests and build | Exited 0; 65 tests passed |
| Final full audit / production audit | Both exit 1: 14 full / 7 production affected packages remain, as inventoried |
| Final npm ls --all | Exit 0 |
| git diff --check | Exit 0 |

The complete Redis suite verified connection/readiness, real session creation/retrieval and persistence, logout session destruction, and bounded startup failure when Redis is unavailable. CouchDB suites verified authentication, all four database initialization, persisted users/files/audits, invalid/missing credentials and unavailability, and bootstrap idempotence/collision/failure behavior. The Compose suite checked credentials/private networking, persistent storage, required NAS host path, read-only bind with host creation disabled, actual missing-source rejection, fresh stack/bootstrap/persistence, restart durability, actual container write rejection, and retained-volume recreation with fresh application retrieval. Existing filesystem error, metadata denial, audit and streaming tests all remained enabled and passed. No existing assertion was removed, weakened, skipped or replaced.

Exact Session 6 changed files:

1. `test/integration/zz-file-downloads.test.ts` — four HTTP details tests and uniquely identifiable descriptions for leakage assertions.
2. `package.json` — explicit compatible security overrides.
3. `package-lock.json` — security resolutions and npm 10 reproducibility correction.
4. `docs/development-session-6.md` — baseline, all 43 advisories, remediation, failures, verification and approval options.

Only the authorized branch was committed/pushed. The three original staged IDE files remain staged, and all four original IDE file hashes match the initial snapshot. Production application source and deployment configuration are unchanged. No merge, deployment, image publication, volume deletion, NAS data access, production credential change or unrelated feature work occurred.

Remaining limitations: eight known advisories require the approval decisions above; override maintenance remains necessary until parent packages support patched versions. Local Node 24 is not production runtime verification—the successful Node 22 CI and actual Node 22 image/container tests supply that evidence. Docker and real-service tests could not run locally and instead actually ran in CI; no requested suite was left unexecuted. No DS925+ deployment/preflight, production NAS/proxy/ACL validation, comprehensive exploit assessment, or base-image/OS vulnerability scan was performed. Session 5's host/filesystem operational limitations remain applicable. A successful functional workflow does not approve the unresolved dependency migrations or establish deployment readiness.
