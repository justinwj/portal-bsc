# DS920+ configuration reconciliation

**Current owner evidence (November 20, 2026):** CouchDB/Redis have no published host ports, remote 5984/6379 are denied, readiness is ok/PONG and the existing network is portal_default. Nginx 8088 remains exposed. Codex did not connect to either NAS. Production authentication remains prohibited until the approved Unix migration and live verification succeed.

Use only [the complete Unix base](../deploy/ds920/compose.unix.yml) and [app overlay](../deploy/ds920/compose.app.yml), with zero publications for every service. Never merge the original TCP project or use it for rollback. [Current operations and rollback](unix-socket-deployment.md) supersede the historical 7H-A/B HTTP/DSM candidates.

## Prepared files and exact changes

The Unix base retains original service/container identities, populated database/config binds, authentication, Redis command and the default network. It removes all host publications and uses the restricted inherited Nginx socket. The app-only overlay preserves its non-root runtime, separate managed/legacy mounts and internal dependency URLs. The original infrastructure YAML and TCP Nginx examples remain explicitly historical test fixtures, not deployment profiles. Build/transfer remains workstation-only after separate approval. No app business logic, user record, credential or data migration changes here.

## Existing binds and service identities

All five original binds remain as supplied:

| Service / unchanged identity | Host source | Container target | Access |
| --- | --- | --- | --- |
| nginx / `portal-nginx` | `/volume1/docker/portal/nginx/nginx.conf` | `/etc/nginx/nginx.conf` | Read-only |
| nginx / `portal-nginx` | `/volume1/docker/portal/files` | `/srv/portal-files` | Read-only; unused by both placeholder and proxy |
| nginx / `portal-nginx` | `/volume1/docker/portal/logs` | `/var/log/nginx` | Read/write; preserve permissions and rotation |
| couchdb / `portal-couchdb` | `/volume1/docker/portal/couchdb/data` | `/opt/couchdb/data` | Read/write; preserve populated data |
| couchdb / `portal-couchdb` | `/volume1/docker/portal/couchdb/config` | `/opt/couchdb/etc/local.d` | Read/write; preserve effective configuration |

Do not substitute a named CouchDB volume or change CouchDB's user/ownership/image/config mount. CouchDB and Redis now have no published ports; keep them absent. Internal service ports 5984/6379 remain available through Docker DNS. Redis remains `redis:7-alpine` with `redis-server --save "" --appendonly no`. Nginx's existing `depends_on` entries remain CouchDB and Redis; there is no new dependency declaration requiring its recreation.

The Nginx file-share mount is unnecessary for proxy routing, but removing it would require recreating the container. **Retain it now, unused and read-only.** No `root`/`alias` location is added. All downloads and metadata requests must reach NestJS authorization.

## Network verification

The owner verified the existing **portal_default** membership of portal-nginx, portal-couchdb and portal-redis. Reverify and preserve its live ID and portal/default labels before later maintenance. The approved Unix base inherits that same default network and app joins it; do not create a parallel network or use localhost dependency URLs.

The following commands are a **future operator read-only checklist**, not executed by this session:

```sh
docker inspect --format '{{.Name}} project={{index .Config.Labels "com.docker.compose.project"}}{{range $name,$net := .NetworkSettings.Networks}} network={{$name}} id={{$net.NetworkID}}{{end}}' portal-nginx portal-couchdb portal-redis
docker network inspect <verified-network-name> --format '{{.Name}} {{.Id}} project={{index .Labels "com.docker.compose.project"}} network={{index .Labels "com.docker.compose.network"}}'
```

Require the same relevant network ID for the existing three services and matching `portal` / `default` Compose labels. Verify that only the approved Unix base plus app overlay and `-p portal` resolve to this same network. If they do not, stop for a corrected, reviewed network plan; do not start app on a new default network. After separately approved app startup, verify its network ID/service alias and DNS connectivity before any Nginx reload. Do not dump complete container inspection output because it can include credentials.

## Current HTTPS routing

Preserve the existing Tailscale hostname/certificate. The approved future path is Serve HTTPS -> restricted Unix socket -> Nginx -> internal app. Nginx must lose its host TCP publication; databases must remain unpublished. The live 8088 problem remains unresolved. No DSM reverse proxy, guessed peer address, permission broadening or TCP fallback is approved. Follow [Unix preflight and exact commands](unix-socket-deployment.md) under separate deployment authorization.

## New app mounts, permissions and credentials

Only the new app adds these binds:

| Source | App target | Required state |
| --- | --- | --- |
| Existing `/volume1/docker/portal/files` | `/var/lib/portal-bsc/files` | Read-only; selected app UID/GID has read/search, no Portal write access |
| Administrator-selected dedicated managed root, not yet supplied | `/var/lib/portal-bsc/uploads` | Writable managed subdirectories only; must be separate from legacy/CouchDB/checkout and pre-exist |

Use verified non-root UID **and** GID. Root/parents/marker remain under trusted administration; app gets read/search root/marker and restrictive read/write/search on `staging`, `objects`, `quarantine` (initial 0700 / payload 0600, verified against DSM ACLs). Verify canonical paths, same-filesystem hard links/fsync, `.portal-storage.json` UUID matching CouchDB registration, explicit physical free-space reserve, quotas, startup reconciliation and backup/scanner access. Missing host paths must be rejected; nothing is provisioned during this session. See [managed storage requirements](managed-uploads.md).

Privately verify the existing **portaladmin** CouchDB credential against effective `[admins]` configuration, not just the redacted YAML. Preserve configuration/authentication files and the protected original definition together. Redaction establishes neither the actual password nor that it is a placeholder. The new environment template supplies no password; do not rotate or reset one. Verify any effective Redis authentication without changing the supplied command. Select/protect a production session secret under the reviewed deployment policy, and preserve any applicable existing secret. Never commit or print these values. Runtime app receives no `ADMIN_*`; do not seed/rewrite existing Portal users to make startup pass.

## In-place change and rollback plan ? not executed

Follow the [safe Unix rollback](unix-socket-deployment.md#safe-rollback-and-independent-recovery). Preserve the config bind inode, restricted socket, all service identities, CouchDB binds/authentication, Redis command, managed files and audit history. Use only the complete Unix base plus app overlay. Roll back to the Unix placeholder and stop app if needed; never restore original TCP Compose, Nginx 8088 publication or database loopback publications. If Unix transport cannot work securely, stop Nginx and recover through independent management, accepting temporary HTTPS unavailability. No project removal, volume deletion, credential reset or data rewind is authorized.

## NAS-side acceptance still required

The owner supplied versions, database port-denial/readiness and portal_default membership; Codex did not perform those NAS checks. Actual socket/package ACL access, live network ID preservation, all-service empty bindings after migration, LAN/tailnet 8088 denial, certificate/user grants, restart persistence, later app authentication/sharing/quota acceptance, antivirus and coherent backup/restore checks remain gated. No app deployment or production acceptance is claimed.
