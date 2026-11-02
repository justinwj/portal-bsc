# Development session 5: authorization, filesystem boundary, and NAS mount safety

## Repository state and commits

Repository: `justinwj/portal-bsc`; branch: `codex/portal-bsc-r1-fixes`.

- Starting reviewed SHA: `d657b6882c1601de1d8823c21b8139261a8143cd`.
- Fixture correction and filesystem/HTTP/NAS RED tests: `a9ad2a27ab3282727be5fe1d26474a3bed80e299`.
- Implementation correction: `30dd87dbfec84ccb0107071616a8506d6a577d1a`.
- Strict authored-Compose assertion correction / GREEN: `a72461dd71f2038848b5c79823275237bad89e10`.
- Final tested implementation/refactor SHA: `f1a0c50ae18c67c9cc27dbe44fa2523ab44b4756`.

This report is a documentation-only follow-up. Its commit SHA and completed workflow link are supplied in the session completion message; application/test/configuration code is unchanged from the final tested implementation.

Branch/HEAD matched the requested baseline. Read `AGENTS.md` and `.github/copilot-instructions.md` from `origin/master`, plus the Session 4 report and DS925+ readiness guide. Unrelated staged `.idea` entries were preserved and excluded from every commit. Hashes of the original `.idea/.gitignore`, `.idea/encodings.xml`, `.idea/indexLayout.xml`, and `.idea/vcs.xml` matched their starting SHA256 values. No production NAS path/data or production credentials were used.

## Baseline evidence

Local verification used Node.js `v24.19.0` / npm `11.17.0` on Windows. Docker is unavailable locally.

| Baseline check before changes | Actual result |
| --- | --- |
| `npm test` | 37 passed, 0 failed/cancelled/skipped |
| `npm run build` | Passed |
| Reviewed [CI run 41391728560](https://github.com/justinwj/portal-bsc/actions/runs/41391728560) | 37 unit/HTTP + 30 integration + 5 persistence = 72 passed; both jobs successful |

The baseline workflow status, both jobs, and actual count summaries were re-read. There were no unexpected baseline failures or repository conflicts.

## RED: misleading authorization fixture

Added tests to `src/app.test.ts` before correcting its lookup. The targeted file had **11 tests: 6 passed / 5 failed**. The complete local suite had **43 tests: 38 passed / 5 failed**, with no cancellations/skips.

Actual failures:

- `file lookup fixture returns the requested ID and null for a missing ID`: received ID `1` when requesting ID `2`.
- `administrators cannot retrieve private files with empty allowedRoles`: missing expected rejection because lookup substituted the administrator-only record.
- `nonexistent file IDs are not found even for administrators`: missing expected rejection.
- Both `public file IDs remain accessible to authenticated {role} users` cases: administrator received the wrong record; member was incorrectly denied by the substituted record.

Changed only the fixture lookup to find the actual requested ID in its file list, returning `null` for missing IDs. The full local suite then passed **43/43** without production authorization changes. The original empty-role member test now exercises the intended record rather than passing for the wrong reason.

Additional tests cover member rejection for an existing administrator-only ID and authorized administrator retrieval. Later characterization checks verify listings/downloads apply the same exact role policy; administrators have no implicit bypass for member-only or empty-role private files. Public files still require authentication at the HTTP guard.

## RED: filesystem, real HTTP, and NAS configuration

Wrote and executed the new tests before implementation changes. Local filesystem RED was **61 tests: 45 passed / 16 failed**. Failures demonstrated missing literal-name rejection and returning a stream for a directory.

The real-service [RED run 41395310544](https://github.com/justinwj/portal-bsc/actions/runs/41395310544) executed all suites, even though the unit step failed. CI build/integration conditions allow independent verification after a unit failure; the job still fails on any failed test, with no `continue-on-error` masking.

| RED command | Actual result |
| --- | --- |
| Unit/HTTP | 61 tests: 45 passed / 16 failed |
| Real integration/startup/download | 54 tests: 43 passed / 11 failed |
| Compose/persistence/container | 9 tests: 5 passed / 4 failed |
| Production TypeScript and Docker image builds | Passed |

All RED suites had zero cancelled/skipped tests. The 11 integration failures comprised ten genuine application/startup failures and one new test's incorrect assumption about audit row order, described below.

Genuine observed defects:

1. **Stored-name rewriting and malformed input.** `basename()` silently converted traversal/absolute-style names into other root filenames. The new literal-name tests did not receive the expected controlled rejection, including separator/drive/control/alternate-stream/empty/non-string cases.
2. **Directories treated as downloadable files.** `readFileStream()` returned a stream for a directory. Its real HTTP request failed with a broken connection rather than controlled not-found handling.
3. **Escaping symlinks followed.** An authorized request for metadata pointing at a symlink to a temporary file outside the NAS root returned HTTP 200 instead of 404. Traversal-style metadata similarly returned HTTP 200 through rewriting.
4. **Unreadable files and read errors unsafe.** Real permission-denied and deterministic initial read-fault requests failed with `fetch failed`; the code had no safe stream-error ownership. Partial-transfer fault testing also found a persisted `file.download` audit even though the response body failed.
5. **Production NAS preflight absent.** Nonexistent directories, regular files, inaccessible directories, and relative paths allowed the application to start instead of fail. A nonexistent production root could be created by `mkdirSync`. Missing NAS configuration itself was already rejected by existing environment validation and remains protected.
6. **Unsafe production bind defaults.** Compose accepted an empty `NAS_FILES_HOST_PATH`, normalized the NAS mount writable, created a missing disposable host directory, and allowed a write inside the production container. The four new mount tests failed; the original five persistence tests still passed.

The filesystem and stream tests use actual temporary files/directories, POSIX permissions, and symlinks on the unprivileged CI runner. `test/integration/fs-faults.cjs` is a **test-only** preload for deterministic initial/late `EIO` reads of two actual fixture files. It replaces only filesystem read operations for those descriptors, not Nest routes, sessions, authentication/role guards, CouchDB/Redis clients, or audit services. It is never imported by production code. These injected cases are not claims of actual NAS hardware failures.

## GREEN corrections

### Authorization and filesystem boundary

Role semantics are unchanged: authorize metadata first, then open the file. Requests for unauthorized or missing IDs remain not found; unauthenticated requests remain unauthorized.

Stored names must be literal safe single components. Unsafe separators, traversal/drive/alternate-stream syntax, ASCII controls, device-style/ambiguous names, empty/non-string values, and malformed Unicode are rejected instead of rewritten. All symlink file entries are rejected. Canonical containment, `lstat`, read-only descriptor opening with `O_NOFOLLOW`/nonblocking flags where available, regular-file checks, device/inode comparison, and post-open path verification protect the read boundary. Streaming uses that verified descriptor rather than reopening a pathname.

The service confirms an initial read before returning the stream, handles cleanup, and maps missing/inaccessible/unsafe files to controlled not-found responses. Unexpected read failures return a generic server error without NAS paths. The controller uses a backpressure-aware pipeline and a bounded byte-count transform. It does not buffer the full file. It limits reads to the opened size and aborts an incomplete/error response. If headers/bytes already went out, it closes that incomplete response rather than pretending it completed or crashing the process.

`file.download` now means a completed server transfer. It is written only after the pipeline completes. Denied, missing, invalid, initial-error, and partial-error cases receive no successful-download audit. This is server completion accounting, not proof of client receipt. Audit persistence failures after completion are logged; durable audit retry/transaction semantics are outside this change.

### NAS startup and Compose

Production requires an explicit absolute NAS directory that already exists and is readable/searchable. It never creates a production replacement directory or requires NAS write access. Safe development directory creation is retained.

Production Compose requires `NAS_FILES_HOST_PATH`, uses a read-only long-syntax bind, and sets `bind.create_host_path: false`. The example leaves the host path blank for explicit operator configuration. Real CI mount operations prove missing sources are rejected without creation, pre-existing fixture bytes are readable in the app container, and writes fail with `EROFS`. CouchDB authentication, bootstrap policy, Redis session configuration, and other application features were not changed.

### Test corrections without weakened assertions

- CouchDB `_all_docs` rows are ordered by IDs, not insertion time. One new audit-actor assertion incorrectly used `audits.at(-1)` after two actors downloaded the same public file. It now requires exactly one newly added audit ID and checks that new record's actor. Record-count and actor assertions remain enforced.
- The initial implementation run passed **61 unit/HTTP and 54 integration tests**, plus **8/9 Compose tests**. The remaining failure was `undefined !== false` because Compose's normalized JSON omits a false `create_host_path` field. The test now parses the authored NAS mount and still asserts literal `false`, plus retaining the real missing-source/no-creation test. It does not treat an undefined flag as passing.
- Declared `js-yaml` **4.3.2** as a direct development dependency for that authored-config assertion. That exact version was already locked/installed transitively. The lockfile changed only the root development-dependency declaration: no package version was upgraded and no extra package was installed. The audit remained 29 vulnerabilities.

With those test assumptions corrected, [GREEN run 41396493495](https://github.com/justinwj/portal-bsc/actions/runs/41396493495) passed **61 + 54 + 9 = 124 tests**, with zero failures/cancellations/skips. Both builds passed.

## REFACTOR and final evidence

Shared one role predicate between listings and download lookup, extracted literal-name validation/stream readiness helpers, and removed unused misleading service doubles. Added characterization for listing/download parity and an empty regular file. They passed before the behavior-preserving refactor.

A final local malformed-Unicode test produced a separate RED: **65 tests, 64 passed / 1 failed**, because a lone surrogate was accepted as a stored name. Added an exact UTF-8 round-trip guard instead of allowing silent filename conversion. The local suite then passed **65/65**. This was a small additional RED/GREEN correction inside the agreed malformed-filename scope.

Updated README bootstrap guidance: member collisions are rejected, never promoted; repeated active administrators retain their passwords. Updated the DS925+ guide with NAS preflight, read-only/no-create requirements, compatibility limits, and remaining trust assumptions.

The final implementation/refactor [run 41397289887](https://github.com/justinwj/portal-bsc/actions/runs/41397289887) used Node `v22.23.4` / npm `10.9.9`. Both jobs and all steps succeeded:

| Final check | Actual result |
| --- | --- |
| Complete unit/HTTP suite | 65 passed, 0 failed/cancelled/skipped |
| Real Redis/CouchDB + startup/download suite | 54 passed, 0 failed/cancelled/skipped |
| Production Compose/persistence/container suite | 9 passed, 0 failed/cancelled/skipped |
| **Combined final total** | **128 passed, 0 failed, 0 cancelled, 0 skipped** |
| Production TypeScript build | Passed |
| Production Docker runtime image build | Passed; not published |
| Production Compose parsing/safety checks and actual mount behavior | Passed |
| Local regression after refactor | 65 passed; build passed |
| Integration test TypeScript checking | Passed locally |
| `git diff --check` | Passed |

The 54 integration tests retain all 30 Session 4 tests and add seven NAS startup and 17 real HTTP download tests. The nine Compose tests retain the original five database persistence/container tests and add four NAS mount checks. No test was skipped, deleted, or disabled to obtain green results.

## Completed workflow links

| Stage | Completed workflow | Outcome |
| --- | --- | --- |
| Reviewed baseline, `d657b68` | [41391728560](https://github.com/justinwj/portal-bsc/actions/runs/41391728560) | 72 passed |
| Filesystem/HTTP/NAS RED, `a9ad2a2` | [41395310544](https://github.com/justinwj/portal-bsc/actions/runs/41395310544) | Unit 45/16, integration 43/11, Compose 5/4 passed/failed; no cancellations/skips |
| Implementation, `30dd87d` | [41396103405](https://github.com/justinwj/portal-bsc/actions/runs/41396103405) | Unit 61 passed; integration 54 passed; Compose 8 passed / 1 serialized-field assertion failed |
| GREEN, `a72461d` | [41396493495](https://github.com/justinwj/portal-bsc/actions/runs/41396493495) | Both jobs passed; 124 tests passed |
| Final refactor, `f1a0c50` | [41397289887](https://github.com/justinwj/portal-bsc/actions/runs/41397289887) | Both jobs passed; 128 tests passed |

All workflow jobs/step results and logs were inspected, including intermediate failures. The report-only push runs the same full verification; its final commit/run link is provided in the completion message.

## Exact files changed

1. `.env.example`
2. `.github/workflows/ci.yml`
3. `README.md`
4. `docker-compose.app.yml`
5. `docs/ds925-production-readiness.md`
6. `docs/development-session-5.md`
7. `package.json`
8. `package-lock.json`
9. `src/app.test.ts`
10. `src/files/files.controller.ts`
11. `src/files/files.service.ts`
12. `src/files/filesystem.test.ts`
13. `src/main.ts` (NAS startup handling only)
14. `test/integration/fs-faults.cjs`
15. `test/integration/zy-nas-startup.test.ts`
16. `test/integration/zz-file-downloads.test.ts`
17. `test/persistence/persistence.test.ts`

## Compatibility and remaining risks

The [DS925+ guide](ds925-production-readiness.md#nas-file-boundary-and-startup-preflight) documents the compatibility review and an equivalent read/access-only deployment preflight. Synology documentation confirms Compose-based projects, but the target's installed Container Manager/Compose version was not available or queried. CI verified modern Compose long binds; actual target compatibility remains unverified. Unsupported options must stop deployment, not be removed silently. An approved compatible CLI or explicit Docker Engine `--mount ...,readonly` can supply missing-source rejection; the final actual container must still be inspected for a read-only NAS mount.

- No DS925+ deployment, actual NAS data access, target-side preflight, DSM ACL/TLS configuration, or image publication occurred.
- Symlink/permission/Docker checks executed on real disposable Linux CI resources, not locally on Windows, where Docker is unavailable.
- NAS storage identity cannot be proven by directory existence alone. Operators must verify the intended mounted share/volume, readable/searchable ACLs, and absence of unintended nested submounts. Older kernels may not make nested submounts recursively read-only.
- The approved root/parents and NAS writers must be trusted. Hard-link provenance, privileged host/root replacement, concurrent external file mutation, and all remote filesystem timeout/error modes are not exhaustively protected/tested by these checks. Publish files immutably; use operational NAS/mount health checks. Do not assume the application can defend against a hostile host administrator.
- Already-sent HTTP status cannot be rewritten after a late read error. The transfer is aborted, not marked complete or successfully audited. Post-transfer CouchDB audit failure cannot retract bytes; it is logged, with durable delivery/retry left for separately scoped work.
- The 29 dependency vulnerabilities remain unchanged. No automatic upgrades or audit fixes were performed.
- Original CouchDB authentication, administrator bootstrap policy, and Redis session handling were retained. No volumes were deleted, production credentials changed, PR merged, or unrelated staged/user data modified.

References: [Node 22 filesystem semantics](https://nodejs.org/docs/latest-v22.x/api/fs.html), [Compose bind syntax](https://docs.docker.com/reference/compose-file/services/), [Docker bind-mount behavior](https://docs.docker.com/engine/storage/bind-mounts/), [Synology Compose-based project worker](https://help.synology.com/developer-guide/resource_acquisition/docker-project.html).
