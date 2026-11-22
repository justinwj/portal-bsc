# portal-bsc

Internal file portal for a Synology NAS deployment, with secure server-rendered login, file access, administrator management, approval-controlled registration and account-closure requests.

## Status

### Implemented
- NestJS + TypeScript server-rendered portal using Handlebars
- Session-based login, logout, protected dashboard, files list, and file detail pages
- Role-based access control for `admin` and `member`
- Secure file downloads with authorization checks before content is served
- Bcrypt password hashing and inactive-user blocking
- Helmet and rate limiting on HTTP entry points
- CSRF protection for SSR forms with session-backed tokens
- Pending registration with administrator approval, account-deletion requests and retained-record closure
- Administrator lockout prevention, session revocation and account-workflow audits
- Persistent administrator capacity controls and metadata-based storage quota policy/reporting
- Opt-in streaming managed uploads with durable quota reservations, recovery and owner-selected sharing
- Private-by-default managed files, audited administrator grants and attachment-only Office downloads
- Download-only engineering/3D projects, scripts, media and intact ZIP bundles with bounded format inspection
- Redis-backed session storage in production mode
- Audit logging for login success/failure and downloads
- `/healthz` JSON health endpoint
- Dockerfile, Compose service snippet, and Nginx proxy example

### Partial / needs verification
- CouchDB-backed user/file/audit metadata is implemented via service abstractions and a fallback in-memory path for local development only.
- Production deployment should require a real Redis and CouchDB service; the app will fail fast if those are unavailable in production mode.

### Planned after R1
- Department/group sharing beyond the managed-file owner and selected-recipient model
- Advanced audit retention and export
- Advanced file lifecycle management beyond the initial scaffold
- Password reset workflows

## Security model
- Sessions are server-side and stored in Redis in production.
- Cookies are secure and HTTP-only when running behind TLS or in production mode.
- The app never exposes raw NAS paths or user-supplied path segments.
- Access control is enforced server-side before a file is streamed to the browser.
- Public registration creates inactive pending accounts; an active administrator must approve access as a member.
- Managed uploads require explicit administrator quota confirmation and separate writable storage. Legacy NAS mounts remain read-only. Administrators need an owner grant to access another user's managed file.
- Uploaded content remains untrusted; scheduled Synology scanning is not a scan-before-download guarantee.

## Local development
Use Node.js 22.23.4 or newer within the Node 22 major and npm 10.9.9. No global Nest CLI is required.

1. Copy `.env.example` to `.env` and adjust values.
2. Ensure Redis and CouchDB are running.
3. Install dependencies:
   `npm ci`
4. Start the app:
   `npm run start:dev`
5. Seed the first admin user:
   `npm run seed:admin`
6. Open `http://localhost:3000/login`.

`npm run build` creates a clean production build using TypeScript. `npm run typecheck` checks application and test TypeScript without emitting files. `npm test` includes the HTTP and build/watch/debug contracts; `npm run test:tooling` runs the tooling contracts alone.

The development runner launches only complete, error-free builds, stops on compilation errors, and recovers on correction. Debug with `npm run start:debug` (loopback port 9229), or `npm run start:debug -- --inspect=9230`. See the [development lifecycle and Rider acceptance checklist](docs/development-workflow.md).

## Production deployment notes
- Redis and CouchDB must have no published host ports, including loopback bindings. The owner verified their removal on the DS920+ on November 20, 2026; internal Docker-network access remains available.
- For DS920+, retain Tailscale HTTPS -> restricted Unix socket -> existing Nginx -> internal app. In Session 7I the owner reports all four deployed containers have zero published ports; Codex has not independently inspected the NAS. Use the [application-only upgrade guide](docs/session-7i-application-upgrade.md) for this candidate; do not reapply historical TCP preparation files. No Funnel or public forwarding; Portal separately requires an approved account.
- Set runtime secrets through protected environment variables or a deployment secret manager. `ADMIN_*` values are required only for explicit administrator bootstrap and should be removed from the runtime environment after verified initialization.
- Production requires an existing, readable/searchable NAS directory; the app does not create a replacement and needs no NAS write access. Set `NAS_FILES_HOST_PATH` explicitly for the read-only Compose bind to `/var/lib/portal-bsc/files`; missing bind sources must fail.
- The current production proposal targets **jwj_NAS_1 (DS920+)**. Follow [DS920+ preparation, backup, rollback and acceptance](docs/ds920-production-preparation.md); preserve its existing `portal` project and populated CouchDB bind mounts. Preparation is not deployment approval. DS925+ offsite backup/disaster recovery is deferred to **R2**; verify existing R1 backups. Its [older readiness guide](docs/ds925-production-readiness.md) is historical deployment guidance.
- Use [Managed uploads, sharing and recovery](docs/managed-uploads.md) for the opt-in `docker-compose.uploads.yml`, verified non-root UID/GID, storage marker, quota confirmation, scheduled antivirus and backup checks. Existing directories and explicit host paths are required; no NAS deployment is performed by this change.

## Docker and reverse proxy
- `Dockerfile` uses a multi-stage build.
- `docker-compose.app.yml` is intended for app orchestration behind an internal network.
- `nginx/portal.conf` is a server-block example. The [original configuration review](docs/ds920-existing-configuration-review.md) preserves existing mounts/identities. [Tailscale preparation](docs/tailscale-deployment-preparation.md) provides a fail-closed, offline-rendered proxy template; it is unselected until actual compatibility, source and backend restriction checks pass. Production login is not ready over the routing-only HTTP candidate.

## Admin bootstrap
For registration approval, account deletion requests, retained records/files and workflow audits, see [Registration and account lifecycle](docs/account-lifecycle.md). See [Capacity and quota controls](docs/capacity-and-quotas.md) for active-user enforcement, decimal-GB policy/reporting and the explicit bootstrap exception. Managed uploads enforce confirmed per-user/global quotas at reservation and finalization; [the upload guide](docs/managed-uploads.md) documents scope and recovery limits.

For disabling and reactivating accounts, administrator lockout prevention, session revocation, audit failures, and the single-instance concurrency boundary, see [Administrator account safety](docs/administrator-accounts.md).

Run:
`npm run seed:admin`

Supply valid `ADMIN_USERNAME`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` inputs plus authenticated CouchDB configuration. Bootstrap verifies persistent CouchDB and either creates/verifies a new administrator or preserves the same existing active administrator and its password. **Member username collisions are rejected, never automatically promoted.** Disabled administrators require explicit recovery. Repeating bootstrap is not a password reset.

Remove all three bootstrap inputs from the runtime environment and recreate the app container after verifying login. Keep the administrator login secret separately; retain required CouchDB/session runtime secrets. See the [bootstrap policy](docs/ds925-production-readiness.md#administrator-initialization-and-collision-policy).

The [restricted Unix-socket preparation guide](docs/unix-socket-deployment.md) records the historical transport procedure. Never restore the earlier localhost-published HTTP/database paths: they had a confirmed bypass. Preserve the owner's current protected deployment and reverify isolation during any separately approved application upgrade.

## Known limitations
- Legacy NAS files use role-based authorization; new managed uploads default to All members, with owner-controlled Selected members or Private access. Department permissions and anonymous links are not implemented.
- The app does not implement password reset. Public registration requires administrator approval.
- One application writer is supported. Actual DSM ACLs, antivirus scheduling, backup restore and interactive Rider/Office acceptance still require operator verification.

For Session 7I browser authentication, persisted upload-policy confirmation, visibility compatibility and the application-only upgrade/rollback boundary, see [the release candidate guide](docs/session-7i-application-upgrade.md). No automatic NAS deployment is authorized.
