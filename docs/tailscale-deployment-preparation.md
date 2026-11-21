# Session 7H-B: private Tailscale HTTPS preparation

**Superseded transport:** Session 7H-C confirmed that localhost publication still allowed tailnet HTTP access. Do not deploy this TCP-backend profile or rely on its port restrictions. Use the [restricted Unix-socket proposal and acceptance gates](unix-socket-deployment.md). This page remains historical evidence for the unchanged tailnet/account policy; live facts supplied in 7H-C supersede its unknown-version status.

**Preparation only. No NAS connection, rule/service enablement, container deployment/restart, firewall/DNS change, credential rotation or image publication occurred. A future deployment requires separate explicit authorization.** This supersedes 7H-A's preferred DSM termination evaluation. DSM's Reverse Proxy list was confirmed empty by Justin; no DSM rule is needed for the preferred Serve path. DS920+ `jwj_NAS_1` is primary. DS925+ offsite backup/disaster recovery is **Release 2**, not a new R1 deployment dependency.

## Current evidence and approved transport

Owner-supplied production evidence on November 20, 2026 confirms Tailscale 1.104.7, Docker 24.0.2, Compose 2.20.1, project portal and shared network **portal_default**. Existing Serve HTTPS and its certificate work. CouchDB/Redis host publications were removed and remote 5984/6379 are denied; readiness is ok/PONG. **Nginx 8088 is still reachable, so production authentication remains prohibited.** Codex has not connected to or changed either NAS.

The approved future path is **Tailscale HTTPS -> restricted Unix socket -> Nginx -> internal app:3000**. Preserve the existing hostname and certificate. Use [Unix transport preparation](unix-socket-deployment.md) for exact version-specific commands, permissions, startup/recovery checks and remaining live Synology gates. It has no published Nginx, CouchDB, Redis or app ports. Combine the app overlay only with the complete approved Unix base; never with the original TCP Compose or a publishing override. The existing portal_default network and persistent binds must remain intact. Database communication uses internal service DNS, not host loopback sockets.

The former TCP renderer/profile and localhost/firewall-only proposals are historical characterization fixtures, not approved deployment or rollback options. Their commands are intentionally removed from this operational guide. Do not restore 8088:80 or localhost database bindings, enable Funnel, infer a trusted proxy address, widen socket permissions or alter package networking to make a deployment pass. If actual Synology Serve cannot use the restricted socket, stop for architecture review.

Canonical origin, HTTPS propagation, unspoofed client IP, Secure cookies, CSRF and Portal's independent account authorization remain mandatory. Unix peer trust comes from verified filesystem/package permissions, not a guessed source address. CI models the Serve header contract; real package access, user grants and restart persistence still require approved NAS acceptance.

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
| Public isolation | No Funnel/public forwarding; 8088 denial after Unix migration, continued 5984/6379 denial, all containers unpublished; preserve internal network access |
| Backup/rollback | Coherent existing R1 backup; restricted Unix placeholder, zero Nginx/database publications, unchanged credentials and retained data |

No remote user, real tailnet grant/share, certificate issuance, physical NAS restart, actual firewall or interactive browser acceptance is reported executed by CI. CI's actual TLS/Nginx/Redis/CouchDB contract tests do not substitute for this matrix or the installed-package gate.

## Backup, rollback and Release 2 boundary

R1 must verify existing backup arrangements cover CouchDB data **and effective configuration/authentication**, the entire managed-storage identity/layout and journals, quota/sharing/audit/lifecycle metadata, protected deployment settings, image archive/manifest and Nginx originals. Quiesce app and capture matching CouchDB/files recovery points as described in [backup preparation](ds920-production-preparation.md#r1-backup-verification-and-future-ds925-proposal). Do not configure new backup jobs here. DS925+ offsite backup and standby/DR remain R2 proposals.

Securely preserve approved tailnet policy/share inventory and Serve status/configuration evidence. Treat Tailscale state, keys and enrollment material as secrets, never repository artifacts. Do not clone a live node identity onto another NAS or assume its hostname/certificate/address can be reused. A restore may require supported re-enrollment, a reverified canonical URL/certificate/source and a rendered configuration update, while keeping the single application writer fenced.

Follow the [safe Unix rollback](unix-socket-deployment.md#safe-rollback-and-independent-recovery): retain the socket transport and zero publications for all services, restore the reviewed Unix placeholder in place and stop only app if necessary. Preserve CouchDB data/configuration, authentication, Redis behavior and managed files. The original TCP Compose and original TCP Nginx placeholder are not approved rollback configurations. If Unix transport fails, stop Nginx and use independent management rather than reopening ports. No live change or rollback is executed in preparation.
