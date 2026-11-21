# Session 7H-C: remove the HTTP backend port

**Repository preparation only. Codex has not connected to or changed either NAS. Production authentication remains blocked until the Unix migration and live acceptance gates succeed under separate authorization.** This replaces the TCP-backend proposal in 7H-B. Neither Nginx nor either database may regain published host ports, including loopback bindings, during deployment or rollback.

## Evidence and selected transport

Justin supplied these live observations: DS920+ `jwj_NAS_1`, DSM 7.4.1-90080 Update 1, Container Manager 24.0.2-1707, Docker 24.0.2, Compose v2.20.1-6047-g6817716, Tailscale 1.104.7, Nginx 1.30.5. Project `portal` lives at `/volume1/docker/portal`. Serve background HTTPS at `https://jwj-nas-1.tailf9c3d1.ts.net` works; Funnel is off. NestJS is not deployed. Despite Docker inspection showing `127.0.0.1:8088:80`, a remote request to `http://100.84.136.19:8088/` returned the placeholder. These are owner-supplied observations, not tests performed by Codex.

**Owner update, November 20, 2026:** remote TCP tests initially reached 8088, 5984 and 6379 despite localhost database bindings. Justin removed both database `ports` declarations and recreated only those affected containers. Inspection now shows `/portal-couchdb {}` and `/portal-redis {}`; remote tests show 5984/6379 **False**, while 8088 remains **True**. CouchDB readiness returned `{"seeds":{},"status":"ok"}` and Redis returned `PONG`. The three existing containers share the verified network **`portal_default`**. This is verified production evidence supplied by the owner; Codex did not execute these NAS checks. Database publication must stay absent. **The live Nginx HTTP issue is not resolved.**

The proposed path is:

```text
authorized tailnet client -> HTTPS :443 / existing ts.net certificate
  -> NAS-host Tailscale Serve -> private host Unix socket
  -> existing portal-nginx identity -> app:3000 on original project network
```

Initially use **placeholder mode** with the existing three services. App mode is for a separately approved later fourth-container deployment. No Nginx host port or Nginx TCP listener remains in either mode. The canonical URL is configuration, not application code.

For later application readiness, require `/healthz` to return the application's JSON object with `status: "ok"` and a valid timestamp. HTTP 200 alone can come from the placeholder during a reload and does not establish that NestJS is ready or that login sessions work.

Version-specific evidence:

- [Tailscale 1.104.7 Serve CLI](https://github.com/tailscale/tailscale/blob/v1.104.7/cmd/tailscale/cli/serve_v2.go) accepts HTTP proxy targets `unix:/absolute/path`. [The backend implementation](https://github.com/tailscale/tailscale/blob/v1.104.7/ipn/ipnlocal/serve.go) rewrites a Unix backend's Host to `localhost` and supplies the original forwarded host, HTTPS scheme and client IP. This is HTTP Serve, not TCP forwarding or PROXY protocol.
- [Nginx 1.30.5 socket creation](https://github.com/nginx/nginx/blob/release-1.30.5/src/core/ngx_connection.c) chmods newly bound sockets to **0666**, overriding umask. Our disposable stock-image reproduction confirms this. Neither umask alone nor a later chmod satisfies the no-world-writable-socket requirement.
- [Nginx's inherited-socket mechanism](https://github.com/nginx/nginx/blob/release-1.30.5/src/core/nginx.c) and [listener matching](https://github.com/nginx/nginx/blob/release-1.30.5/src/core/ngx_cycle.c) allow a restricted pre-bound descriptor to be reused. The small `portal-socket` launcher binds with umask 077, sets root/verified-group ownership and 0660, listens, then execs the **unchanged** Nginx 1.30.5 executable. Nginx becomes PID 1; no extra long-running service or proxy hop is introduced. The new workstation-built image is a deliberate, reviewable change from the upstream image reference.
- [Docker port publishing](https://docs.docker.com/engine/network/port-publishing/) documents localhost restrictions on older engines. [Synology integration guidance](https://tailscale.com/docs/integrations/synology) describes its special networking environment. Userspace forwarding is consistent with the observed bypass, but its exact cause has not been independently diagnosed on this NAS. This solution removes the relevant published port regardless.

Alternatives reviewed: stock Nginx plus umask fails the permission requirement; post-start chmod leaves a permissive interval. Direct container-IP TCP targeting avoids a published port but creates address/route lifecycle dependencies and retains a TCP backend. A separate socket bridge adds another long-running component. Backend TLS requires another certificate/trust lifecycle. These are not implemented. If the preferred Unix path fails Synology compatibility checks, stop for architecture review rather than substituting one silently.

## Files and preservation

Use the **complete** `deploy/ds920/compose.unix.yml`. Nginx, CouchDB and Redis have **no `ports` declarations** or host networking. The only permitted overlay is `compose.app.yml`, which also publishes no ports. It preserves service/container identities, the existing default network, Nginx config/file/log binds, CouchDB data/config binds, authentication and the Redis command/nonpersistent session policy. It adds one existing-directory socket bind and socket health check. Never include the original TCP base or any publishing overlay: Compose 2.20.1 merges lists, and `ports: []` does not reliably remove inherited publications. Newer `!reset`/`!override` tags are not used.

Unchanged binds:

- `/volume1/docker/portal/nginx/nginx.conf` -> `/etc/nginx/nginx.conf`, read-only.
- `/volume1/docker/portal/files` -> `/srv/portal-files`, read-only; Nginx has no static-file location.
- `/volume1/docker/portal/logs` -> `/var/log/nginx`, existing permissions retained.
- `/volume1/docker/portal/couchdb/data` -> `/opt/couchdb/data`, existing contents retained.
- `/volume1/docker/portal/couchdb/config` -> `/opt/couchdb/etc/local.d`, existing authentication retained.

The later `compose.app.yml` retains its separate managed-upload writable bind, legacy NAS read-only bind, marker validation, quotas and recovery. Combine it **only with the approved complete Unix base**, never the original TCP project definition. App-to-database traffic uses `http://couchdb:5984` and `redis://redis:6379` internally on `portal_default`; these container ports are not host publications. No app logic, bootstrap policy, records, npm dependencies, database credentials or Redis behavior change. No new network, named data volume, alternate proxy or published diagnostic port is required.

## Mandatory NAS preflight — not performed

All NAS commands in this document are **future administrator actions requiring approval**, not commands executed in this session. Keep DSM/SSH recovery on an independently verified trusted management connection; do not depend on Portal HTTPS. Synology Tailscale SSH is not assumed available.

1. Privately back up the original complete Compose, Nginx configuration, protected environment, full `tailscale serve status --json`, image IDs/digests and container inspection. Preserve existing configuration/authentication backups and CouchDB-consistent backup procedures. Never paste secret-containing inspections into CI or reports.
2. Reverify project label `portal`, owner-confirmed network `portal_default`, its actual ID and existing container IDs. Preserve that network; do not create a parallel network, use `down`, `--remove-orphans`, `down -v`, or prune. Record CouchDB authenticated readiness, known administrator/document revision and audit history; record Redis PING/configuration before and after without logging secrets. Perform diagnostics from inside the appropriate container/network, never by reopening host ports. Root/Docker administrators and existing network containers remain trusted.
3. Verify `/var/packages/Tailscale/target/bin/tailscale` **or the actual installed CLI path**, CLI/daemon versions, `serve --help`, package execution identity, supplementary groups, DSM ACLs and sandbox restrictions. Do not infer the daemon UID/GID from Linux tests or process names. Do not enable TUN, Funnel, change package privileges or upgrade/reinstall packages in this procedure.
4. Choose a new dedicated **existing** local socket directory, recorded privately as `PORTAL_SOCKET_HOST_PATH`; no real path is invented here. It must be outside SMB/untrusted write access, on a filesystem supporting Unix sockets and host/container access to the same inode. Resolve parent symlinks and verify parent ownership/ACLs. Entire host socket path plus `/portal.sock` must fit Linux `sun_path` (at most 107 bytes, not just 107 characters).
5. Provision only after authorization: directory root-owned, verified daemon-access group `PORTAL_SOCKET_GID`, mode **0750** (0700 only when the daemon is demonstrably root). Socket root:that-group **0660**, lock root-owned **0600**. No world permissions, permissive ACL grants, group directory write, recursive chown, or chmod 777. Check default ACLs, Docker user-namespace remapping and package confinement; mode bits alone do not prove access. The image retains the existing root Nginx master and unprivileged Nginx workers. Only the root master creates the listener. A non-root Serve daemon must have the verified group, not an invented identity. Do not use Tailscale's own LocalAPI socket or its directory.
6. Verify package access to an isolated test socket using the same path/mount/permissions under an approved live test. `curl` as NAS root is insufficient proof of package access. The decisive gate is actual Serve using this socket and valid HTTPS. If it fails, leave authentication blocked and stop; do not widen permissions to work around confinement.
7. Confirm no unreviewed Nginx TCP listener/config, additional Compose overlay, stale project port declaration, firewall forward, Funnel, router forward or other proxy exposes HTTP. Keep original hostname/certificate and HTTPS service-specific tailnet grants. No DSM reverse-proxy rule is required by this proposal.

## Workstation build and transfer proposal

After source review on White-Raptor/X1-Pro-Ai, build, test and save the socket image locally. Do not build it on the NAS or publish it. Example PowerShell commands, with the reviewed full commit replacing the variable:

```powershell
$reviewedSha = '<approved-full-commit>'
$imageTag = "portal-nginx-socket:7hc-$reviewedSha"
docker build --platform linux/amd64 --file Dockerfile.nginx-socket --tag $imageTag .
docker image inspect $imageTag --format '{{.Id}}'
docker save --output portal-nginx-socket-7hc.tar $imageTag
Get-FileHash portal-nginx-socket-7hc.tar -Algorithm SHA256
```

Record image ID and archive checksum in the protected deployment record. Transfer the archive via an approved trusted administration channel (e.g. existing authenticated SMB/SSH, without credentials in commands). On the NAS, verify `sha256sum` before `docker load -i`; verify loaded image ID matches. Use that immutable `sha256:...` image ID as `PORTAL_NGINX_SOCKET_IMAGE`, rather than a mutable tag. Base image/package rebuilds may differ: identify the exact tested artifact, not just the Git label. Preserve a copy for rollback. Existing Nginx/CouchDB/Redis images are not automatically upgraded.

## Exact transition sequence for later approval

Expect a brief HTTPS outage between Nginx recreation and Serve target change. No app deployment is part of this transition. Pre-render and review both placeholder and future app configurations offline:

```powershell
$env:PORTAL_PUBLIC_ORIGIN = 'https://jwj-nas-1.tailf9c3d1.ts.net'
$env:PORTAL_PROXY_RESPONSE_MODE = 'placeholder'
node scripts/render-unix-proxy.cjs --output nginx.unix.placeholder.conf
$env:PORTAL_PROXY_RESPONSE_MODE = 'app'
node scripts/render-unix-proxy.cjs --output nginx.unix.app.conf
```

The renderer writes UTF-8 without BOM, refuses overwrite and requires an HTTPS DNS origin and explicit mode. The app-mode upstream cannot resolve before `app` exists, so initially deploy **only placeholder**. Keep the original configuration backup private.

On the NAS, only after approval, populate a protected environment file with the existing privately verified CouchDB credentials, loaded image ID, verified socket GID/path. Do not source untrusted shell env files. Use an approved absolute environment-file path as `PORTAL_ENV_FILE`, verified CLI path as `PORTAL_TS_BIN`, and reviewed placeholder file path as `PORTAL_PLACEHOLDER_CONFIG` below. These are explicit operator variables, not inferred NAS state.

```sh
set -eu
cd /volume1/docker/portal
# Verify these operator-set variables first; abort on missing values.
: "${PORTAL_ENV_FILE:?}" "${PORTAL_TS_BIN:?}" "${PORTAL_SOCKET_HOST_PATH:?}"
: "${PORTAL_PLACEHOLDER_CONFIG:?}"
: "${PORTAL_BACKUP_DIR:?Choose a new private backup directory on verified local storage}"
umask 077
mkdir -m 700 "$PORTAL_BACKUP_DIR"
cp -p compose.yaml "$PORTAL_BACKUP_DIR/compose.original.yaml"
cp -p nginx/nginx.conf "$PORTAL_BACKUP_DIR/nginx.original.conf"
cp -p "$PORTAL_ENV_FILE" "$PORTAL_BACKUP_DIR/runtime.env"
"$PORTAL_TS_BIN" serve status --json > "$PORTAL_BACKUP_DIR/serve.original.json"
docker inspect portal-nginx portal-couchdb portal-redis > "$PORTAL_BACKUP_DIR/containers.private.json"
# Review complete compose.unix.yml, substitute no paths automatically.
docker compose -p portal --env-file "$PORTAL_ENV_FILE" -f compose.unix.yml config --quiet
```

Inspect the normalized configuration privately to confirm **no ports for any service**, original identities/network and unchanged dependency binds/credentials. Before later app deployment, normalize **only** the Unix base plus app overlay and repeat the all-service check. No historical TCP base or publishing overlay may appear in the file list. Do not print expanded secrets to a shared log. Validate the image/config in a **separate disposable scratch socket directory**, not the live directory: the launcher `--test` binds safely and invokes `nginx -t`. Plain stock `nginx -t` on a missing Unix socket can itself create a 0666 socket. Do not run it on an inactive production path. Ensure the scratch container uses the reviewed image, config read-only bind and verified group; remove only that test container, never persistent data/volumes.

Install the reviewed placeholder content at the existing `/volume1/docker/portal/nginx/nginx.conf` bind source, preserving its inode and existing bind. No container recreation has happened yet, so validate copied content before continuing. Use the complete replacement Compose, **not the original TCP file plus an overlay**:

```sh
test -f nginx/nginx.conf && test ! -L nginx/nginx.conf
cat "$PORTAL_PLACEHOLDER_CONFIG" > nginx/nginx.conf
cmp -s "$PORTAL_PLACEHOLDER_CONFIG" nginx/nginx.conf
docker compose -p portal --env-file "$PORTAL_ENV_FILE" -f compose.unix.yml up -d --no-deps --force-recreate nginx
docker exec portal-nginx /usr/local/bin/portal-socket --check
docker inspect portal-nginx --format '{{json .HostConfig.PortBindings}}'
stat -c '%a %u %g %F' "$PORTAL_SOCKET_HOST_PATH" "$PORTAL_SOCKET_HOST_PATH/portal.sock"
"$PORTAL_TS_BIN" serve --bg --https=443 "unix:$PORTAL_SOCKET_HOST_PATH/portal.sock"
"$PORTAL_TS_BIN" serve status
```

Only `nginx` is recreated, as required to remove the published port and add its socket mount/image. Do not recreate CouchDB or Redis. Do not run `serve reset`, change hostname, enable Funnel or request a new public hostname/certificate. Preserve unrelated Serve handlers; inspect the full saved status before replacing this specific HTTPS handler. Confirm the exact version's syntax/help first.

Once accepted, make the complete reviewed Unix Compose the project's authoritative `/volume1/docker/portal/compose.yaml` (`cat compose.unix.yml > compose.yaml`, then `cmp -s compose.unix.yml compose.yaml`), retaining the original only as a marked unsafe historical backup. Reconcile Container Manager's stored project definition **and protected environment-file loading** with this complete file before any future Start/Update action; do not reset/recreate the project. Otherwise DSM could silently restore the old port after restart or fail on missing variables. Verify actual project startup behavior manually. Later app installation adds only `compose.app.yml` to this **Unix** base, after separate approval and readiness, then selects app-mode config. Do not add the app now.

## Acceptance matrix — live checks still required

- Existing full ts.net hostname, trusted certificate and authorized HTTPS GET returns **200** placeholder. Test from LAN and remote tailnet computers, Zenbook and an allowed external device-sharing account. No unauthenticated public Internet path or Funnel. Existing tailnet grants/revocation still require actual policy tests.
- From a **different LAN machine**: `curl --noproxy '*' --connect-timeout 5 http://<verified-NAS-LAN-IP>:8088/` must fail connection. From a **different tailnet machine**: the same against `http://100.84.136.19:8088/` must fail. On Windows use `curl.exe` and `Test-NetConnection -Port 8088`. Do not accept HTTP 200, 301/302, 403, or merely lack of a cookie as denial. Recheck actual NAS IPs before use. A firewall timeout is distinct from connection refusal; investigate rather than declaring this exact acceptance passed.
- `docker inspect` shows **empty PortBindings for Nginx, CouchDB, Redis and (later) app**, no host networking and no 8088/5984/6379 host listener. No Nginx TCP socket. Recheck remote 5984/6379 denial after the Unix migration and after restarts, preserving the owner's completed database isolation. Nginx health is socket liveness, not proof of Serve/certificate/app health.
- CouchDB authenticated readiness and recorded revisions/history unchanged; Redis PING/command unchanged; compare container IDs before/after and original network ID. Check logs privately without exposing secrets. Legacy file mount remains read-only; no Nginx alias/root/download bypass.
- Forge `X-Forwarded-*`, Host and identity headers at the HTTPS client; Serve must replace them. Wrong/missing backend HTTPS/canonical/client-IP metadata is rejected by Nginx. Only socket-authorized local processes can submit backend metadata; root/Docker administrators remain trusted. Serve's rewritten `Host: localhost` is allowed only together with canonical forwarded host and HTTPS. Nginx sends canonical Host, HTTPS and one parsed client IP to NestJS and strips raw Forwarded/Tailscale identity headers. Portal uses its existing one-hop Nginx trust; the app has no published port. Tailscale identity is not Portal login.
- **After separately authorized app deployment:** Secure/HttpOnly/SameSite cookies; HTTP login impossible; CSRF mandatory; unauthorized access denied; pending/disabled/closed accounts rejected; private metadata withheld; selected sharing/revocation effective; bytes/hashes/quotas/recovery and audit client IP preserved. These already have disposable CI coverage but no live NAS acceptance.
- Gracefully restart Nginx, then perform an approved NAS restart with out-of-band management available. Verify Serve background persistence/package order, socket recreation/reconnection, no 8088 exposure, original network, health, data and identity. This NAS restart is **not** performed in preparation. A stale socket is removed only if it is an expected root/group-owned 0660 socket and connection returns ECONNREFUSED. Active sockets, unexpected files/symlinks, unsafe directories and permission errors fail closed. Serve may return temporary 502/503 before Nginx/socket readiness; no TCP fallback is configured.

## Safe rollback and independent recovery

The tested rollback is **Unix placeholder mode with the original three service identities**, retaining the restricted socket, **zero Nginx/CouchDB/Redis publications**, authentication and all persistent binds/data. Restore the reviewed Unix placeholder content at the existing config source, then `docker exec portal-nginx nginx -s reload`; verify socket health, HTTPS 200 placeholder, empty bindings for every service and remote denial of 8088/5984/6379. If app was later deployed, stop only `app` using the authoritative Unix base plus app overlay; do not remove files, records or volumes. Preserve existing credentials. Historical TCP Compose is an unsafe archive, never an approved production rollback. CI exercises the secure transition with real retained records and the production app image.

If the socket image/config is broken, use the independent management path to restore the last tested socket image ID and placeholder config, then targeted `up -d --no-deps --force-recreate nginx`. If Synology package permissions make Unix transport unusable, **stop Nginx** (`docker stop portal-nginx` works independently of Compose interpolation), leave TCP unpublished and accept temporary HTTPS unavailability; retain Serve/certificate/status backups for review. Recover via DSM/approved SSH, not Portal. Do not broaden ACLs or expose HTTP to regain convenience. Restoring the original vulnerable TCP file/Serve target would reopen the confirmed bypass and needs a separately reviewed isolation/architecture decision; it is not an authorized automatic rollback.

NAS socket access, DSM package sandbox/ACLs, actual certificate, external user grants and NAS boot persistence remain manual gates. Linux container tests cannot establish them. Do not enable production authentication before acceptance and independent review.
