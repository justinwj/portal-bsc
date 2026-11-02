# DS925+ configuration and administrator bootstrap

These are requirements for a future, separately approved deployment. Session 4 did not connect to or deploy on the DS925+. CI verified the production image and Compose stack using disposable resources, not the NAS.

## Credentials and environment

Keep the real `.env` outside source control, with access limited to the deployment operator. `.env.example` intentionally leaves secrets blank; it is not a runnable production configuration until they are supplied.

Required runtime values are `SESSION_SECRET`, `COUCHDB_USER`, and `COUCHDB_PASSWORD`, plus the Redis/CouchDB URLs and NAS file path. Production Compose sets the internal service URLs and container file path. Generate independent strong secrets for the session, CouchDB account, and Portal administrator.

Use a credential-free `COUCHDB_URL` such as `http://couchdb:5984` and supply `COUCHDB_USER` / `COUCHDB_PASSWORD` separately. The same pair is passed to CouchDB and the application. CouchDB's administrator is a database service account; it is distinct from a Portal administrator stored in `portal_users`.

For compatibility, a complete credential pair in a legacy `COUCHDB_URL` remains supported when neither separate variable is set. If either separate variable is present, both must be nonempty and they take precedence over the URL credentials. Partial pairs fail rather than silently using the embedded pair. New installations should use the separate variables.

Production requires database credentials, rejects malformed configuration, and propagates database readiness failures. Bootstrap requires persistent, authenticated CouchDB even in development/test mode. An in-memory database is never a successful bootstrap target. Production Compose also forces `ALLOW_IN_MEMORY_SESSION_STORE=false`.

`ADMIN_USERNAME`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` are bootstrap inputs, not required runtime settings. The bootstrap password must satisfy the existing user DTO policy: at least eight characters, uppercase, lowercase, and a digit. The email must be valid and the username nonblank. Bootstrap has no default password.

## Persistent mounts

Use a stable Compose project name, for example `portal-bsc`, so future container recreations select the same project-scoped named volume.

| Source | Container destination | Requirement |
| --- | --- | --- |
| Named volume `couchdb_data` (normally `portal-bsc_couchdb_data` for that project) | `/opt/couchdb/data` | Retain through restarts/recreation; back up and protect this volume |
| Repository `couchdb/single-node.ini` | `/opt/couchdb/etc/local.d/20-portal-single-node.ini` | Read-only configuration mount; make the file readable by the container user |
| `NAS_FILES_HOST_PATH`, e.g. `/volume1/docker/portal-bsc/files` | `/var/lib/portal-bsc/files` | Set to the actual approved NAS file directory; do not replace existing files |

The example `/volume1` paths must be adapted to the actual NAS storage layout. Do not assume a named Docker volume lives in that shared folder: inspect its mount information through Container Manager/Docker and arrange backups for its actual storage location.

CouchDB runs as its native UID/GID `5984:5984`. A manually provisioned bind directory must already allow that identity to write the database files, and the configuration file must be readable. The image's root entrypoint performs ownership changes; running as the native identity avoids trying to change ownership on the read-only configuration mount.

If an explicit Synology shared-folder bind is chosen **before initial deployment**, a separately reviewed override could replace the data mount with:

```yaml
services:
  couchdb:
    volumes:
      - /volume1/docker/portal-bsc/couchdb:/opt/couchdb/data
```

This optional NAS bind override and its ACLs were not executed or verified on the DS925+. Do not switch a populated deployment to an empty named volume or bind directory. Migration requires a verified backup/restore procedure and explicit approval. Do not delete the retained volume or use `docker compose down -v` as an operational restart procedure.

The committed single-node configuration creates CouchDB's system databases and uses one replica. It is for a single NAS service, not a multi-node CouchDB cluster.

## Networking and startup

Production Compose publishes no CouchDB or Redis host port. Keep both services on the Docker network; do not add public `5984`/`6379` bindings. Do not use `test/persistence/compose.ci.yml` on the NAS.

The application waits for Redis and CouchDB health checks, then initializes/verifies `portal_users`, `portal_files`, `portal_audit`, and `portal_downloads`. Database authentication/readiness failure aborts startup.

The reverse proxy must reach the app over the Docker network, or through an explicitly configured loopback-only app port if using a host-based Synology proxy. Preserve HTTPS forwarding and the production secure cookie settings. TLS, DSM reverse proxy settings, firewall rules, and NAS ACLs still need deployment-specific verification.

Once deployment has separate approval, validate the selected environment and mappings without printing the expanded secrets:

```sh
docker compose -p portal-bsc -f docker-compose.app.yml config --quiet
```

## Administrator initialization and collision policy

After the separately approved stack startup, supply the three bootstrap inputs through the protected initial environment and execute the compiled bootstrap in the app container:

```sh
docker compose -p portal-bsc -f docker-compose.app.yml exec -T app node dist/seed-admin.js
```

The command verifies CouchDB before reading or writing users. A fresh administrator is read back from CouchDB before success is printed. Failure returns a nonzero exit status and prints a failure message, never a creation/promotion success message.

The fail-closed collision policy was reported before implementation:

- An unused username can create a new active administrator.
- Repeating bootstrap for the same active administrator verifies the persisted account and preserves its password hash, email, role, and document revision. A newly supplied password is **not** a password reset.
- An existing non-administrator with that username causes failure. Its account, role, password, and email remain unchanged. Choose an unused bootstrap username or use a separately reviewed account-management procedure; there is no automatic promotion flag.
- An existing disabled administrator causes failure and remains disabled. Recovery must be explicit; bootstrap does not silently reactivate it.
- Invalid/missing inputs, unavailable CouchDB, and failed persistence verification cause failure.

Confirm a real administrator login using the intended stored password. After successful initialization, remove **all three** `ADMIN_*` entries from the protected runtime environment and recreate the app container through the approved operational procedure so the old environment is no longer retained in the process/container. Keep the administrator login secret in the organization's password manager; removing bootstrap environment variables does not change the CouchDB account record or its password.

Retain `COUCHDB_USER`, `COUCHDB_PASSWORD`, and `SESSION_SECRET` in protected runtime configuration because the application still needs them. Restore bootstrap inputs only for an explicitly approved bootstrap/recovery operation. Do not place real credentials in Git, CI, shell history, or documentation.

## Verification limits

CI proved initialization, records surviving CouchDB restart and container recreation with the same retained volume, retrieval through fresh application services, administrator bootstrap inside the production image, and login/file-list rendering after the app restarted. Cleanup retained the named volume and verified that it still existed.

This does not establish NAS filesystem durability under power loss, backups/restores, storage migration, DSM configuration, TLS operation, or multi-node resilience. The 29 previously reported dependency vulnerabilities remain for separate investigation.

References: [CouchDB single-node setup](https://docs.couchdb.org/en/stable/setup/single-node.html), [official image user/permissions](https://github.com/apache/couchdb-docker/blob/main/3.5.3/Dockerfile), [Docker Compose volumes](https://docs.docker.com/reference/compose-file/volumes/).
