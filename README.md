# portal-bsc

Release-1 internal file portal scaffold for a Synology NAS deployment. This is intentionally constrained to secure server-rendered login, file access, and admin management without public self-service or external integrations.

## Status

### Implemented
- NestJS + TypeScript server-rendered portal using Handlebars
- Session-based login, logout, protected dashboard, files list, and file detail pages
- Role-based access control for `admin` and `member`
- Secure file downloads with authorization checks before content is served
- Bcrypt password hashing and inactive-user blocking
- Helmet and rate limiting on HTTP entry points
- CSRF protection for SSR forms using `csurf` with session-backed tokens
- Redis-backed session storage in production mode
- Audit logging for login success/failure and downloads
- `/healthz` JSON health endpoint
- Dockerfile, Compose service snippet, and Nginx proxy example

### Partial / needs verification
- CouchDB-backed user/file/audit metadata is implemented via service abstractions and a fallback in-memory path for local development only.
- Production deployment should require a real Redis and CouchDB service; the app will fail fast if those are unavailable in production mode.

### Planned after R1
- Granular per-user or per-department authorization beyond role-based access
- Advanced audit retention and export
- Advanced file lifecycle management beyond the initial scaffold
- Password reset workflows

## Security model
- Sessions are server-side and stored in Redis in production.
- Cookies are secure and HTTP-only when running behind TLS or in production mode.
- The app never exposes raw NAS paths or user-supplied path segments.
- Access control is enforced server-side before a file is streamed to the browser.
- Public registration is intentionally disabled.

## Local development
1. Copy `.env.example` to `.env` and adjust values.
2. Ensure Redis and CouchDB are running.
3. Install dependencies:
   `npm install --legacy-peer-deps`
4. Start the app:
   `npm run start:dev`
5. Seed the first admin user:
   `npm run seed:admin`
6. Open `http://localhost:3000/login`.

## Production deployment notes
- Expect Redis and CouchDB to be internal services, not published publicly.
- Use Nginx in front of the app for TLS termination and reverse proxying.
- Set `SESSION_SECRET`, `ADMIN_PASSWORD`, and the other required values through environment variables or a deployment secret manager.
- For Synology NAS deployments, mount the NAS files directory into the container and point `NAS_FILES_DIR` to that location.

## Docker and reverse proxy
- `Dockerfile` uses a multi-stage build.
- `docker-compose.app.yml` is intended for app orchestration behind an internal network.
- `nginx/portal.conf` shows an example upstream service target of `http://app:3000` for Dockerized deployments.

## Admin bootstrap
Run:
`npm run seed:admin`

This will create an admin if one does not exist, promote an existing non-admin user to admin, or report that an admin is already present.

## Known limitations
- R1 is intentionally scoped to role-based authorization; it is not yet a complete per-user permission model.
- The app does not implement password reset or public signup.
