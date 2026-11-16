# Session 7H-B: private Tailscale HTTPS preparation

**Preparation only. No NAS connection, rule/service enablement, container deployment/restart, firewall/DNS change, credential rotation or image publication occurred. A future deployment requires separate explicit authorization.** This supersedes 7H-A's preferred DSM termination evaluation. DSM's Reverse Proxy list was confirmed empty by Justin; no DSM rule is needed for the preferred Serve path. DS920+ `jwj_NAS_1` is primary. DS925+ offsite backup/disaster recovery is **Release 2**, not a new R1 deployment dependency.

## Evidence and feasibility gate

Repository/supplied evidence establishes the existing `portal` project, `8088:80`, five original binds, service names, Redis command and implicit default network. The [reconciliation review](ds920-existing-configuration-review.md) still governs preservation. The app remains the additive fourth production service; CI's extra proxy is only a disposable test fixture.

**Installed DSM/Tailscale versions, package origin, Serve capability, tailnet policy, hostname, certificate, actual network ID, observed proxy source and effective backend isolation are NOT verified.** NAS access is prohibited in this session. Read-only version/help output was requested from Justin. Do not select or execute a NAS enablement command until that evidence is reviewed.

Tailscale's current [Synology guidance](https://tailscale.com/docs/integrations/synology) supports device sharing and access policies, describes DSM7 hybrid-networking restrictions, and warns that the Synology Package Center version is no longer supported/current. It does not prove the package installed on this NAS supports Serve. Do not automatically upgrade/reinstall it, enable TUN, change routing, or use unsupported Tailscale SSH. Verify package source, DSM/CPU compatibility and CLI/daemon versions first. An outdated package is a maintenance decision requiring approval.

The [Serve CLI reference](https://tailscale.com/docs/reference/tailscale-cli/serve) uses the modern syntax introduced in 1.52. Serve support in the actual Synology build and local-backend connectivity remain required gates. If Serve is unavailable/unsuitable, **stop**: a possible alternative is Tailscale-issued `*.ts.net` certificates with an independently approved private DSM HTTPS listener and renewal/trust procedure. That alternative is not selected, configured or silently substituted here.

## Proposed path and canonical URL

```text
LAN or remote computer, connected to Tailscale under an allowed identity
  → full verified node-name.tailnet-name.ts.net over HTTPS (TCP 443)
  → Tailscale Serve on the DS920+, Funnel disabled
  → verified local HTTP target http://127.0.0.1:8088
  → existing portal-nginx:80, preserving its container and mounts
  → app:3000 on the original Compose default network
  → internal CouchDB/Redis, preserving original data and behavior
```

The hostname above describes a **shape**, not an actual NAS hostname. All Portal clients, including computers on the DS920+ LAN, use Tailscale and the same canonical HTTPS URL. This follows the approved requirement for authenticated Tailscale access. A separate non-Tailscale LAN login path is not prepared; request review if one is required. No public router forwarding, Funnel, subnet-routing expansion, exit-node setup or direct app publication is included.

Serve uses its node's full tailnet DNS name and automatically managed HTTPS certificate. Shared users must use that full name, not the NAS's short machine name. See [Serve](https://tailscale.com/docs/features/tailscale-serve), [HTTPS setup](https://tailscale.com/docs/how-to/set-up-https-certificates) and [sharing/MagicDNS](https://tailscale.com/docs/features/sharing). Enabling certificates requires consent and publishes machine/tailnet DNS names in certificate-transparency records; this does not make Portal publicly reachable. Verify the certificate chain, SAN, expiry and renewal through the actual client path. Never bypass verification or copy a test certificate onto the NAS.

`PORTAL_PUBLIC_ORIGIN` is the single deployment input for the canonical HTTPS origin. The renderer derives allowed Host/forwarded-host values and the normalized app Host from it. There is no initial `*.ts.net` hostname in application logic. A future domain can change this configuration without changing NestJS, but Serve itself restricts DNS names to its tailnet domain; a custom-domain TLS provider needs separate review. Configuration flexibility is not a claim that Serve issues arbitrary-domain certificates.

## Backend restriction and trusted proxy handling

**Do not apply the rendered template until isolation and actual header/source behavior are verified.** The existing `8088:80` declaration has no explicit host address. [Docker documents](https://docs.docker.com/engine/network/port-publishing/) normal all-interface publication and a pre-28.0.0 same-L2 localhost-publication caveat. Inspect actual bindings/Engine behavior; neither a written firewall policy nor an assumed loopback address establishes isolation.

Prefer an effective host/DSM firewall restriction that preserves the existing Nginx container and `8088:80`, permits the verified local Serve path, and blocks direct LAN/tailnet backend access. Demonstrate its effect on Docker-published traffic from independent devices and relevant IPv4/IPv6 paths. Do not copy an all-ports tailnet-subnet allow rule as Portal policy. A loopback rebind is an alternative only after separate container-maintenance approval because it recreates Nginx; no such change is made here. If direct traffic and Serve appear to have the same source, source-IP trust alone is insufficient: stop until independent backend isolation is demonstrated.

Keep the original Compose network limited to trusted Portal/Nginx/CouchDB/Redis services; do not attach untrusted workloads. Tailnet grants protect network admission to the NAS, not against a privileged local Docker administrator. The app's internal port remains unpublished.

[nginx.tailscale.conf.template](../deploy/ds920/nginx.tailscale.conf.template) is an **unselected** complete configuration, with no additional Nginx mounts. It inherits the original PID default, `8088:80` and worker setting, keeps upstream pooling/DNS and streaming, and uses exact observed proxy IPs, never a guessed gateway, loopback or broad subnet. Production Nginx must meet the existing >=1.27.3/real-IP-module prerequisites; do not upgrade it automatically.

The reviewed [current upstream Serve source](https://github.com/tailscale/tailscale/blob/main/ipn/ipnlocal/serve.go) preserves incoming Host and sets forwarded Host, TLS scheme and client IP. This is reference behavior, **not proof about the installed build**. Verify it against the installed version and actual traffic. The template requires a trusted TCP peer, HTTPS indication, canonical Host/forwarded Host, one valid parsed client IP and no Funnel marker. It emits only normalized HTTPS/client/host headers to the existing app trust boundary, strips raw `Forwarded` and Tailscale identity/capability headers, and does not increase Express proxy hop trust. Tailscale identity is never Portal SSO or an administrator role.

Plain HTTP, missing/malformed headers, untrusted peers, noncanonical hosts and Funnel-marked requests receive 403 without a session cookie. Serve should publish only HTTPS 443; no HTTP Serve listener/port-80 grant is added. HTTP rejection, rather than an insecure login or automatic fallback, is the intended behavior. Secure/HttpOnly/SameSite cookies and CSRF remain unchanged. Canonical HTTPS requests alone can complete Portal login. Trust cannot defend a compromised host administrator or another process capable of using the verified local Serve path; that host remains trusted.

## Offline preparation commands

Run only on the workstation checkout. Start from [tailscale.env.example](../deploy/ds920/tailscale.env.example); filled values and output belong in an existing private directory **outside Git and the image build context**. No actual values are supplied by the repository. Exact observed peer IPs can only be entered after approved inspection. The renderer refuses missing/unsafe origins, subnet/hostname peers and control characters.

```powershell
# Supply values from verified deployment evidence; do not paste secrets into Git.
$env:PORTAL_PUBLIC_ORIGIN = 'https://<verified-full-node-dns-name>'
$env:PORTAL_SERVE_PROXY_PEERS = '<exact-observed-peer-ip>'
$portalPreparedFile = '<new absolute file in an existing private workstation directory>'
node scripts/render-tailscale-proxy.cjs --output $portalPreparedFile
if ($LASTEXITCODE -ne 0) { throw 'Proxy preparation failed' }
```

Angle-bracket values are intentionally non-runnable placeholders. The renderer writes UTF-8 exclusively to a **new** file, avoiding PowerShell redirection encoding and accidental overwrite. Verify NTFS/private-directory ACLs; mode bits alone are not a Windows ACL guarantee. It never connects to or copies a file onto a NAS. Deployment later uses the original single-file bind's inode-preserving update, `nginx -t` and reload in the same container, after backup and explicit authorization. Keep all five existing mounts and the original three identities; keep the app's separate managed bind and read-only NAS bind unchanged.

## Later administrator procedure — gated, NOT executed or selected for this NAS

**STOP gate:** installed version/help must be reviewed, Serve/Synology capability established, actual canonical hostname and source determined, backend isolation tested, existing Serve configuration preserved, and deployment separately authorized. Current CLI documentation alone does not clear this gate.

For an approved read-only inspection, first resolve the actual executable using the NAS shell's `command -v tailscale`; if absent, stop for a verified package CLI location instead of assuming a Linux path. Set `PORTAL_TS_BIN` to that verified path. Candidate read-only commands are:

```sh
"$PORTAL_TS_BIN" version
"$PORTAL_TS_BIN" serve --help
"$PORTAL_TS_BIN" serve status --json
"$PORTAL_TS_BIN" status --json
```

Inspect only necessary fields privately: version/daemon compatibility, Serve support, node `Self.DNSName`/addresses, backend target, HTTPS listeners and Funnel state. Do not publish the full status/peer inventory, auth URLs, state files or secrets. Confirm HTTPS 443/root is unused or explicitly approved for Portal; never replace another existing Serve service.

For a **verified compatible modern CLI only**, the candidate enablement command for later approval is:

```sh
"$PORTAL_TS_BIN" serve --bg --https=443 http://127.0.0.1:8088
"$PORTAL_TS_BIN" serve status --json
```

This command is **not chosen for the actual installed package yet**. Review every consent prompt; do not use `--yes`, enable Funnel or add public forwarding. Compare Serve JSON with the intended HTTPS-only proxy and confirm no active `AllowFunnel` entry. Preserve other services and settings. Do not run broad `serve reset`. The [documented background mode](https://tailscale.com/docs/solutions/host-private-server-docker) survives Tailscale/host restart; package autostart, state retention, actual post-restart source/header behavior and certificate renewal still need NAS acceptance. Do not add cron/DSM tasks or assume all Linux systemd commands exist.

From an allowed Windows client, with Tailscale connected and the actual canonical URL selected, use `curl.exe --fail --show-error --max-time 15 https://<verified-full-node-dns-name>/healthz` without `-k`, then browser login and the acceptance matrix below. Observe Nginx's original peer address from protected logs; never infer it from the Serve target. Do not enable trust just because one header looks correct.

## User sharing and service grants

STORMCRAFT, White-Raptor, X1-Pro-Ai and ASUS Zenbook Duo may use the owner's existing account. Other people use their **own** Tailscale accounts. Never share personal credentials, session cookies or enrollment/auth keys.

Use the admin console to share **only the DS920+ machine** with the intended external user. Confirm their identity when they accept. Tailscale [device sharing](https://tailscale.com/docs/features/sharing) grants visibility to the selected machine, not the owner's other computers; policies further restrict its services. Each recipient uses their full shared NAS `*.ts.net` hostname. Do not invite them into the whole owner tailnet or share additional devices as a shortcut. Use explicit recipient identities for this small group rather than a wildcard shared-user grant.

[tailscale-policy.json.example](../deploy/ds920/tailscale-policy.json.example) is a **non-runnable review fragment** with placeholders, not a complete policy replacement. Fill verified user identities/NAS address/owner-device addresses, merge carefully into a protected copy of the actual policy, and validate it in Tailscale's policy editor before separate approval. It allows only TCP 443 on the named NAS for the owner Portal group and one selected invitee. Keep any necessary existing owner administration rules separate; do not grant them to external users. Verify invitees cannot access DSM, SSH, SMB, databases, app/8088 or other owner computers.

[Grants combine additively with legacy ACLs](https://tailscale.com/docs/features/access-control/grants/grants-explained): this fragment cannot restrict an existing broad allow rule. Audit all matching rules and remove/narrow conflicting access only with approval. Its `deny` entries are test assertions, not deny firewall rules. Local JSON/unit checks are not Tailscale policy-engine validation, nor live proof of user isolation. Run the configured policy tests with real test identities and verify actual allowed/denied connections. Do not add Funnel capability/advertisements for Portal.

For revocation, an authorized tailnet administrator revokes the NAS share/invite and removes the now-unneeded Portal grant. Verify fresh HTTPS connections fail from every affected device, including with a previously valid Portal cookie. Do not promise recall of downloaded copies or that an already running transfer is terminated without testing. Independently disable/close Portal access when appropriate; network revocation and Portal session revocation are separate controls. Re-admission requires a new accepted share, a permitted grant and an approved active Portal account. Preserve public registration → pending approval → administrator-approved member; no network identity auto-approves a Portal account.

## Acceptance matrix — all live checks pending

| Case | Required evidence |
| --- | --- |
| LAN client | Owner-selected computer on the DS920+ LAN, Tailscale connected, canonical HTTPS with valid certificate; direct backend HTTP denied |
| Other location | Owner computer at the other location, same full URL and least-privilege network access |
| Zenbook Duo | Remote test under the owner's account, HTTPS login/logout and representative file round trip |
| External approved person | Their own account, only NAS shared, full FQDN resolves, HTTPS 443 succeeds, other machines/ports denied |
| Unauthorized / revoked identity | Policy tests and fresh connections denied; a valid old Portal cookie cannot bypass the network restriction |
| Application boundaries | Pending/disabled/closed users denied; admin approval works; member admin-page denial; private files hidden; explicit sharing/revocation; quotas and exact-byte hashes |
| Proxy and certificates | Correct observed source/client IP, spoofed protocol/host/IP/identity rejected; Secure/HttpOnly/SameSite cookies and CSRF; certificate chain/SAN/expiry correct; no plaintext authentication |
| Restart | Containers, then separately approved NAS restart; Serve background config/certificate persist; same trusted source or fail closed pending re-verification; Redis/app sessions and storage recover as documented |
| Public isolation | Non-tailnet client cannot connect; no Funnel/public forwarding; direct 8088 denied from relevant IPv4/IPv6/L2 paths and untrusted containers |
| Backup/rollback | Coherent existing R1 backup, private restore, target-specific Serve removal, original Nginx restored in place, original three containers/data unchanged |

No remote user, real tailnet grant/share, certificate issuance, physical NAS restart, actual firewall or interactive browser acceptance is reported executed by CI. CI's actual TLS/Nginx/Redis/CouchDB contract tests do not substitute for this matrix or the installed-package gate.

## Backup, rollback and Release 2 boundary

R1 must verify existing backup arrangements cover CouchDB data **and effective configuration/authentication**, the entire managed-storage identity/layout and journals, quota/sharing/audit/lifecycle metadata, protected deployment settings, image archive/manifest and Nginx originals. Quiesce app and capture matching CouchDB/files recovery points as described in [backup preparation](ds920-production-preparation.md#r1-backup-verification-and-future-ds925-proposal). Do not configure new backup jobs here. DS925+ offsite backup and standby/DR remain R2 proposals.

Securely preserve approved tailnet policy/share inventory and Serve status/configuration evidence. Treat Tailscale state, keys and enrollment material as secrets, never repository artifacts. Do not clone a live node identity onto another NAS or assume its hostname/certificate/address can be reused. A restore may require supported re-enrollment, a reverified canonical URL/certificate/source and a rendered configuration update, while keeping the single application writer fenced.

For an approved compatible modern Serve profile, the **candidate** Portal-only disable command is `"$PORTAL_TS_BIN" serve --https=443 off`; verify installed help and scope before use. Do not reset unrelated Serve services, remove the NAS from its tailnet or revoke owner-device access. Restore any reviewed policy delta carefully while retaining Portal denial. Restore the original Nginx file **in place**, validate/reload the same container and stop only app; retain data, audits, managed files and images. Restore any separately approved firewall change from its recorded snapshot. Re-test original container IDs/mounts/8088 placeholder. Never restore CouchDB alone to an older point, remove volumes or downgrade metadata blindly. No rollback command is executed during preparation.
