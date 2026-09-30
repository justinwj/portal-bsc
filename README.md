# portal-bsc

Security and operations foundation for an internal NestJS file portal.

## Local development

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy and update environment values:
   ```bash
   cp .env.example .env
   ```
3. Start in watch mode:
   ```bash
   npm run start:dev
   ```
4. Verify service health:
   ```bash
   curl http://127.0.0.1:3000/health
   ```

## Required environment variables

Set these values in `.env`:

- `NODE_ENV` (`development` | `test` | `production`)
- `APP_HOST` (default `0.0.0.0`)
- `APP_PORT` (default `3000`)
- `SESSION_SECRET` (long random secret)
- `SESSION_NAME` (default `portal.sid`)
- `SESSION_TTL_SECONDS` (default `86400`)
- `SESSION_REDIS_ENABLED` (`true` or `false`)
- `SESSION_REDIS_URL` (required when Redis sessions are enabled)
- `SESSION_REDIS_PREFIX` (default `portal:sess:`)
- `COOKIE_SECURE` (`auto` | `true` | `false`)
- `COOKIE_SAME_SITE` (`lax` | `strict` | `none`)
- `COOKIE_DOMAIN` (optional)
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `ADMIN_NAME`
- `ADMIN_SEED_OUTPUT_FILE` (default `data/bootstrap-admin.json`)

## Run the initial admin seed script

After setting `ADMIN_*` variables:

```bash
npm run seed:admin
```

This generates a hashed admin bootstrap record at `ADMIN_SEED_OUTPUT_FILE` for import into your user store.

## Security notes

- Global request validation is enabled with `whitelist`, `forbidNonWhitelisted`, and `transform`.
- Helmet is enabled with production HSTS and safe defaults for internal app compatibility.
- Session cookies are `httpOnly`, have environment-aware `secure` behavior, and configurable `sameSite`/domain.
- Redis-backed sessions are supported when `SESSION_REDIS_ENABLED=true`.
- Password hashing uses `argon2id`.
- Never commit real `.env` files or generated seed artifacts.
