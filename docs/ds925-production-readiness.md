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
| Required `NAS_FILES_HOST_PATH`, e.g. `/volume1/docker/portal-bsc/files` | `/var/lib/portal-bsc/files` | Existing approved directory, read-only bind, automatic host-path creation disabled |

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

## NAS file boundary and startup preflight

Production requires an explicit absolute `NAS_FILES_DIR` naming an existing readable and searchable directory. Startup rejects a missing, nonexistent, inaccessible, relative, or non-directory path. It never creates a production NAS directory and never requires write permission. Only development may create its configured/default files directory. Directory validation does not prove that the expected NAS volume/share is mounted: the operator must verify storage identity as well as path existence before deployment and after remounts.

The application serves only authorized regular files with literal single-component stored names. It rejects separators, traversal, drive/alternate-stream syntax, ASCII control characters, invalid Windows device-style names, malformed Unicode, and other unsafe names instead of rewriting them. All symbolic-link file entries are rejected, including links that stay inside the root. Metadata must name actual regular files published directly in the approved root, not subdirectories or symlink aliases.

Reads use a verified open file descriptor with read-only flags and `O_NOFOLLOW` where supported, canonical containment and file-identity checks, and bounded streaming buffers. The file is authorized before any file open. Missing/inaccessible/nonregular files produce controlled not-found responses; initial read errors produce a generic server error without exposing NAS paths. A later stream failure closes the incomplete response and keeps the process alive. HTTP status already sent with initial bytes cannot be retroactively changed, so a failed partial response is aborted rather than completed. A `file.download` audit denotes server-side transfer completion, not a mere attempt or proof that the client retained the bytes.

The NAS root and its parents must be controlled by trusted administrators. Keep published files immutable during downloads and use controlled publishing/replacement procedures. A read-only application mount prevents writes from the app, not modifications by other NAS clients or a privileged host administrator. Hard-link provenance, malicious host/root replacement, and snapshots against concurrent external modification are not established by the application. Audit writes remain separate post-transfer CouchDB operations: a persistence failure is logged server-side but cannot retract an already completed response. Transactional audit delivery/retries are not provided by this change.

### Container Manager compatibility

Synology's [Project worker documentation](https://help.synology.com/developer-guide/resource_acquisition/docker-project.html) confirms Compose-based project operation. The exact Container Manager/Compose version installed on this DS925+ is unknown and was not accessed in this session. The committed mount uses [standard Compose long bind syntax](https://docs.docker.com/reference/compose-file/services/#long-syntax-5):

```yaml
- type: bind
  source: ${NAS_FILES_HOST_PATH:?Set NAS_FILES_HOST_PATH to the existing NAS files directory}
  target: /var/lib/portal-bsc/files
  read_only: true
  bind:
    create_host_path: false
```

CI verifies both the authored safety settings and actual Docker behavior: a missing host path is rejected without creating it, existing fixture data is readable inside the production container, and writes fail with `EROFS`. Compose's normalized JSON may omit a false `create_host_path` value; its absence in that JSON is not a substitute for checking the authored setting and actual mount behavior.

Before a separately approved NAS deployment:

1. Check the installed `docker compose version` (or legacy `docker-compose version`) and validate the actual selected project configuration with `config --quiet`. Do not silently remove unsupported bind options or accept GUI conversion to a writable/auto-created mount.
2. Set an absolute `NAS_FILES_HOST_PATH` and independently check that it exists, is a directory, resolves to the intended storage, and is readable/searchable. Use the NAS storage view and, where available, `findmnt -T "$NAS_FILES_HOST_PATH"` / `readlink -f "$NAS_FILES_HOST_PATH"`; compare with the approved share/volume. Reading an already-approved existing file provides an additional identity check without creating any marker or replacement directory.
3. Use supported Compose long syntax. If a Container Manager version rejects or fails to preserve the options, stop that deployment and use an approved compatible Compose CLI or an explicit Docker Engine long `--mount type=bind,...,readonly` operation, which rejects missing sources. Do not fall back to short `-v` syntax that can create missing host directories.
4. As an equivalent manual preflight, run the following **read/access-only** probe using the reviewed application image and the explicit mount API. It does not create or write any NAS file; invalid/missing source paths must fail. Replace the image variable with the reviewed local image identifier:

   ```sh
   test -n "$NAS_FILES_HOST_PATH" && test -d "$NAS_FILES_HOST_PATH" && test -r "$NAS_FILES_HOST_PATH" && test -x "$NAS_FILES_HOST_PATH"
   docker run --rm --network none --read-only \
     --mount "type=bind,source=$NAS_FILES_HOST_PATH,target=/nas,readonly" \
     --entrypoint node "$PORTAL_IMAGE" -e 'const fs=require("fs");if(!fs.statSync("/nas").isDirectory())throw Error("Not a directory");fs.accessSync("/nas",fs.constants.R_OK|fs.constants.X_OK);let writable=false;try{fs.accessSync("/nas",fs.constants.W_OK);writable=true;}catch(error){if(error.code!=="EROFS"&&error.code!=="EACCES")throw error;}if(writable)throw Error("NAS mount is writable");'
   ```

5. Inspect the created application's mount configuration and require `RW=false` for `/var/lib/portal-bsc/files`. A preflight alone does not make a later differently configured container safe. Retain health/startup checks and fail closed if the expected storage is absent.

Docker's recursive read-only protection for nested submounts depends on the kernel. Do not assume an older NAS kernel makes every nested mount read-only: inspect any submounts, avoid them in the flat published-files root, or verify their protections separately. See [Docker bind-mount limitations](https://docs.docker.com/engine/storage/bind-mounts/). Actual DS925+ mount-option support, storage identity, kernel behavior, ACLs, and these manual commands still require target-side verification; CI does not substitute for it.

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
