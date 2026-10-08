## Mandatory Development Methodology — Test-Driven Development (TDD)

Effective immediately, use a **strict Test-Driven Development (TDD) workflow** for all new features, bug fixes, security corrections, and changes to existing behavior in Portal-BSC.

Follow the **RED → GREEN → REFACTOR** cycle:

1. **RED — Write the test first.**
   - Define the expected behavior.
   - Write a meaningful automated test before modifying production code.
   - Execute the test and demonstrate that it fails for the expected reason.
   - Do not use artificial failures or tests that cannot exercise the target behavior.

2. **GREEN — Implement the minimal correction.**
   - Make only the changes necessary to satisfy the failing test.
   - Run the targeted test and confirm it passes.
   - Run the existing test suite to detect regressions.

3. **REFACTOR — Improve without changing behavior.**
   - Improve code structure, maintainability, and clarity where appropriate.
   - Rerun the test suite after refactoring.
   - Preserve existing verified behavior.

### Testing requirements

- Use unit tests for business rules and isolated functions.
- Use HTTP integration tests for authentication, sessions, CSRF, authorization, and endpoint behavior.
- Use real Redis and CouchDB containers for dependency integration tests when the environment supports them.
- Do not substitute mocked dependency tests for actual Redis/CouchDB integration verification.
- Include negative tests covering unauthorized access, invalid input, unavailable services, and security failures.
- For existing untested behavior, add characterization tests before modifying it.

### Evidence requirements

For each corrected defect, report:

- Test name and file location.
- Initial failing test result (RED).
- Production code changes.
- Passing test result (GREEN).
- Final regression-suite results after refactoring.
- Any tests not executed, including the reason.

Never report a test as passed unless it was actually executed.

### Continuous Integration

Configure GitHub Actions to run dependency installation, compilation, automated tests, and appropriate integration tests on development-branch pull requests.

Do not request merging until the required checks pass.

### Scope

Keep all development within the original Portal-BSC Release-1 specification. Do not introduce unrelated features.

Follow these instructions throughout the remainder of development, not merely for the current correction pass.

***

## Portal-BSC — Implement GitHub Actions CI with TDD

Set up automated GitHub Actions Continuous Integration for the Portal-BSC project.

Read and follow `AGENTS.md` and `.github/copilot-instructions.md`, particularly the mandatory RED → GREEN → REFACTOR TDD requirements.

### 1. Create GitHub Actions workflow

Create `.github/workflows/ci.yml`.

Configure it to run automatically for:
- Pull requests targeting `master`.
- Pushes to the actual active development branch (discover its name first).
- Manual execution using `workflow_dispatch` when supported.

Use GitHub-hosted Ubuntu runners with Node.js 22 to match the project's Dockerfile.

### 2. Build and unit tests

Run:
- `npm ci`
- `npm run build`
- `npm test`

Fix the current test discovery configuration so every intended test is executed. A zero-test result must fail CI, not count as success.

Do not report passing checks if the test runner executes no tests.

### 3. Integration tests with real dependencies

Create a separate GitHub Actions integration-test job using temporary Docker service containers:

- Redis 7
- CouchDB 3

Use temporary test-only CouchDB credentials and an isolated test database.

Test:
- Redis-backed session creation, persistence, regeneration, and destruction.
- Login success and failure.
- Session revocation when an account is disabled.
- CouchDB authentication and initialization.
- Administrator creation and promotion.
- CSRF token acceptance and rejection.
- Authorization enforcement on file-detail and download routes.
- Rejection of path traversal and unauthorized file access.
- Application startup failure when required dependencies are unavailable.

Wait for service readiness before executing integration tests.

Ensure these tests use the real Redis and CouchDB clients and do not silently switch to an in-memory fallback.

### 4. Docker build validation

Add a job that verifies the production Docker image builds successfully from the repository's Dockerfile.

Verify that compiled artifacts and the production administrator-seeding entry point exist inside the image.

Do not deploy anything to the Synology NAS from CI at this stage.

### 5. Security and permissions

- Give GitHub Actions only the minimum permissions required, preferably `contents: read`.
- Never use production NAS, Redis, CouchDB, or administrator credentials in automated tests.
- Do not expose secrets in logs or workflow artifacts.
- Use temporary isolated test credentials.
- Avoid privileged pull-request workflow triggers.
- Keep production deployment separate from CI.

### 6. Preserve TDD

Continue following RED → GREEN → REFACTOR for every code correction.

Document the initial failing tests and final passing results. GitHub Actions must independently validate the final implementation.

### 7. Deliverables

Return:
1. The workflow filename and complete job descriptions.
2. The exact commit SHA.
3. All automated test results, including executed test counts.
4. A link to the GitHub Actions workflow run, if executed.
5. Any tests that remain unimplemented or unverified.
6. Recommended names of required status checks for branch protection.
7. Any manual GitHub configuration steps the repository owner must perform.

Do not merge the changes.

The goal is reliable automated verification of Portal-BSC before it is merged or deployed to the Synology DS920+.
