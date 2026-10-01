# portal-bsc

Local onboarding and development notes for `portal-bsc`.

## Local development

### First run
1. Install dependencies:
   - `npm install`
2. Create your local environment file:
   - `cp .env.example .env`
3. Start local backing services:
   - `docker compose -f docker-compose.local.yml up -d`
4. Start the app:
   - `npm run start:dev`
5. Seed the admin user:
   - Run the repository's existing seed-admin command/script after the app is configured.

### Environment variables
Use `.env.example` as the source of truth for local setup.

Required variables are documented in that file and include:
- App runtime: `HOST`, `PORT`, `NODE_ENV`
- Session/auth secret: `SESSION_SECRET`
- Data stores: `REDIS_URL`, `COUCHDB_URL`, `COUCHDB_USER`, `COUCHDB_PASSWORD`
- First-run bootstrap: `ADMIN_EMAIL`, `ADMIN_PASSWORD`

Development-only placeholders are clearly marked in `.env.example` and must be replaced for any non-local environment.

### Local service exposure note
`docker-compose.local.yml` intentionally publishes Redis and CouchDB for local development convenience only.
If you choose to publish an app port locally (for example `3000:3000`), treat that as local-only as well.
Do not treat published ports as production-safe defaults.

### Troubleshooting
- **App fails at startup with missing env errors**  
  Ensure `.env` exists and contains all required variables from `.env.example`.
- **Cannot connect to Redis/CouchDB**  
  Check containers with `docker compose -f docker-compose.local.yml ps` and inspect logs with `docker compose -f docker-compose.local.yml logs`.
- **Port already in use (3000/6379/5984)**  
  Stop conflicting processes or adjust local port mappings in `docker-compose.local.yml` and matching values in `.env`.
- **Admin seed fails**  
  Confirm the app is running, datastore containers are healthy, and `ADMIN_EMAIL` / `ADMIN_PASSWORD` are set before rerunning the seed-admin command.

## Synology production guidance
Production deployment guidance (including Synology-specific hardening, networking, and reverse-proxy setup) is intentionally separate from local onboarding.
This README keeps scope focused on local development only and does not define production deployment defaults.
