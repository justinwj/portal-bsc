# portal-bsc

Release-1 internal file portal scaffold for a Synology NAS deployment. This is intentionally constrained to secure SSR login, file access, and admin management without public self-service or external integrations.

## Features in scope
- Login page at `/login`
- Session-based auth with Redis-backed Express session storage
- Protected dashboard at `/`, protected files list at `/files`
- File detail page at `/files/:id`
- Secure download endpoint at `/download/:id`
- Admin-only user management for creating and disabling users
- Roles: `admin` and `member`
- Audit logging for login failures/successes and downloads
- Health endpoint at `/healthz`
- NestJS app listens on port 3000, suitable for Docker + Nginx reverse proxy

## Important notes
- This is a constrained R1 scaffold. It intentionally does not implement public registration, password reset, or broad feature expansions.
- Real files are stored in the NAS filesystem path defined by `NAS_FILES_DIR`; only a secure app-side download route exposes them.
- Raw NAS paths and user-controlled file names are never exposed to the browser.
- CouchDB is used for user metadata, file metadata, and audit records. In a local or dev environment without a live CouchDB, the app falls back to an in-memory store so the project can still compile and run in a limited sandbox.

## Local development
1. Copy `.env.example` to `.env` and adjust secrets.
2. Start Redis and CouchDB locally, or use Docker Compose.
3. Install dependencies:
   `npm install --legacy-peer-deps`
4. Start the app:
   `npm run start:dev`
5. Seed the first admin user:
   `npm run seed:admin`
6. Open the app at `http://localhost:3000/login`.

Default login values from `.env.example` are intentionally simple for local development only. Change them before deployment.

## Production deployment notes
- Use a reverse proxy in front of the app, such as Nginx.
- Place the NAS file repository under a dedicated directory and mount it in the container.
- Keep `SESSION_SECRET`, `ADMIN_PASSWORD`, and other secrets in the deployment environment rather than in the repository.
- Ensure CouchDB and Redis are network-accessible from the app container.

## Docker example
The repository includes:
- `Dockerfile`
- `docker-compose.app.yml`
- `nginx/portal.conf`

Example build:
`docker build -t portal-bsc .`

Example run:
`docker run --rm -p 3000:3000 --env-file .env portal-bsc`

## Admin bootstrap
The initial admin is created by the seed script:
`npm run seed:admin`

## Security checklist
- Passwords are hashed with bcrypt.
- Login and admin form submissions include CSRF tokens.
- Helmet and rate limiting are enabled.
- Every file request is authorized before allowing the download.
- File path access is sanitized before reading the NAS file.
- Public registration is disabled.

## Known limitations
- This is a release-1 scaffold intended to fit small NAS deployments; it does not implement a full RBAC UI or advanced audit retention policy.
- CouchDB and Redis must exist in the deployment environment; they are required production dependencies.
