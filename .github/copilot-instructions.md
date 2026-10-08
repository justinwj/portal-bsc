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
