# Development build, watch and Rider debugging

Use Node 22 (minimum 22.23.4) and npm 10.9.9. Use the project's TypeScript package in Rider. No global Nest CLI or additional watcher dependency is needed. Production startup and bootstrap remain `npm run start` and `npm run seed:admin:prod` after building.

| Command | Behavior |
| --- | --- |
| `npm ci` | Reproducible installation; no legacy peer flags |
| `npm run typecheck` | Check application and all TypeScript tests without emission |
| `npm run build` | Clean the repository's real dist directory and compile production source; exclude test files and emit nothing on errors |
| `npm run start` | Run dist/main.js |
| `npm run start:dev` | Compile, launch, watch, and replace the owned development application after complete successful builds |
| `npm run start:debug` | Same lifecycle with source maps and inspector at 127.0.0.1:9229 |
| `npm run start:debug -- --inspect=9230` | Select a predictable alternative loopback inspector port |

The development runner watches TypeScript through its compiler API. Each successful generation is emitted to a private, complete snapshot below `tmp/portal-dev-*`. An application keeps using its immutable snapshot while compilation is in progress. A serialized coordinator waits for the old process tree to terminate before starting the latest complete generation. Superseded builds are discarded; identical emitted bytes do not restart the application. Source maps point back to the original TypeScript.

Compilation errors stop the old application and launch nothing; correcting them rebuilds and starts automatically. A runtime crash is reported and a subsequent valid edit can restart it. An occupied inspector port is reported rather than silently launching an undebuggable process. Public inspector addresses are rejected.

The runner prints `[portal-dev]` events for compiling, compiled, compile-error, started, stopped, runtime-exit, startup-error, idle and shutdown. `started` identifies the application PID and its owner PID, not HTTP readiness; the application's listening message indicates readiness. Normal interruption closes the compiler watcher, terminates the owned tree, and removes private snapshots. A separate, undebugged IPC ownership guard terminates the application tree if the watcher disappears, even while the application is paused in a debugger. Unix uses an owned process group; Windows uses taskkill on the owned PID and its tree. No unrelated Node processes are selected or terminated. Never detach application descendants into independently managed services from the development runner.

Force-killing the entire tree can prevent every filesystem cleanup handler from running. Processes and ports must still be released; an ignored `tmp/portal-dev-*` directory may remain after such a termination. Prefer normal Ctrl+C or the runner's stop signal. After verifying no development runner is active, leftover private snapshot directories can be removed manually; the runner does not delete another session's directories automatically.

Build output is a generated directory. The production cleaner refuses an external output path or symlinked dist. Runtime views/public handling is unchanged: development uses the repository working directory and Docker copies those assets explicitly.

## Rider acceptance — Justin must execute and record these checks

Automated tests exercise Windows/Linux compilation, process cleanup, inspector attachment and TypeScript source maps. They do not operate Rider's GUI. The following interactive checks remain required; they have not been claimed as passed.

1. In Rider, select the project Node 22 interpreter and project `node_modules/typescript`. Open a terminal at the repository root. Run `npm ci`, `npm run typecheck`, and `npm run build`. All should exit zero. Avoid a second IDE compiler writing the same generated output.
2. Use real **local development** Redis/CouchDB credentials if available. For a login-page-only check without services, set these variables in that terminal (process-local, without editing .env or production credentials):

   ```powershell
   $env:NODE_ENV = 'development'
   $env:ALLOW_IN_MEMORY_SESSION_STORE = 'true'
   $env:COUCHDB_URL = 'http://127.0.0.1:5984'
   $env:COUCHDB_USER = 'rider-local-test'
   $env:COUCHDB_PASSWORD = 'TemporaryRiderTest123'
   $env:NAS_FILES_DIR = Join-Path $PWD 'tmp/rider-files'
   $env:PORT = '5300'
   npm run start:dev
   ```

   Open `http://localhost:5300/login`. Development-only database/session fallback may be used for this page check; bootstrap still requires authenticated persistent CouchDB. Do not attempt to seed a persistent administrator into an in-memory fallback.
3. Temporarily change the login page title string in `src/auth/auth.controller.ts`, save, and check the ordered `compiled`, `stopped`, and `started` messages and changed page title. Introduce a temporary TypeScript type error: expect diagnostics and no application listening. Undo those temporary edits: expect automatic recovery. Restore the source through Rider's undo operation, preserving other work.
4. Stop with Ctrl+C. Run `npm run start:debug -- --inspect=9230` with the same terminal environment. Expect `Debugger listening on ws://127.0.0.1:9230/...`. In Rider, create **Attach to Node.js/Chrome** with host `127.0.0.1`, port `9230`. Set a breakpoint in `AuthController.loginPage`, then request `/login`. Confirm the breakpoint resolves to the original `.ts` source and local variables are available. Resume, save a valid edit, reconnect if required, and verify the breakpoint in the replacement process. Undo the edit.
5. Create an npm run configuration for `start:debug` with working directory at the repository root and the same temporary development variables. Put `-- --inspect=9230` in its npm arguments field so npm forwards the port option to the runner. Stop it using Rider's Stop button. Also repeat a terminal Ctrl+C stop. Verify no listeners remain:

   ```powershell
   Get-NetTCPConnection -LocalPort 5300,9230 -State Listen -ErrorAction SilentlyContinue
   ```

   Expect no rows. Repeat start/stop once and confirm both ports can be reused. Record pass/fail for terminal use, recompilation/recovery, debugger attachment, source breakpoints, restart/reconnection and run-configuration cleanup. Report any failure before approving this workflow for routine development.

Keep inspector binding on loopback and use the approved Node 22 runtime. Native TypeScript stripping or Node watch alone does not replace metadata-preserving compilation and coordinated lifecycle management. No .idea files are supplied or overwritten by this workflow.
