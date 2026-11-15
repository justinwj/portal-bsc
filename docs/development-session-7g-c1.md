# Session 7G-C1: real document acceptance and TIFF/HEIC support

Starting commit: `507e6b290b76ea867572f46c4788b417dec72879`, branch `codex/portal-bsc-r1-fixes`. Status: local browser/hash verification and updated full GitHub Actions verification passed. **Office application visual checks remain pending at Justin's explicit choice.** Browser/hash acceptance is not a claim that Word, Excel or PowerPoint opened the files.

Verified source commit: **`41979d37476b9976079e357b7caf36f73428174d`**. Logical changes are TIFF/HEIC support `074321c9e2cfc0b5ee0332e9b329b29e53f44185`, error handling `88b703f2bce926e5100fe55da65367015657fd58`, and the acceptance documentation at `41979d3`. This completed-evidence report is published in a documentation-only descendant; its exact final publication SHA is provided in the handoff, avoiding a self-referential hash inside its own content.

## Baseline, privacy and isolation

- Verified branch/HEAD and read `AGENTS.md` plus `.github/copilot-instructions.md` from `origin/master`. Preserved the staged `.idea` additions and unrelated untracked options report. Queried starting-commit [CI 42577490591](https://github.com/justinwj/portal-bsc/actions/runs/42577490591): completed successfully.
- Executed `npm ci`, `npm test`, production build: all exit 0; **367 baseline tests passed**, none failed/cancelled/skipped. Host Node 24.22.1/npm 11.19.1; npm emitted its install-script review warning for the existing bcrypt dependency, without install/build/test failure. No dependency/configuration upgrades were made.
- Docker Desktop was initially stopped; started the installed local engine, version **29.9.2**. Created a new session-owned internal network, fresh CouchDB 3/Redis 7 containers and new named database/managed/legacy volumes. Existing local Portal containers, credentials, data and all NAS paths were untouched. The normal compiled Nest application ran with real CouchDB and Redis, `ALLOW_IN_MEMORY_SESSION_STORE=false`, and development HTTP-cookie mode for loopback browser testing; no production configuration was changed to allow it.
- Only the disposable app was published on **127.0.0.1**. Redis/CouchDB had no host port mappings. An app-facing bridge with outbound masquerading disabled allowed loopback publication while dependencies stayed on the internal network. The actual app UID/GID was **1000:1000**, Node **22.23.5**, npm **10.9.9**. `/legacy` was read-only; `/managed` was separately writable with its new UUID marker. Legacy sentinel remained unchanged.
- The owner supplied a local directory; no further directory clarification was needed. Copied files to a session-specific Windows temporary directory **outside the checkout**, then hashed originals/copies. Browser downloads/manifests/profiles also stayed outside the checkout. Raw hashes, original names, document contents and local-only browser harness were excluded from commits/build contexts/reports. No cloud connector, remote browser, preview service or external file submission was used.
- Used a fresh local **headless Chrome 157.0.8103.52** profile through loopback DevTools, with external web traffic sent to a closed loopback proxy and background networking/sync disabled. Filled the real login/upload/sharing forms, selected local copies through the native file input and submitted the application's actual browser JavaScript. Download links triggered actual browser downloads. This was automated browser acceptance, not human interactive or Office-application testing.

Only anonymized document IDs, extensions, sizes and outcomes are recorded below. Originals were opened for reading/hashing only; post-test SHA-256 comparison confirmed all ten originals unchanged. Macro/add-in bytes were never executed; `.xlam` was never installed/enabled.

## RED → GREEN → REFACTOR

### TIFF/HEIC admission

Before production changes, added synthetic, privacy-safe signature fixtures in `test/fixtures/documents.ts` and tests in `src/files/upload-types.test.ts`. Actual RED: **57 executed, 41 passed / 16 failed**, zero cancelled/skipped. The new extensions were rejected by the existing allowlist. Tests cover both TIFF byte orders, classic/BigTIFF variants, `.tif`/`.tiff`, HEVC major/compatible brands, truncated directories/boxes, integer/offset overflow, executable/AVIF/generic-HEIF disguises and bounded extended/end-of-file box sizes. Negative tests require content-validation errors, so allowlist rejection alone cannot make them pass vacuously.

Added three real HTTP cases in `src/files/managed-upload.http.test.ts` covering private TIFF/HEIC streams, exact returned bytes, attachment/octet-stream/nosniff headers and member denial. After correcting a test-helper Buffer generic typing issue (not counted as behavioral RED), actual HTTP RED was **83 executed, 80 passed / 3 failed**.

GREEN added three allowlist entries and two bounded signature helpers in `src/files/upload-types.ts`. TIFF checks byte order/version, BigTIFF header fields and first-directory alignment/count/bounds using BigInt. HEIC walks at most 4,096 top-level box headers, bounds the file-type box to 4 KiB, accepts explicit HEVC brands and requires metadata/track plus media structure. It never decodes images, unpacks Office content, buffers the entire upload or invokes native conversion libraries. Both new image families remain `application/octet-stream` attachments. Combined targeted GREEN: **140/140**. Full initial regression: **386/386**; typecheck/build exit 0.

Primary references: [TIFF 6.0 specification](https://www.itu.int/itudoc/itu-t/com16/tiff-fx/docs/tiff6.pdf), [LibTIFF BigTIFF design](https://libtiff.gitlab.io/libtiff/specification/bigtiff.html), [Nokia HEIF structure/brand guidance](https://nokiatech.github.io/heif/technical.html). Signature recognition is not full image validity, successful codec decoding or a malware-clean claim.

### Observed plain-text rate-limit response

An initial browser batch accepted its first seven supplied files, then hit the existing 100-request/15-minute IP limit. The plain-text HTTP 429 response was parsed as JSON by the browser and displayed an unhelpful parser error. This was a real UI defect, not a rejected Office format or checksum mismatch.

Added two privacy-safe regressions in `test/tooling/upload-browser.test.cjs`: plain-text 429 and non-JSON proxy failure. RED: **6 executed, 4 passed / 2 failed**. GREEN: **6/6** after `public/js/uploads.js` explicitly handles 429 and safely handles JSON parsing failure. The UI asks the user to wait/check the previous upload status; it does not expose proxy/body details or automatically resubmit. No rate limit was raised/disabled and no security control was bypassed.

Built a fresh final local runtime image and verified the corrected message in the real browser against the **actual** rate limiter: the form was loaded, requests reached the unchanged limiter and the next upload displayed the friendly 429 message. A synthetic TXT fixture was used for this check, not private document content.

Refactor kept validation in named bounded helpers and response handling in the existing shared browser response helper; no compatibility package, decoder or unrelated application change. Final local complete suite: **388 passed, 0 failed/cancelled/skipped**; typecheck/build/full audit/production audit/dependency tree all exit 0. Both audits reported zero findings at all severities.

## Supplied-file outcomes

All ten rows used the real browser form after TIFF/HEIC implementation, real durable storage and actual browser downloads. Private-by-default was verified on each rendered file page. Original/downloaded SHA-256 matched in every row; raw hashes are deliberately omitted.

| ID | Supplied extension | Exact bytes | Upload/private | Download SHA-256 | Suggested download name |
| --- | --- | ---: | --- | --- | --- |
| D01 | `.tif` | 77,897,452 | Pass | Match | Matches original |
| D02 | `.jpg` | 9,803,204 | Pass | Match | Matches original |
| D03 | `.HEIC` | 2,487,505 | Pass | Match | Matches original |
| D04 | `.xlam` | 591,623 | Pass | Match | Matches original |
| D05 | `.xlsm` | 1,343,348 | Pass | Match | Matches original |
| D06 | `.pdf` | 7,604,187 | Pass | Match | Matches original |
| D07 | `.docx` | 1,355,810 | Pass | Match | Matches original |
| D08 | `.pptx` | 84,171 | Pass | Match | Matches original |
| D09 | `.xlsx` | 28,309 | Pass | Match | Matches original |
| D10 | `.png` | 73,283 | Pass | Match | Matches original |

Also copied D01 under a `.tiff` alias without changing its bytes: **77,897,452 bytes uploaded/downloaded successfully**, private, hash and browser suggested-name match. This is a tested extension alias of the supplied TIFF, not a claim that an independent `.tiff` sample was supplied. No actual Office file was rejected/corrupted, and no Office-validation weakening was needed.

## Practical browser, authorization and persistence checks

| Check | Actual outcome |
| --- | --- |
| Spaces | Generated `.xlsx` copy name with spaces accepted; exact bytes and suggested download name matched |
| Long valid name | 185-character `.xlsx` copy name accepted; exact bytes and suggested name matched |
| Unicode | Accented Latin/Japanese `.xlsx` copy name accepted; exact bytes and suggested name matched in Chrome |
| Repeated download | Two additional downloads of the representative `.xlsx` matched its original hash |
| Same document uploaded separately | Distinct committed file IDs; both kept independent storage records |
| Progress | Real page displayed `Reserving storage…` and `Uploading and finalizing…`; there is no numeric percentage progress indicator |
| Invalid selection | Synthetic unsupported `.exe` produced a visible error, without executing it |
| Real rate limit | Plain-text 429 now displays a clear wait/status message; no automatic retry |
| Private authorization | Approved recipient and unrelated account both received 404 before sharing |
| Share | Owner used actual checkbox/form controls; selected recipient downloaded matching bytes; unrelated account remained 404 |
| Revoke | Owner unchecked recipients/submitted; previously authorized recipient received 404 on subsequent request |
| Restart/session persistence | App-only restarts between bounded batches retained files and real Redis sessions; subsequent normal browser operations succeeded |
| Durable inspection | 22 committed test records including the initial partial batch, normal duplicates and TIFF alias; zero staging entries and zero pending audit entries |
| Audit | Real CouchDB held 22 `file.uploaded`, 24 `file.download_started`, 24 completed `file.download`, one `file.shared`, one `file.sharing_revoked` event |
| Legacy boundary | Actual legacy mount remained `RW=false`, managed mount `RW=true`; sentinel unchanged |

Test setup corrections are not application defects: the first browser harness mistakenly selected the layout logout form instead of the specific settings form; a reused browser profile had a stale DevTools port; Docker reassigned an automatically allocated loopback port on restart. Corrected local harness selectors/profile/port discovery and reran. No assertion or application protection was weakened to mask these setup issues.

The normal limiter counts HTML/assets/API requests, so a large automated batch can reach it even with small files. For this disposable acceptance run, separated batches with explicitly recorded app-only restarts; limits and middleware stayed unchanged. Those restarts also exercised retained sessions/files. This is not advice to restart production to evade rate limits. No claim of load/performance certification is made.

## Office application acceptance and remaining formats

**Not performed:** opening downloaded Word/Excel/PowerPoint files or visually inspecting contents in Office. Justin explicitly selected **Leave Office visual checks pending**. D07/D08/D09 downloaded copies are retained locally for that later check; the private handoff gives their location without publishing original paths/names. Keep macros disabled for D05; never install/enable D04 as an add-in just for acceptance. No Office macro, add-in, preview or image conversion ran.

Byte preservation and structural admission passed; actual rendering, editability, linked content, fonts, formulas, macros/add-in functionality and codec viewing are unverified. Firefox/Safari/Edge suggested-name behavior, human keyboard/accessibility review and interactive Rider checks were not performed.

No real samples were supplied for `.xls`, `.xlsb`, `.xlt`, `.xltx`, `.xltm`, `.doc`, `.docm`, `.dot`, `.dotx`, `.dotm`, `.ppt`, `.pptm`, `.pps`, `.ppsx`, `.ppsm`, `.pot`, `.potx`, `.potm`, `.accdb`, `.mdb`, `.vsdx`, `.vsdm`, `.vsd`, `.one`, `.onepkg`, `.mpp`, `.pub`, `.msg`, `.txt`, or the `.jpeg` alias. Existing synthetic regression coverage remains; it is not real-application acceptance. BigTIFF/other HEIC brand variants have synthetic-only coverage. Scheduled Synology scanning, DSM permissions, backups and NAS deployment remain outside this local phase.

## Files changed and CI

Only these eight authorized files change:

```text
src/files/upload-types.ts
src/files/upload-types.test.ts
src/files/managed-upload.http.test.ts
test/fixtures/documents.ts
public/js/uploads.js
test/tooling/upload-browser.test.cjs
docs/managed-uploads.md
docs/development-session-7g-c1.md
```

No manifest/lockfile, credentials, account policies, quota settings, NAS mounts or unrelated source changed. Owner files/private manifests/hashes and the local-only DevTools harness are not tracked or sent to GitHub. The managed-storage guide now lists **41 allowed extensions** and describes TIFF/HEIC signature limits.

Completed [GitHub Actions run 43697328686](https://github.com/justinwj/portal-bsc/actions/runs/43697328686), source `41979d37476b9976079e357b7caf36f73428174d`: inspected all three successful jobs, test summaries, build/audit and dependency-validation steps.

| Executed suite | Passed | Failed | Cancelled | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Linux complete unit/HTTP/tooling | 388 | 0 | 0 | 0 |
| Actual Redis/CouchDB integration | 88 | 0 | 0 | 0 |
| Production Docker/Compose/startup/persistence | 19 | 0 | 0 | 0 |
| Additional Windows tooling executions | 34 | 0 | 0 | 0 |
| Additional Windows upload/content executions | 140 | 0 | 0 | 0 |
| **Total executions** | **669** | **0** | **0** | **0** |

The first three rows are **495 distinct cases**; Windows repeats 174 cases. This adds 21 distinct regressions to 7G-B: 16 content validation, three HTTP and two browser-error tests. Local private-document browser checks are additional acceptance evidence, not included in CI counts and not uploaded to CI.

Linux and Windows typechecks/production builds passed. The production Docker image built and the real container stack passed its startup/bootstrap, read-only legacy, managed-write, persistence/recreation and security checks. Full audit, production audit/high-critical gate and `npm ls --all` passed; **zero critical, high, moderate or low npm findings**. No assertions were weakened or suites disabled. `git diff --check` passed. Package manifest/lockfile and existing staged `.idea` blob IDs/hashes were verified unchanged.

Only the session-owned local app/Redis/CouchDB services were stopped after acceptance. The initial test app container was also stopped when replaced by the final image. Private temporary downloads/manifests/profiles and the dedicated test data volumes remain locally retained; they contain owner-provided copies and must not be published, exported to CI or reused as public fixtures. Nothing was merged, deployed to a NAS, published as an image or removed from existing records/storage. Return for independent review; no further development phase begins here.
