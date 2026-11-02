# Development session 4: CouchDB readiness, persistence, and administrator bootstrap

## Scope, commits, and preservation

Repository: `justinwj/portal-bsc`; branch: `codex/portal-bsc-r1-fixes`.

- Starting reviewed commit: `aa919ce1d487ef9bf7fa046de9ed7fc35b6e5474`.
- RED test/CI commit: `b54ef9a4a1c231b1922012f4481f2f98a57769e0`.
- Authentication/bootstrap correction: `96a5f8592bd01c984f24c12040d71f99b00d4022`.
- Persistent Compose configuration: `543547298fb2cb7d291288db17f7e5b72c66fd51`.
- GREEN container startup correction: `202b90553a462c8af771fd856e4e7d97040acecb`.
- Final tested implementation/configuration SHA after refactoring: `b02774a3ea92c62f28c5dc17fbe9c04aeb7b930a`.

This report is a documentation-only follow-up. Its commit SHA and completed workflow link are supplied in the session completion message. It contains the same tested application and configuration.

Read and followed `AGENTS.md` and `.github/copilot-instructions.md` from `origin/master`. No change was made to `master`. All commits/pushes were restricted to the authorized branch. The three existing staged `.idea` entries were excluded from every commit and remain staged. The original SHA256 hashes of `.idea/.gitignore`, `.idea/encodings.xml`, `.idea/indexLayout.xml`, and `.idea/vcs.xml` were preserved.

## Baseline verification

Starting branch/HEAD matched the requested reviewed commit. No production code was changed during baseline verification.

Local environment: Windows PowerShell, Node.js `v24.19.0`, npm `11.17.0`, Git `2.45.1.windows.1`; Docker unavailable.

| Baseline check | Actual result |
| --- | --- |
| `npm ci` | Exit 0; 441 installed, 442 audited |
| `npm test` | 37 passed, 0 failed, 0 skipped |
| `npm run build` | Exit 0 |
| Reviewed commit's GitHub Actions tests | 37 unit/HTTP + 11 real dependency tests passed |

The reviewed [baseline run 41385918789](https://github.com/justinwj/portal-bsc/actions/runs/41385918789) and its actual test-job logs were inspected again in Session 4.
The audit still reported 29 vulnerabilities (4 low, 15 moderate, 9 high, 1 critical). No dependency upgrades or audit fixes were performed; `package-lock.json` is unchanged.

## Administrator policy reported before implementation

The proposed fail-closed policy and its implications were reported before changing production behavior:

- A collision with an existing member account fails with a nonzero bootstrap exit; no promotion, password change, email change, or account rewrite occurs.
- Repeating bootstrap for the same active administrator preserves the existing account and password. Supplying a different bootstrap password does not reset the account.
- Disabled administrators require explicit recovery and remain disabled.
- Runtime startup does not require bootstrap credentials after initialization; the bootstrap command itself still requires valid inputs and persistent authenticated CouchDB.

The original unit characterization that expected automatic promotion was intentionally replaced with `user service seed admin rejects non-admin collisions without modifying the account`. This is an authorized policy change, not a weakened assertion: the test now asserts rejection, zero writes, and preservation of the original account. Before production changes, its targeted run failed with `Missing expected rejection`; the complete local suite was 36 passed / 1 failed. Other existing unit/HTTP and dependency assertions were retained.

## RED evidence

Added real-service tests before modifying application behavior. The initial GitHub run executed:

| RED suite | Actual result |
| --- | --- |
| Existing unit/HTTP | 37 passed, 0 failed |
| Dependency integration | 30 tests: 17 passed, 13 failed, 0 skipped |
| Production Docker build | Passed |
| Initial Compose/persistence suite | 4 failed, 0 passed |

The original 11 dependency tests passed. Thirteen of the 19 new production authentication/bootstrap tests failed.

Observed defects and causes:

1. **Separate CouchDB credentials ignored.** `authenticates and initializes all four databases using separate environment credentials` failed with `CouchDB readiness check failed: You are not a server admin.` Production application startup with the same valid separate credentials also failed. Only URL-embedded credentials were used.
2. **Incomplete/invalid explicit credentials ignored when a legacy URL was valid.** The application kept running instead of rejecting those overrides; the negative startup tests reached their timeout.
3. **Failed initialization incorrectly marked ready.** A second `initialize()` call succeeded after the first authentication failure (`Missing expected rejection`). The ready flag was set before the database check.
4. **Malformed production configuration could create in-memory records.** The constructor swallowed the configuration error, leaving storage methods on the local Map path (`Missing expected rejection`).
5. **Fresh administrator bootstrap did not initialize databases.** The first bootstrap on a fresh disposable service failed with CouchDB `not_found` because the CLI skipped `initialize()`.
6. **Unsafe bootstrap success/input handling.** The CLI promoted member collisions, reported disabled administrators as present, accepted invalid email/weak passwords, and could report creation in the nonproduction memory fallback.
7. **Bootstrap secrets unnecessarily required for runtime startup.** Startup without `ADMIN_*` inputs failed even though those inputs should be needed only by bootstrap.
8. **Production Compose lacked CouchDB administrator configuration and persistent storage.** Its initial tests failed on the missing administrator environment. An additional independent volume assertion was then executed before changing Compose and failed with `Production CouchDB must use a persistent named volume`.

No failing assertion was disabled to obtain green results.

## GREEN implementation and results

### CouchDB authentication and readiness

`src/config/couchdb.configuration.ts` is shared by production environment validation, the CouchDB provider, and bootstrap. It requires a production URL and credentials, supports separate `COUCHDB_USER`/`COUCHDB_PASSWORD`, and retains complete legacy URL-pair compatibility when neither separate variable is present. A partial explicit pair is rejected; a complete explicit pair takes precedence. Credentials are removed from the client URL and passed as HTTP authentication.

Production constructor/configuration errors now propagate. Initialization is not marked successful after a failed persistent readiness check. Bootstrap can explicitly prohibit local fallback in every environment. CouchDB requests have a bounded timeout.

The 19 new production authentication/bootstrap tests passed in the first application correction run, as did the six existing CouchDB tests. Five Redis tests were cancelled in that run's setup because the expanded invalid-auth cases triggered CouchDB's real username/IP lockout for the shared CI account. That was test interference, not a hidden application pass: the workflow remained failed. Repeated-negative initialization requests were moved to a unique invalid identity; all rejection/write-failure assertions remained unchanged, and production lockout settings were not weakened. The existing wrong-password tests remained intact.

### Administrator initialization

The CLI now requires explicit bootstrap inputs, verifies persistent CouchDB before seeding, and has no default administrator password. `UsersService.seedAdmin()` applies the existing user DTO validation, refuses member collisions and disabled accounts, preserves repeated active-administrator records, and reads a newly created administrator back from CouchDB before returning success. Only verified creation/already-present messages are printed. Failures exit nonzero without a success message, and error output avoids dumping full request/error objects.

Runtime production validation no longer requires `ADMIN_*`; all other required runtime configuration remains enforced. `.env.example` leaves actual secrets blank.

### Persistence and container startup

Production Compose now passes matching required CouchDB credentials to the application and database, uses the named volume `couchdb_data` at `/opt/couchdb/data`, publishes no CouchDB host port, and waits for healthy Redis/CouchDB services. A read-only single-node configuration initializes system databases and uses one replica. The app's NAS host directory is explicitly configurable.

After storage configuration was added, Compose validation and the independent volume test passed, while three real stack tests failed because the CouchDB container exited before readiness. Inspection of the official image entrypoint indicated its root ownership-processing pass conflicted with the read-only config mount. Running the image as its native `5984:5984` user corrected startup; diagnostic logs are now collected before cleanup. This cause was inferred from the entrypoint source and verified by successful startup with that configuration.

The GREEN workflow then passed **37 unit/HTTP + 30 real-service + 5 Compose/persistence tests = 72 tests**, with no failures, cancellations, or skips. The production image built successfully.

## Persistence and bootstrap checks actually executed

The CI persistence project has a unique `portal-ci-*` name, test-only credentials, and loopback-only ports supplied by a CI override. Its `.env` is created exclusively (`wx`) on the disposable runner; an existing environment file is never overwritten. No NAS or user data is involved.

`test/persistence/persistence.test.ts` executed five tests:

1. `validates production Compose credentials, persistent storage, and private CouchDB networking`
2. `requires a persistent CouchDB data volume in production Compose independently of authentication`
3. `initializes a fresh production stack, bootstraps an administrator, and persists records`
4. `retains user, file, and audit records across a CouchDB restart`
5. `retains the same volume and records after container recreation and fresh application startup`

The checks compare actual Docker container IDs and mounted volume names, read user/file/audit documents after restart and forced recreation, verify all four application databases, and retrieve records through fresh CouchDB service instances. The administrator CLI runs inside the built production image. After the app process restarts, real HTTP login and file-list rendering verify the persisted administrator and metadata. Cleanup runs `compose down` without volume removal and then inspects the retained volume to verify it still exists. No test deletes a persistent volume.

`test/integration/00-production-couchdb.test.ts` adds 19 real-service tests covering separate/legacy credentials, valid startup, missing/incomplete/invalid credentials, retry/readiness failure, malformed production configuration, runtime without bootstrap secrets, first bootstrap in an empty database, repeated bootstrap, collision immutability, disabled administrator handling, missing username/email/password, invalid email, weak password, database unavailability, and rejection of nonproduction bootstrap fallback. First creation and repeated/collision cases verify persisted roles and password hashes in CouchDB, not just console messages.

## REFACTOR and final verification

After GREEN, readiness marking was consolidated after a successful check/allowed local fallback. Bootstrap now reuses its validated DTO and has simpler fail-closed account guards. Shared connection parsing prevents credential rules diverging between runtime validation, provider, and CLI. These changes preserved the established behavior.

The final implementation workflow executed both jobs successfully on Node.js `v22.23.4` / npm `10.9.9`:

| Final check | Actual result |
| --- | --- |
| `npm ci` | Passed |
| Unit/HTTP `npm test` | 37 passed, 0 failed/cancelled/skipped |
| Real dependency `npm run test:integration` | 30 passed, 0 failed/cancelled/skipped |
| Of those: original Redis tests | 5 passed |
| Of those: original CouchDB tests | 6 passed |
| Of those: new production authentication/bootstrap tests | 19 passed |
| `npm run build` | Passed |
| Production Docker runtime image build | Passed; not published |
| Compose/persistence/container smoke `npm run test:persistence` | 5 passed, 0 failed/cancelled/skipped |
| Final combined count | **72 passed, 0 failed, 0 cancelled, 0 skipped** |
| Local tests/build after refactor | 37 passed; build passed |
| Integration test TypeScript checking | Passed locally |
| `git diff --check` | Passed |

The test runner still fails on empty/all-skipped execution. No tests were skipped or assertions loosened to make the final workflow pass.

## Completed workflow evidence

| Stage | Completed run | Actual outcome |
| --- | --- | --- |
| Reviewed baseline | [41385918789](https://github.com/justinwj/portal-bsc/actions/runs/41385918789) | Existing 48 tests and image build passed |
| RED, `b54ef9a` | [41389856781](https://github.com/justinwj/portal-bsc/actions/runs/41389856781) | 37 unit/HTTP passed; dependency 17 passed / 13 failed; four Compose tests failed; image built |
| Authentication/bootstrap correction, `96a5f85` | [41390291218](https://github.com/justinwj/portal-bsc/actions/runs/41390291218) | 37 unit/HTTP passed; 25 service tests passed / 5 cancelled by account lockout; five Compose tests failed, including independent volume RED |
| Storage configuration, `5435472` | [41390561464](https://github.com/justinwj/portal-bsc/actions/runs/41390561464) | 37 + 30 passed; Compose 2 passed / 3 failed before database container readiness; image built |
| GREEN, `202b905` | [41390875520](https://github.com/justinwj/portal-bsc/actions/runs/41390875520) | Both jobs passed; 72 tests passed |
| Final refactor, `b02774a` | [41391290452](https://github.com/justinwj/portal-bsc/actions/runs/41391290452) | Both jobs passed; 72 tests passed |

Workflow job/step results and logs were inspected, including every intermediate failure. The documentation-only report push triggers another full verification; its completed run is included in the completion message.

## Files modified

- Production: `src/common/couchdb.service.ts`, `src/config/couchdb.configuration.ts`, `src/config/configuration.ts`, `src/config/env.validation.ts`, `src/users/users.service.ts`, `src/seed-admin.ts`.
- Production configuration/examples: `docker-compose.app.yml`, `couchdb/single-node.ini`, `.env.example`.
- Test/CI infrastructure: `.github/workflows/ci.yml`, `package.json` (scripts only), `scripts/run-tests.cjs`, `src/app.test.ts`, `test/integration/support.ts`, `test/integration/00-production-couchdb.test.ts`, `test/persistence/compose.ci.yml`, `test/persistence/persistence.test.ts`.
- Documentation: `docs/ds925-production-readiness.md`, `docs/development-session-4.md`.

## DS925+ requirements and remaining limitations

See [DS925+ configuration and bootstrap procedure](ds925-production-readiness.md) for the exact environment contract, stable project/volume naming, administrator policy, secret removal procedure, and optional bind mapping.

Retain the CouchDB data volume at `/opt/couchdb/data`. Map the approved NAS file directory through `NAS_FILES_HOST_PATH` to `/var/lib/portal-bsc/files`. Keep the single-node config readable and read-only, and provide database-directory write permissions for UID/GID `5984:5984`. Example `/volume1/docker/portal-bsc/...` paths must be adapted to the actual NAS. Keep CouchDB/Redis ports private; configure the reverse proxy separately. Remove all three `ADMIN_*` inputs and recreate the app container after verified initialization, retaining the login secret in the organization's password manager and retaining required database/session secrets in protected runtime configuration.

- Docker/real-service/persistence tests could not run locally; they were executed against actual disposable services and the production image on GitHub Actions.
- No DS925+ deployment, DSM/ACL/TLS configuration, NAS storage migration, power-loss durability test, or backup/restore test was performed. The optional NAS bind override is documented, not verified on the NAS.
- Intermediate lockout caused five cancelled tests; the corrected runs executed all of them successfully. Earlier persistence failures did not prove restart/recreation, but the GREEN and refactor runs did.
- No remaining defect was demonstrated by the covered tests. Concurrent competing bootstrap processes and every possible runtime outage are not exhaustively tested.
- The 29 dependency vulnerabilities remain unchanged for separate investigation.
- No production credentials were used or committed. No existing user data or unrelated staged files were modified, no volumes were deleted by tests, no image was published, and no pull request was merged.

Primary references: [CouchDB authentication lockout](https://docs.couchdb.org/en/stable/config/auth.html#chttpd-auth-lockout), [official image entrypoint](https://github.com/apache/couchdb-docker/blob/main/3.5.3/docker-entrypoint.sh), [CouchDB single-node configuration](https://docs.couchdb.org/en/stable/setup/single-node.html).
