# DS920+ original configuration reconciliation — 7H-A

**Preparation only. No NAS connection, deployment, credential change or production-data access occurred. Session 7H-B requires separate authorization.** This review uses Justin's supplied redacted Compose and complete placeholder nginx.conf. Those copies establish the intended configuration, not live network IDs, effective credentials or current image versions. The latest supplied DSM status is **unverified for Portal**; no hostname, certificate, destination rule or trusted source address is established. Earlier shorthand about no reverse proxy is not treated as a verified DSM inventory.

## Prepared files and exact changes

- [compose.infrastructure.yml](../deploy/ds920/compose.infrastructure.yml) is a **review reference** of the original three services. Images, names, restart policies, port bindings, Redis command and five bind sources/targets/access modes are preserved. Required protected environment references replace literal CouchDB credentials. Long bind syntax adds `create_host_path: false`, so missing sources cannot become empty replacement directories. These declaration changes must not be applied through a broad project recreation.
- [compose.app.yml](../deploy/ds920/compose.app.yml) adds only the custom `app` service: verified immutable locally loaded image, no NAS build/pull, no published host port, non-root UID/GID, explicit protected production configuration, initial healthcheck and two explicit binds. It **inherits `default`**, matching the supplied original network definition; the earlier separate external-network variable is removed.
- [nginx.http-proposal.conf](../deploy/ds920/nginx.http-proposal.conf) is the complete replacement **HTTP routing candidate** for the existing config file. It preserves `worker_processes auto`, `worker_connections 1024`, `listen 80` and the external **8088:80** mapping. Its only request location proxies through the keepalive upstream to **`app:3000`**, with streaming, bounded bodies, write retries disabled and sanitized forwarding headers. Logging still uses the existing log mount.
- [nginx.original-placeholder.conf](../deploy/ds920/nginx.original-placeholder.conf) records the supplied original handler for review/rollback. A private backup of the live file remains required before any approved change.
- The earlier [TLS-only candidate](../deploy/ds920/nginx.conf) is **unselected**. Do not copy it over the current HTTP config or introduce certificate mounts/listener changes before deciding HTTPS.

The application source, authentication/CSRF, quota/recovery rules and image Dockerfile are unchanged. No bootstrap command or administrator credential reset is part of adding app. Build on White-Raptor/X1-Pro-Ai and transfer only after separate approval, using the [immutable image procedure](ds920-production-preparation.md#workstation-build-and-offline-image-transfer-proposal).

For review-only Compose parsing, combine the infrastructure reference and app addition with project name **portal** and a protected environment file; use `config --quiet`, not expanded output. For any later **app-only** startup, prefer the protected original project file plus the app addition, explicitly targeting only `app` with no dependency recreation. Do not issue a bare full-project `up`, `down`, `--remove-orphans`, volume operation or build-on-NAS command. Keep the Container Manager project named **portal**, in `/volume1/docker/portal`, and review its persisted combined definition so later UI operations do not accidentally diverge.

## Existing binds and service identities

All five original binds remain as supplied:

| Service / unchanged identity | Host source | Container target | Access |
| --- | --- | --- | --- |
| nginx / `portal-nginx` | `/volume1/docker/portal/nginx/nginx.conf` | `/etc/nginx/nginx.conf` | Read-only |
| nginx / `portal-nginx` | `/volume1/docker/portal/files` | `/srv/portal-files` | Read-only; unused by both placeholder and proxy |
| nginx / `portal-nginx` | `/volume1/docker/portal/logs` | `/var/log/nginx` | Read/write; preserve permissions and rotation |
| couchdb / `portal-couchdb` | `/volume1/docker/portal/couchdb/data` | `/opt/couchdb/data` | Read/write; preserve populated data |
| couchdb / `portal-couchdb` | `/volume1/docker/portal/couchdb/config` | `/opt/couchdb/etc/local.d` | Read/write; preserve effective configuration |

Do not substitute a named CouchDB volume or change CouchDB's user/ownership/image/config mount. Keep `127.0.0.1:5984:5984` and `127.0.0.1:6379:6379`; these are existing host-loopback bindings, not public app endpoints. Redis remains `redis:7-alpine` with `redis-server --save "" --appendonly no`. Nginx's existing `depends_on` entries remain CouchDB and Redis; there is no new dependency declaration requiring its recreation.

The Nginx file-share mount is unnecessary for proxy routing, but removing it would require recreating the container. **Retain it now, unused and read-only.** No `root`/`alias` location is added. All downloads and metadata requests must reach NestJS authorization.

## Network verification

The supplied YAML has no explicit `networks`. With project name `portal`, the normal default-network name would be **`portal_default`**. Its actual name and ID remain **unverified**. Do not infer them from the directory/container names or create a parallel network to make a guessed name work. The app addition joins the original default network through Compose, and Nginx resolves the new service alias `app`; app resolves `couchdb` and `redis`. Host loopback addresses must not be used as dependency URLs inside app.

The following commands are a **future operator read-only checklist**, not executed by this session:

```sh
docker inspect --format '{{.Name}} project={{index .Config.Labels "com.docker.compose.project"}}{{range $name,$net := .NetworkSettings.Networks}} network={{$name}} id={{$net.NetworkID}}{{end}}' portal-nginx portal-couchdb portal-redis
docker network inspect <verified-network-name> --format '{{.Name}} {{.Id}} project={{index .Labels "com.docker.compose.project"}} network={{index .Labels "com.docker.compose.network"}}'
```

Require the same relevant network ID for the existing three services and matching `portal` / `default` Compose labels. Verify that the selected original file and `-p portal` resolve to this same network. If they do not, stop for a corrected, reviewed network plan; do not start app on a new default network. After separately approved app startup, verify its network ID/service alias and DNS connectivity before any Nginx reload. Do not dump complete container inspection output because it can include credentials.

## HTTP routing and outstanding HTTPS choices

For the prepared routing-only change: **no host-port change, TLS certificate mount, new Nginx container or container recreation is required**. Continue HTTP at NAS port **8088**, mapping to port **80** in `portal-nginx`. The proxy candidate rejects spoofed HTTPS claims by forwarding its actual scheme, `http`, rather than blindly accepting `X-Forwarded-Proto`. It keeps Secure cookies enabled in the app. Health/login HTML can route, but **plain HTTP does not provide production session authentication** and must not be accepted as production login verification.

Before authenticated production use, explicitly review:

| HTTPS option | Additional decisions / changes needed |
| --- | --- |
| DSM terminates HTTPS, then proxies to the current HTTP backend on 8088 | Verify/create an approved Portal rule, hostname, certificate and renewal; verify DSM's actual source address and overwritten headers; restrict backend access and test an explicit trusted-proxy policy before accepting forwarded HTTPS/client IP. No rule/address is assumed here. |
| Nginx terminates HTTPS | Approve hostname/certificate/renewal, least-privilege certificate mount and TLS listener/mapping. The earlier port-443 candidate does not match the existing 8088:80 mapping unchanged; port/mount changes would require separate container-maintenance approval. |

Do not force HTTPS headers on arbitrary HTTP requests, trust the whole LAN as a proxy, disable Secure cookies, add public backend ports or infer DSM's source as `127.0.0.1`/a Docker gateway. If DSM is selected, review client-IP rate-limit aggregation and upload/body/time limits as well. No DSM rule, certificate or router/private-access setting is changed in 7H-A. [Synology documents the DSM reverse-proxy configuration location and source/destination settings](https://kb.synology.com/en-my/DSM/help/DSM/AdminCenter/system_login_portal_advanced).

Verify that direct clients cannot be classified as the trusted DSM source. If the observed network path cannot distinguish them, header filtering alone is insufficient: review backend isolation or a different HTTPS topology. Any resulting published-address/mount change must receive explicit maintenance approval; it is not part of the container-preserving HTTP routing proposal.

Both prepared proxy alternatives retain the upstream keepalive correction and dynamic DNS; open-source Nginx **>=1.27.3** is required for `resolve`. Check the actual existing container version before selecting either candidate. CI tested a disposable current image, not the installed NAS image. If older, stop for a reviewed compatibility plan rather than upgrading/recreating the running container automatically. The 1,000,000,000-byte proxy ceiling remains; quotas are still enforced in app, with no change to the approved 1 GB recommendation.

## New app mounts, permissions and credentials

Only the new app adds these binds:

| Source | App target | Required state |
| --- | --- | --- |
| Existing `/volume1/docker/portal/files` | `/var/lib/portal-bsc/files` | Read-only; selected app UID/GID has read/search, no Portal write access |
| Administrator-selected dedicated managed root, not yet supplied | `/var/lib/portal-bsc/uploads` | Writable managed subdirectories only; must be separate from legacy/CouchDB/checkout and pre-exist |

Use verified non-root UID **and** GID. Root/parents/marker remain under trusted administration; app gets read/search root/marker and restrictive read/write/search on `staging`, `objects`, `quarantine` (initial 0700 / payload 0600, verified against DSM ACLs). Verify canonical paths, same-filesystem hard links/fsync, `.portal-storage.json` UUID matching CouchDB registration, explicit physical free-space reserve, quotas, startup reconciliation and backup/scanner access. Missing host paths must be rejected; nothing is provisioned during this session. See [managed storage requirements](managed-uploads.md).

Privately verify the existing **portaladmin** CouchDB credential against effective `[admins]` configuration, not just the redacted YAML. Preserve configuration/authentication files and the protected original definition together. Redaction establishes neither the actual password nor that it is a placeholder. The new environment template supplies no password; do not rotate or reset one. Verify any effective Redis authentication without changing the supplied command. Select/protect a production session secret under the reviewed deployment policy, and preserve any applicable existing secret. Never commit or print these values. Runtime app receives no `ADMIN_*`; do not seed/rewrite existing Portal users to make startup pass.

## In-place change and rollback plan — not executed

After 7H-B approval and prerequisite checks: take a coherent backup and private copies of the original YAML/config, record existing container IDs/mounts/network, start only app, and verify readiness/DNS. Keep Nginx's source bind, logs and 8088:80 unchanged. Updating a **single-file bind** must preserve the bound host file's inode: write content into the existing file rather than saving via an editor's atomic rename. Otherwise a container can continue seeing the old inode. Validate `nginx -t` inside the same `portal-nginx`; only after success reload its process. Do not recreate it to pick up a replaced file. The existing workers keep their loaded configuration if validation fails; restore original content before retrying.

Rollback restores the saved original file **in place**, validates and reloads the same Nginx process, returning the placeholder response on 8088. Stop only the newly added app gracefully and retain its container/image and managed bytes for investigation. The original three remain running with the same identities, database/config binds, logs, ports and Redis command. Keep all new database/audit/journal records; do not rewind CouchDB alone, delete volumes/files, run project `down`, reset credentials or remove the project. A code rollback is not irreversible data rollback.

## NAS-side acceptance still required

Live image/Nginx/Compose versions; same project/network IDs; actual effective credentials; all existing mount contents/ACLs; selected app UID/GID and new managed root/UUID/headroom; missing-path rejection; real DNS/readiness; final HTTPS/hostname/certificate/trust decision; Secure-cookie/CSRF/authenticated upload/download/share/quota acceptance; DS920+ Antivirus Essential coverage including extensionless objects; coherent DS925+ backup and representative restore; and an approved rollback rehearsal. No NAS-side check or deployment is claimed completed by the local configuration review or GitHub push.
