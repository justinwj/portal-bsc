# Session 7I application-only release candidate

**Proposal only. No NAS connection or deployment was performed. Separate review and deployment approval are required.** The owner reports source `4be77e23f1c3f5ab7930138a17c6b224017b7e14` deployed on DS920+ as portal-nginx, portal-couchdb, portal-redis and portal-app-1, all with zero published host ports. The current route is Tailscale HTTPS -> restricted Unix socket -> Nginx -> NestJS. These are supplied production facts, not Codex live verification. Do not reapply historical TCP preparation files.

## Release behavior and data boundary

- Confirmation status and the required checkbox reflect the persisted upload policy. Maximum/quotas are preserved. Failed validation does not revoke confirmation; an audit failure after a successful save reports the saved state honestly.
- HTML navigation on protected **page** handlers redirects to fixed `/login`. APIs, wildcard clients, downloads and mutations retain JSON authentication errors. Authenticated permission failures retain 403/404. Login success still goes to the dashboard; no user-controlled return URL is accepted.
- New managed uploads default to **All members**, with selectable Selected members or Private. All means current active approved accounts after login, never anonymous access. Existing legacy active accounts retain their established approved-account treatment. Selected members initially has no recipients until Manage sharing is saved. The owner alone manages visibility; switching away from Selected members clears IDs/version grants. Admins follow the same policy and non-owner administrator access remains audited.
- Selected grants are invalidated by recipient suspension/reactivation; All members admits currently eligible users with a fresh session. Owner suspension/closure blocks other accounts. After owner session-version revocation/reactivation, the owner must explicitly resave visibility to renew access. Files/quotas stay with the owner.
- Existing records remain `owner-acl-v1` and are not rewritten on read/startup. Old private records with recipients remain selected access. New records and effective owner sharing changes use `owner-acl-v2`; file IDs, payloads, hashes, journal format, storage UUID and ownership remain intact. An explicit change advances the normal CouchDB revision and durable audit outbox. No destructive migration runs.

## Rollback boundary — approval required before deployment

Retain the exact previously deployed image and protected configuration. The previous image's validator accepts only `owner-acl-v1`; it cannot correctly express the new policy. New records therefore carry a v2 access-model marker so old software fails closed rather than silently reinterpreting permissions.

**Before any v2 write:** reverting the app image alone is available after verifying no v2 records exist, using authenticated internal database inspection and the original protected configuration. Do not print secrets or all file documents. Even a synthetic acceptance upload creates v2, so do not assume a post-upload rollback remains available.

**After any v2 write:** do not downgrade, relabel records to v1, remove metadata, rewind CouchDB alone, delete uploaded files, or enable the old app for user mutations. Stop **only app**, retain every record/file/image/configuration, accept temporary Portal unavailability and use independent management while preparing a compatible roll-forward. A whole-system consistent restore would require separate recovery approval and preservation/review of every post-upgrade change; it is not an automatic app rollback. The old image is retained, but its ability to start after v2 writes is intentionally unsupported. This boundary is a material operational consideration for independent review. No old-image downgrade has been executed or certified here.

## Workstation preparation

Use the reviewed final commit and Node 22 production Dockerfile on White-Raptor/X1-Pro-Ai. Run tests/build/audits and retain the CI evidence. In a clean release checkout, build `linux/amd64` with an identifiable full-SHA tag, record immutable image ID/platform, save the image archive and calculate SHA-256. Retain the **old** image ID/archive as well. Follow the existing [workstation image procedure](ds920-production-preparation.md#workstation-build-and-offline-image-transfer-proposal); do not publish images or build on the NAS. Transfer/import remains a later approved administrator action.

## Proposed controlled upgrade

All NAS actions below are future operator steps, not authorization or execution in this session.

1. Privately verify the authoritative protected Compose/environment file list, project `portal`, existing `portal_default` ID, current image ID, container IDs/mounts and **empty bindings for all four services**. Keep the current working Tailscale hostname/certificate, Nginx socket/config, CouchDB data/config binds, Redis command and managed-storage identity unchanged. Never merge a historical TCP-publishing base or a new overlay introducing ports.
2. Verify a coherent recovery point covering CouchDB records **and effective authentication/configuration**, managed payloads/journals/storage marker and protected deployment settings. Quiesce writes by stopping app gracefully before capture. Use the owner's established verified backup procedure; do not copy a changing raw database as a consistency guarantee. If that procedure requires infrastructure maintenance, stop and obtain a separately approved plan. This app upgrade does not stop/recreate CouchDB, Redis or Nginx and does not alter backup jobs.
3. Verify/import only the reviewed workstation image archive, confirm checksum and full image ID. Keep the old image loaded. Change **only app's image selection** in the current protected deployment configuration. No new environment defaults, credentials, bootstrap command, storage UUID, bind or network setting is required.
4. Privately normalize the exact current file list and inspect all services for zero publications and unchanged mounts/network/credentials. Use `config --quiet` for logs; do not dump expanded secrets. The deployed configuration may already contain all four services; do not replace it with a repository sample simply to run this command.
5. Only after approval, use the following pattern with privately verified existing paths. If the authoritative project uses multiple files, use its existing approved file list, not a guessed one:

```sh
docker compose -p portal --env-file "$PORTAL_ENV_FILE" -f "$PORTAL_COMPOSE_FILE" stop app
# Capture/verify the coherent recovery point and select the reviewed app image.
docker compose -p portal --env-file "$PORTAL_ENV_FILE" -f "$PORTAL_COMPOSE_FILE" config --quiet
docker compose -p portal --env-file "$PORTAL_ENV_FILE" -f "$PORTAL_COMPOSE_FILE" up -d --no-deps --force-recreate app
```

6. Verify app JSON `/healthz` (status ok plus valid timestamp); a placeholder HTTP 200 is insufficient. Confirm the three infrastructure container IDs and network ID did not change and all four bindings remain empty. Inspect logs privately for errors without dumping credentials. Do not seed/rewrite accounts. Review rollback eligibility **before the first v2 upload or sharing change**.

## Manual acceptance checklist

- A new browser on another authorized computer opens `/`, lands on `/login` and reaches the dashboard after login. API requests retain JSON 401; member administration requests retain 403. Logout, CSRF and revoked/inactive sessions remain blocked appropriately.
- Confirmed upload policy renders checked after refresh and a fresh admin session. Unconfirmed renders unchecked. Quotas/max values match stored policy; invalid/omitted confirmation cannot revoke it. Review reported audit failures against persisted state before retrying.
- Review the All members default before uploading a non-sensitive synthetic file. A second approved account sees it, downloads exact bytes, and a newly approved account gains access without file changes. Anonymous/pending/rejected/disabled/closed accounts cannot inspect it.
- Choose Private and Selected members, grant/revoke recipients, switch among modes and confirm immediate access on subsequent requests. Returning to Selected members has no stale IDs. Confirm owner-only management and administrator auditing. Check legacy private/selected files without changing them.
- Restart **only app** after approval and verify policy, visibility, journals, quotas, hashes and legacy access. Do not claim NAS restart, browser/Rider or live acceptance from CI. Record actual manual results and retain previous images/recovery evidence.
- If verification fails, stop only app, leave all persistent state and infrastructure intact, and follow the rollback boundary above. Do not reopen HTTP/database ports, weaken CSP/cookies/guards or change Tailscale to recover availability.
