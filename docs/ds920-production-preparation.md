# DS920+ Release 1 deployment preparation

## Current transport requirement

Session 7H-C supersedes the TCP/8088 backend proposal below: remote HTTP bypass remained reachable despite a loopback Docker bind. Follow [Unix-socket deployment preparation](unix-socket-deployment.md); production authentication remains blocked pending independent review and actual NAS denial/compatibility checks. Preserve existing records, network and mounts. Historical rollback instructions must not automatically restore a published HTTP port.

**Review candidate only. No NAS connection, provisioning, transfer or deployment has been performed.** Session 7H-B authorizes [Tailscale HTTPS preparation](tailscale-deployment-preparation.md), **not deployment**; its approved direction supersedes the DSM preference retained below. The primary target is `jwj_NAS_1` (DS920+). DS925+ offsite backup/disaster recovery is deferred to **R2**; R1 must verify existing backup arrangements. The older [DS925 guide](ds925-production-readiness.md) is not the deployment definition for this populated DS920+.

## Preserve the existing project

The owner's November 20, 2026 production checks supersede the original TCP snapshot: CouchDB and Redis now have empty host PortBindings, remote 5984/6379 tests fail, CouchDB readiness is ok and Redis returns PONG. Nginx 8088 remains remotely reachable. The existing network is verified as **portal_default**. Codex did not connect to the NAS or execute those checks. See [current evidence and transport requirements](unix-socket-deployment.md).

Preserve project **portal**, service/container identities, the existing network ID, populated CouchDB data/config binds, existing authentication, Redis command/nonpersistent session policy, Nginx config/legacy/log binds and their ACLs. Never substitute a named CouchDB volume or create a parallel network. Reverify the live IDs before any separately authorized deployment.

The [application overlay](../deploy/ds920/compose.app.yml) may be combined **only with the approved complete [Unix base](../deploy/ds920/compose.unix.yml)**. All four services must have no published host ports or host networking in the effective normalized configuration. Application dependencies use Docker DNS couchdb:5984 and redis:6379 internally. Do not use the historical original TCP project, even as a rollback base; empty ports lists do not safely cancel Compose publications inherited from another file.

The [original infrastructure reference](../deploy/ds920/compose.infrastructure.yml) is an explicitly unsafe historical fixture, not a current deployment definition. No database image/user/credential, Redis behavior, app business logic or storage migration is authorized here. Target only the authorized service during later maintenance; no project down, orphan removal, volume deletion or automatic dependency recreation.

## Workstation build and offline image transfer proposal

Use White-Raptor or X1-Pro-Ai with Linux Docker, enough free disk space, and a clean checkout of the independently reviewed source commit. A successful GitHub push is not a deployment. DS920+ is [x86_64](https://kb.synology.com/en-ca/DSM/tutorial/What_kind_of_CPU_does_my_NAS_have); build `linux/amd64` using the existing multi-stage Dockerfile, Node 22 and the repository lockfile. No registry publication is needed.

The following is a **future operator procedure, not executed by Session 7H-A**. In a separate clean checkout, first run `npm ci`, typecheck, tests and build. Select the full reviewed SHA and require `git status --porcelain` to be empty. Keep secrets and owner documents outside the build context.

```powershell
$releaseSha = git rev-parse HEAD
$releaseTag = "portal-bsc:r1-$releaseSha"
docker build --pull --platform linux/amd64 --target runtime --label "org.opencontainers.image.revision=$releaseSha" --tag $releaseTag .
if ($LASTEXITCODE -ne 0) { throw 'Image build failed' }
$releaseImageId = docker image inspect --format '{{.Id}}' $releaseTag
if ($LASTEXITCODE -ne 0) { throw 'Image inspection failed' }
docker image inspect --format '{{.Os}}/{{.Architecture}}' $releaseTag
docker run --rm --entrypoint node $releaseTag --version
$releaseOutputDirectory = (Resolve-Path -LiteralPath '<existing private release output directory outside the checkout>').Path
$releaseArchive = Join-Path $releaseOutputDirectory "portal-bsc-r1-$releaseSha.tar"
docker save --output $releaseArchive $releaseTag
if ($LASTEXITCODE -ne 0) { throw 'Image export failed' }
Get-FileHash -LiteralPath $releaseArchive -Algorithm SHA256
```

Record the source SHA, full image content ID, platform, actual Node patch version, archive byte count and SHA-256 in a private release manifest. The full-SHA tag identifies the build, while the full content ID identifies the immutable image. Rebuilding floating base images can produce a different content ID: retain the tested archive and manifest rather than assuming a later rebuild is identical. Do not export any test data volumes or private documents.

After separate transfer approval, transfer only the image archive, manifest and reviewed configuration via an authenticated private LAN channel (operator-controlled SFTP/SCP or a protected DSM share). Verify the archive checksum **on the DS920+** before Container Manager import / `docker load`. Verify the loaded image's complete ID, platform, revision label and Node version against the manifest. Set `PORTAL_APP_IMAGE` to that verified `sha256:<complete image ID>`, not a floating tag. Confirm the installed Compose accepts this reference with `pull_policy: never`. Never build on the NAS or pull/publish this application through a public registry. Retain the previous image archive separately for rollback.

## Protected configuration and account preservation

Start from [the environment template](../deploy/ds920/.env.example), keeping the filled `.env.production` private and excluded from Git. On DSM, restrict it to the deployment operator, for example owner-only mode `0600` plus verified DSM ACLs; restrict parent traversal and backup access too. Docker administrators can inspect container environment, so they remain trusted. Avoid `docker inspect` dumps, `config` without `--quiet`, shell tracing, command-line passwords and screenshots containing credentials. Do not copy values into reports or CI.

Before proposing any credential change, an authorized operator must privately verify the existing CouchDB image ID/version, authentication, effective configuration chain, database security settings and current data/config mounts. Test a known existing credential via a protected client and record only pass/fail; an environment variable alone is not proof that credential is active. Portal supports separate `COUCHDB_URL`/`COUCHDB_USER`/`COUCHDB_PASSWORD`; the addition uses these with no URL-embedded password and fails startup when authentication fails. These CouchDB credentials are separate from Portal account password hashes in `portal_users`.

CouchDB [administrator hashes are held in configuration](https://docs.couchdb.org/en/stable/config/auth.html), not Portal user documents. The reviewed [3.5.0 image entrypoint](https://github.com/apache/couchdb-docker/blob/main/3.5.0/docker-entrypoint.sh) adds an environment-specified administrator only when it does not find that administrator in configuration; behavior of the currently installed NAS image is still unverified. Changing `COUCHDB_PASSWORD` in YAML is not a verified rotation procedure. Preserve the actual configuration and service credentials together. Back up any relevant configuration or cookie stored outside the reported config bind as well.

No hard-coded password is included in this proposal. The supplied YAML identifies the CouchDB administrator as `portaladmin` and redacts its password. Privately verify the effective credential; the redaction gives no evidence that it is a placeholder. The reference uses required protected environment values without rotating anything. Preserve the original private file and effective CouchDB config for rollback. Only if verification establishes a placeholder should controlled rotation be proposed before production use, with separate authorization and a tested recovery copy.

Never reset or reseed existing Portal users to make deployment work. Verify the existing administrator can authenticate against the preserved database. The established bootstrap verifies an existing active administrator without changing their password; member collisions and disabled-administrator recovery are not silently promoted/reactivated. Do not add `ADMIN_*` to the runtime environment or run seed blindly against a populated database. Preserve user lifecycle records, session versions, audit history and all four databases (`portal_users`, `portal_files`, `portal_audit`, `portal_downloads`).

## Nginx and HTTPS proposal

Preserve the working Tailscale HTTPS hostname and certificate. The approved candidate is Serve HTTPS -> restricted Unix socket -> existing Nginx -> internal app:3000. Follow [the Unix guide](unix-socket-deployment.md) for the pinned-version launcher, socket ownership/ACL checks, fail-closed forwarding metadata, streaming limits, exact future transition commands and safe recovery. No public ports, Funnel, DSM proxy changes or new proxy service are introduced.

The old HTTP/TCP and TLS examples remain historical test fixtures, **not deployable profiles**. Production authentication remains prohibited while live port 8088 is reachable. Cookies, redirects, forwarding-header gates and assumed loopback protection cannot substitute for eliminating that publication. The app is not deployed; initially the approved Unix configuration must serve only the placeholder. Nginx config and logging binds stay at their existing paths; only its separately approved socket migration requires targeted recreation. Do not recreate already-isolated CouchDB/Redis unnecessarily.

## NAS provisioning and permissions checklist — pending

- [ ] Record existing project, service keys, immutable image IDs, health, network and host-port/mount inspection without exposing environment secrets. Save protected copies of original YAML/nginx.conf and logs policy. Confirm existing CouchDB data and accounts before any change.
- [ ] Verify DSM/Container Manager/Compose versions. Test long bind syntax and `create_host_path: false` against a **disposable missing path**, never a production data path. [Docker documents automatic creation prevention](https://docs.docker.com/reference/compose-file/services/#long-syntax-5). Synology's [project documentation](https://kb.synology.com/en-global/DSM/help/ContainerManager/docker_project) does not establish support in the installed version. If it cannot enforce missing-source rejection, stop and review a compatible Compose CLI/Engine `--mount` alternative; do not fall back to auto-creating short bind syntax.
- [ ] Verify `/volume1/docker/portal/files` is the intended canonical existing legacy directory and not a symlink/junction. Give the selected app identity read/search only. App inspection must show `RW=false`.
- [ ] Choose a **separate** persistent managed-storage directory. Its real path must be disjoint from legacy files, checkout/public assets and CouchDB paths. No path is prescribed here and none has been created. Prevent untrusted SMB writers/hard links in this root.
- [ ] Select a verified non-root app UID **and** GID. Keep parents/root/marker under trusted administrator control; allow app read/search root and marker, and read/write/search only `staging`, `objects`, `quarantine`. Start with `0700` subdirectories / `0600` payloads and verify DSM ACL effects. Never recursively change existing database/share ownership to accommodate the app.
- [ ] Explicitly provision the existing managed root and three subdirectories on one filesystem; create `.portal-storage.json` with `{"schemaVersion":1,"id":"<new UUID v4>"}` only for a genuinely new installation. Restore the existing UUID if recovering storage. Record it privately and match `PORTAL_UPLOADS_STORAGE_ID` and CouchDB registration.
- [ ] Verify canonical host separation, storage identity, free space and inode capacity. Select explicit positive `PORTAL_UPLOAD_MIN_FREE_BYTES` appropriate for the **DS920+** and shared-volume writers. Test exclusive-create, hard-link, unlink and fsync with disposable fixtures using the actual app UID/GID. No automatic production directory creation is allowed.
- [ ] Review [managed-upload recovery](managed-uploads.md): startup reconciles known journals, hashes committed files and replays durable audits; missing/unknown/conflicting objects fail closed. Never delete/adopt orphans or reset the marker merely to obtain readiness.
- [ ] Confirm quotas explicitly in the administrator UI: recommendations remain **10 GB/user, 100 GB/global, 1 GB/file**, exact decimal bytes. Existing configured values and overrides survive. Not configured blocks uploads. Sharing adds no duplicate byte charge. No quota applies to all NAS/SMB storage.
- [ ] Keep **one** application instance and one managed writer. Do not scale app replicas. The app's healthcheck confirms `/healthz` responds after startup initialization; it is **not continuous CouchDB/Redis/storage readiness proof**. Periodic HTTP health requests also consume their own rate-limit bucket.

## DS920+ Antivirus Essential acceptance — unverified

No installation, whitelist, scheduled task or scan evidence was inspected on either NAS. Prior verification on another device would not establish coverage on `jwj_NAS_1`.

During separately approved acceptance, Justin must verify Package Center installation of Antivirus Essential **on DS920+**, current definitions, scan-task destination and scan-account read/traverse permission on the chosen managed root. Choose the whole managed root explicitly, include **all file types/files without extensions**, and ensure neither it nor its children are whitelisted. Run an initial scan, then configure a suitable off-hours Smart Scan schedule and verify its completion logs. Smart Scan is incremental; record the initial coverage as well as subsequent task success. Confirm the selected task really targets the local DS920+ path, not a remote destination or only the legacy files directory.

Safe extensionless acceptance: upload a harmless synthetic TXT through Portal into an isolated acceptance account. Confirm its object is an opaque extensionless filename and record its test-only ID. Run a custom scan against the controlled acceptance folder/object using the same scope/filter policy, and obtain per-file or unambiguous controlled file-count evidence that this object was included. A generic 'no threats' result alone is insufficient. If DSM cannot supply that evidence, leave extensionless coverage pending and review the scan options; do not claim success. Do not insert untracked test files or an antivirus trigger into live `objects`, `staging` or `quarantine`. An optional engine-detection test belongs in a separate disposable scan fixture, never a live managed journal.

Scheduled scanning is **not a clean-before-download gate**. Portal continues to label files `not-scanned`. Office macros/scripts and archived content remain untrusted; archive scanning can be limited, especially for nested/encrypted content. [Synology documents Smart Scan and the 2,048 MB exclusion](https://www.synology.com/en-sg/dsm/7.4/software_spec/antivirus_essential); the initial decimal 1 GB maximum stays below it. Scanner quarantine/mutation can make objects unavailable and reconciliation fail closed; preserve metadata/charges and review the incident rather than replacing bytes or editing CouchDB. Schedule to minimize active-upload interference. No scanner or NAS task is installed/configured by this proposal.

## R1 backup verification and future DS925 proposal

For **R1**, verify existing backup coverage, consistency and a representative restore; no new destination or task is selected here. The earlier DS920+ → DS925+ versioned **Hyper Backup** / Vault proposal is now **R2** only, including offsite placement, retention, integrity checks and protected recovery keys. Do not configure it in 7H-B. Synology [recommends backing up mapped host folders](https://kb.synology.com/en-me/DSM/tutorial/How_do_I_back_up_Docker_containers); this does not itself guarantee application consistency.

Include all of:

1. Actual CouchDB data bind `/volume1/docker/portal/couchdb/data`, reported config bind `/volume1/docker/portal/couchdb/config`, and any active configuration/credentials/cookies outside those binds. Preserve database security settings, administrator hashes and authentication configuration; [CouchDB's backup guidance](https://docs.couchdb.org/en/stable/maintenance/backups.html) distinguishes data and configuration.
2. Entire dedicated managed root: marker, staging, objects and quarantine, with ownership/ACLs. Retain durable reservation/recovery journals, file metadata, audits, sharing, lifecycle and quota policy from CouchDB at the **same recovery point**.
3. Protected Compose/environment files, original and proposed Nginx configuration, TLS keys/certificates/renewal procedure, storage UUID, UID/GID/ACL manifest, exact image archive/ID and source SHA. Include existing legacy files according to their established backup policy and preserve relevant logs. Redis session persistence/auth configuration, if present in the actual project, needs review; recovered sessions should not be assumed valid.

For modest R1 usage, prefer an explicit maintenance window: block new traffic, stop the **app only** gracefully and verify it exited, then stop CouchDB for a coherent cold copy of its data/config and the now-quiescent managed root. Keep these sources quiescent until the selected backup has captured **both**; do not assume a running multi-folder Hyper Backup creates a simultaneous snapshot. A verified coordinated filesystem snapshot/export can shorten downtime but needs separate operational review. Never copy a changing raw database as the only recovery plan. Start CouchDB first, verify it, then start the same app identity and validate recovery before reopening Nginx. These are future maintenance actions, not authorized execution in 7H-A. Do not deploy live SMB mirroring as a substitute for versioned coherent backup.

Restore verification must use a separate disposable destination: select a version; restore CouchDB data/config and the **matching** managed root/config/secrets; recreate only isolated services with original versions; verify marker/CouchDB identity, readiness and reconciliation; authenticate preserved accounts, inspect quotas/audits/shares, verify representative Office/ZIP/private downloads against SHA-256, test unauthorized denial, and verify old sessions are rejected under the reviewed restore/session-secret policy. Record restore duration and recovery point. Never restore over the primary or turn on a second writer against its managed root. A backup job reporting success is not a restore test. Neither NAS backup coverage nor disk redundancy has been verified in this session.

## Rollback and manual deployment acceptance

Before separately authorized deployment, keep a coherent protected backup of data, authentication, configuration, image IDs and the **current unpublished-database** project. Follow the [Unix deployment/rollback procedure](unix-socket-deployment.md), preserving the bound config inode. Never restore the original TCP Compose or any Nginx/database host publications. Roll back to the restricted Unix placeholder, stop only app if needed and retain all records, audits and managed bytes. If Unix transport cannot operate safely, stop Nginx and recover through independent DSM/approved SSH; do not reopen HTTP or database ports.

- [ ] Review the complete Unix base plus app overlay, zero host-port publications for every service, original identities, existing portal_default ID and exact populated binds/authentication/Redis command. No historical base or publishing override may be merged.
- [ ] Approve immutable image archives and manifests; verify non-root app UID/GID, marker, disk headroom and managed-root ACLs. Build on a workstation, never the NAS.
- [ ] Complete actual Tailscale package/socket permissions and certificate checks; preserve the canonical ts.net hostname. Verify LAN and tailnet 8088 denial after migration and retain verified 5984/6379 denial. Inspect empty bindings for every container.
- [ ] Persist the reviewed complete Unix definition and protected environment loading in Container Manager. Never reset the project or restore a TCP-publishing backup. A later app-only start uses only compose.unix.yml plus compose.app.yml and targets app with --no-deps.
- [ ] Verify authenticated internal CouchDB/Redis communication and unchanged account/audit/file records. Check Secure cookies, CSRF, administrator approval/safety, private metadata, sharing/revocation, byte hashes, quotas and rollback; do not seed/reset local users.
- [ ] Verify proxy/app/NAS restart persistence under separately approved maintenance. Existing CouchDB/Redis must not be recreated for the Nginx transition or app-only operations. Keep their network and persistent paths intact.
- [ ] Complete DS920+ antivirus/extensionless scanning and coherent backup/restore acceptance. DS925+ offsite backup/DR remains R2. Record manual evidence without secrets.

All application/Nginx Unix migration acceptance above remains pending. Database isolation/readiness and network membership are owner-supplied production observations, not Codex NAS verification.

R2 proposal, **not implemented**: documented recovery-time/recovery-point objectives, automated backup verification and a separately authorized standby activation mechanism. Any future standby must fence the old writer and restore/coordinate matching CouchDB/files/storage identity before accepting traffic. R1 does not provide automatic failover, active-active coordination or storage synchronization.
