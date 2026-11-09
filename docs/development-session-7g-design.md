# Session 7G-A: proposed managed-upload architecture

**Status: DESIGN ONLY — NOT IMPLEMENTED.** Uploads and upload quota enforcement are not operational. Phase 7G-B requires explicit approval after independent architecture review. No endpoint, package, production configuration, filesystem writer, account record or NAS mount is changed by this proposal.

Reviewed baseline: `8f3ea0644e28e890047799e9bf05212bc8e409aa` on `codex/portal-bsc-r1-fixes`. The working tree contained three staged `.idea` additions and an unrelated untracked `docs/development-session-7c-options.md`; these are outside this work. Instructions were read from `origin/master:AGENTS.md` and `origin/master:.github/copilot-instructions.md`.

The target hardware, supplied by Justin, is a DS925+ with 4 GB RAM, one 20 TB HDD in SHR and no NVMe cache. The design assumes one application process, bounded streaming transfers and local persistent storage. It does not assume additional RAM/drives, a particular DSM filesystem, actual host paths, service identities or installed Container Manager version.

## 1. Current implementation and boundaries

The following is source inspection, not new upload verification:

| Area | Current behavior and consequence |
| --- | --- |
| [FilesService](../src/files/files.service.ts) | Uses one `NAS_FILES_DIR`. Production requires an absolute, existing, readable/searchable directory; it does not create it or require write permission. Literal stored filenames are validated before access. Regular-file, canonical-root, symlink and opened-file identity checks protect reads. |
| [Download controller](../src/files/files.controller.ts) | Authentication and metadata authorization precede opening a file. Streams through a checked-length pipeline, sets attachment headers, aborts failed partial transfers, and records completed transfers. Audit persistence is a separate post-transfer operation. |
| Authorization | `visibility: public` currently means readable by authenticated users, not anonymous internet access. Otherwise `allowedRoles` must include the current role. An empty role list denies even administrators. Ownership does not currently grant access. The same authorization service protects listing, details and downloads. |
| [CouchDB adapter/schema](../src/common/couchdb.service.ts) | Four databases: `portal_users`, `portal_files`, `portal_audit`, `portal_downloads`. File documents have names, size, SHA-256, roles and uploader ID, but no upload state, owner ACL or reservation. `createFile()` generates a new ID on every call. `listFiles()` returns all documents; `findFileById()` currently converts every lookup error to null. Neither operation is suitable unchanged for a recovery ledger. |
| [Quota arithmetic](../src/common/quota-policy.ts), [report helper](../src/users/quota.service.ts) | Exact integer-byte policies with BigInt arithmetic; decimal GB UI. Only explicitly `portal-managed` metadata is counted. Legacy/unmarked and `external-nas` entries are excluded. Duplicate IDs, missing sizes and inconsistent ownership are handled conservatively as documented in [7F](development-session-7f.md). This is metadata reporting, not filesystem reconciliation or upload enforcement. |
| Quota modes | Numeric limit, explicit Unlimited and Not configured are distinct. User override, including Not configured, takes precedence over the default; absent/null override inherits. Lowering storage limits below existing usage is permitted without deleting data. |
| [Account state](../src/common/account-state.ts), [guard](../src/common/guards/auth.guard.ts) | Protected requests reload the user and compare session versions. Pending/rejected, disabled and Closed accounts cannot access protected routes. Reactivation requires a new login. Closure retains account records and files. |
| [UsersService](../src/users/users.service.ts) | Serializes account and quota mutations in one process. Self-disable and last-active-administrator protections remain required. Bootstrap has a documented active-user-capacity exception, not a storage or upload bypass. |
| [CSRF](../src/common/csrf.ts), [startup](../src/main.ts) | CSRF accepts a body `_csrf` or `x-csrf-token`. Existing URL-encoded/JSON parsing is not a streaming upload implementation. Multipart form parsing must not consume file bodies before authentication/CSRF admission. Strict DTO validation remains enabled. |
| [Production Compose](../docker-compose.app.yml) | Legacy bind is read-only, requires `NAS_FILES_HOST_PATH`, and sets `create_host_path: false`. CouchDB data has a retained persistent volume; services are private. Redis sessions are not a durable upload journal. |
| [Dockerfile](../Dockerfile) | Node 22 Alpine, compiled application plus views/public assets. No runtime `USER` is selected, so the current app image starts as root. Moving the app to a verified non-root identity is a proposed upload-boundary change, subject to approval and legacy-read/bootstrap tests. |

Preserve the legacy read path and role semantics. An unknown managed schema/state must be denied, never interpreted as a public legacy record or redirected to the NAS root. Existing metadata is not automatically moved, reclassified or assigned a new owner.

## 2. Practical storage options

| Approach | Benefits | Costs and failure considerations |
| --- | --- | --- |
| **A. Dedicated DSM directory, explicitly provisioned bind mount (recommended)** | Clear separation from legacy files; operator can verify pool/share, ACLs and backups. Staging and objects can share one local filesystem. Streaming and promotion need no additional storage service. | Requires verified host path, identity and DSM ACLs. Out-of-band SMB writes must be prohibited. App has filesystem write authority within this directory, so non-root execution and restrictive ownership matter. |
| **B. Dedicated Docker named volume for managed files** | Persistent across container recreation when retained; fewer host-path coupling points. Same application commit protocol and streaming are possible. | Actual volume location, capacity and backup inclusion must be discovered. Accidental project-name changes can select empty storage; implicit volume creation weakens identity checks. DSM administrative visibility is less direct. An externally provisioned volume plus the same identity marker is required; never use the container writable layer. |

Both retain the separate read-only NAS mount. Neither gives a transaction spanning CouchDB and file storage. Docker explains the different ownership/location of [bind mounts](https://docs.docker.com/engine/storage/bind-mounts/) and [volumes](https://docs.docker.com/reference/compose-file/volumes/).

CouchDB attachments are another possible architecture, but would move payload capacity, backup size and compaction load into CouchDB. They are not recommended for this single-HDD, 4 GB target. An SMB/NFS upload mount, object-storage service or cloud scanner would add failure/operational assumptions and is deferred. Container `/tmp`, tmpfs and the image writable layer are not persistent staging locations.

## 3. Recommended directory, configuration and permissions

All names below are **proposed**, not current settings. Host values are placeholders that Justin must verify. Keep `NAS_FILES_DIR` and its existing bind exactly read-only.

```text
<VERIFIED_MANAGED_UPLOAD_HOST_DIRECTORY>/   # separate from legacy root and its ancestors/descendants
  .portal-storage.json                     # operator-provisioned schema + random storage UUID
  staging/                                # incomplete streams, generated names only
  objects/                                # immutable committed payloads, generated names only
  quarantine/                             # exceptional retained/recovery material; no downloads
```

Mount that single root at proposed container path `/var/lib/portal-bsc/uploads`; all three data directories must be on the same local filesystem and mount, with no nested mounts or symlink/junction components. A payload uses a generated opaque UUID key, without the original filename or extension. Start with flat directories and bounded directory iteration; large-scale sharding is a future schema decision. Never serve any of these paths as static assets.

| Proposed configuration | Meaning |
| --- | --- |
| `PORTAL_UPLOADS_ENABLED` | Explicit opt-in, initially false. Disabled preserves the current download-only deployment. It is not a quota bypass. |
| `PORTAL_UPLOADS_HOST_PATH` | Required existing absolute host directory when uploads are enabled. No default host path. |
| `PORTAL_UPLOADS_DIR` | Explicit absolute container root; proposed value above. No production mkdir fallback. |
| `PORTAL_UPLOADS_STORAGE_ID` | Expected operator-provisioned random UUID; must match the marker and CouchDB storage registration. Not a secret or proof against a hostile host. |
| `PORTAL_APP_UID`, `PORTAL_APP_GID` | Verified numeric runtime identity; no invented DSM user, UID or GID. Provision ACLs before starting. |
| `PORTAL_UPLOAD_MAX_BYTES` | Strict positive integer maximum file size, independently bounded by quotas. |
| `PORTAL_UPLOAD_MIN_FREE_BYTES` | Strict positive disk headroom; required deployment choice, allowing for DSM/CouchDB growth, logs and compaction. |
| `PORTAL_UPLOAD_ALLOWED_TYPES`, `PORTAL_UPLOAD_SCAN_POLICY` | Explicit reviewed allowlist and scan policy; invalid/unselected security policy keeps uploads unavailable. |

Concurrency, pending-intent count, timeouts and rate limits must also have documented, validated bounds. Suggested initial values **for review**: 1,000,000,000 bytes/file, two receiving/finalizing uploads globally, one per user, at most two outstanding intents per user and 16 globally, intent lifetime 10 minutes, transfer idle timeout 60 seconds and total transfer timeout 60 minutes. Reject excess work rather than building an unbounded memory queue. These are application budgets, not performance claims or chosen NAS settings. Also bound zero-byte/committed object counts and intent creation rate to prevent inode/database exhaustion; byte quotas alone cannot do this. Final values need approval.

Proposed Compose fragment, **not applied**:

```yaml
services:
  app:
    user: "${PORTAL_APP_UID:?Verify runtime UID}:${PORTAL_APP_GID:?Verify runtime GID}"
    environment:
      PORTAL_UPLOADS_DIR: /var/lib/portal-bsc/uploads
      PORTAL_UPLOADS_STORAGE_ID: ${PORTAL_UPLOADS_STORAGE_ID:?Verify storage identity}
    volumes:
      # Existing legacy NAS bind remains separate and read_only: true.
      - type: bind
        source: ${PORTAL_UPLOADS_HOST_PATH:?Select the existing managed-upload directory}
        target: /var/lib/portal-bsc/uploads
        read_only: false
        bind:
          create_host_path: false
```

This is an illustrative addition, not a complete deployment file or a request to deploy it. Configure all other validated upload settings explicitly. Provision a private root and subdirectories readable/searchable/writable only by the selected app identity and authorized backup/operator identities. Suggested POSIX baseline: directories `0700`, new files `0600`, process umask `0077`; DSM inherited ACLs must be checked as well, not assumed equivalent to mode bits. The operator controls the marker and parent directories; the app must not rewrite the expected identity during startup. A writable directory owner can replace entries, so the marker is an accidental-mount guard, not tamper-proof isolation.

Do not grant ordinary DSM/SMB users direct read or write access to managed payloads. Do not mount DSM homes, a whole volume, Docker socket or the legacy share writable. The non-root app must still read views/assets and legacy NAS files and execute bootstrap without modifying their ownership. CouchDB retains its existing separate identity/configuration. No privileged container or startup recursive `chown` is proposed.

### Startup and storage readiness

When uploads are enabled, missing/invalid root, missing policy configuration or wrong storage identity fails upload-enabled production startup. A running instance that loses storage/DB consistency closes upload admission and reports degraded readiness; legacy availability may continue only where existing guards and storage checks permit. The operator may explicitly restart with uploads disabled to retain the download-only service. Never silently downgrade an enabled writer to ephemeral storage.

Preflight checks: absolute canonical roots, non-overlap, existing expected directories/marker, regular non-symlink marker, device/mount consistency, effective ACLs/UID/GID, disk statistics and reconciliation. Under the managed root only, use an exclusively created opaque probe to verify actual create/write/sync/read/link/unlink permissions and cleanup. No probe or marker is created in the legacy NAS root. Failure to clean up the probe is a readiness failure. Directory existence and `access()` alone do not prove effective write access, correct storage, no race or durability.

Docker documents [Compose bind options](https://docs.docker.com/reference/compose-file/services/#long-syntax-5), including disabling automatic host-path creation. Synology documents [Compose-backed Container Manager projects](https://help.synology.com/developer-guide/resource_acquisition/docker-project.html); this does not establish the version or behavior installed on Justin's NAS. Before any future deployment, validate the actual configuration and use a disposable missing-path fixture to verify rejection without directory creation. If unsupported, stop and select an approved compatible Compose CLI or Engine `--mount` operation plus explicit identity preflight; do not remove safeguards or accept an auto-created empty directory.

## 4. Uploaded-file authorization: approval required

Use a discriminator for managed-upload authorization; do not reuse broad member role grants.

| Actor/state | Proposed managed-file access |
| --- | --- |
| Owner, active approved account | List, details and attachment download of their committed files. A deletion request still pending does not itself disable the account. |
| Other member | Denied by default, including guessing an object ID. No metadata, existence, filename, owner or hash disclosure; consistent 404 for unauthorized/nonexistent IDs. |
| Explicit recipient | Optional deliberate sharing with selected active approved user IDs; download only, no resharing or ownership transfer. Recommend deferring sharing controls until separately included in 7G-B approval. Never infer recipients from role. |
| Active administrator | Recommend explicit privileged read access to committed managed files for support/retention review, disclosed to users and audited on successful download. This is a new policy requiring approval; it does not grant broader access to legacy role-restricted NAS files. |
| Anonymous/public internet | No uploaded-file access, public URLs or anonymous sharing. Reject `visibility`, `allowedRoles`, owner, storage path and commit-state fields submitted by upload clients. |
| Disabled/Closed owner or recipient | Existing sessions fail; no new upload/commit. Retain ownership/account/file records and quota charges. Recommend suspend recipient access to a Closed owner's files pending administrator disposition review; disability alone leaves existing deliberate grants intact. Administrator review remains possible. This closure-sharing policy requires approval. |

An owner cannot evade quotas by sharing. Global usage counts the object once; owner usage stays with the immutable owner. No automatic ownership reassignment on closure, no release of quota by closing an account, no file deletion and no reopening of Closed accounts. A newly created account with a reused display name is not the old owner: IDs, never usernames/emails, are authoritative.

One backend authorization function must govern list, dashboard, details and download for both schema families. Managed files must be committed and eligible before any filesystem open. Pending, failed, quarantined and unknown states are never downloadable, even by an administrator through the ordinary endpoint. Keep legacy role authorization and safe read mechanics intact. Approval of the schema/policy is required before changing this function.

## 5. Proposed persistent metadata

Extend the existing `portal_files` database rather than adding a fifth database. One stable document serves as intent, reservation journal and eventual file metadata; there is no separate reservation-to-file insert that can lose or double-charge capacity. The following are proposed fields, not an implemented interface:

| Field | Purpose |
| --- | --- |
| `_id`, `_rev`, `type: file`, `schemaVersion: 2` | Stable user-scoped retry-derived document identity and revision-checked state transitions; separate random payload key. Legacy records remain their current schema. |
| `storageScope: portal-managed`, `storageId`, `objectKey` | Explicit provenance and opaque payload identity. No arbitrary host path or user-supplied root. |
| `accessModel: owner-acl-v1`, `uploadedByUserId`, `sharedWithUserIds` | Server-set immutable owner and initially empty, validated recipient IDs. Existing uploader field remains the quota attribution key. |
| `upload.state` | `reserved`, `receiving`, `prepared`, `committed`, `cleanup-pending`, `aborted`, or `quarantined`. Unknown state fails closed. |
| `upload.declaredBytes`, `upload.reservedBytes` | Canonical integer-byte strings; bounded to the accepted safe-integer file range. Retained until commit or verified cleanup. |
| `upload.idempotencyDigest`, `upload.requestFingerprint` | User-scoped retry identity bound to size and canonical metadata; not a bearer credential. The lookup is persistent and unique under the single writer. |
| `upload.startedAt`, `expiresAt`, `preparedAt`, `committedAt`, `attemptId` | Recovery and timeout decisions. Times are not sufficient evidence of an inactive writer. |
| `sizeBytes`, `sha256`, `detectedMediaType`, `scanResult` | Server-measured size/hash and bounded validation result. Committed `sizeBytes` remains a safe integer for current reports; compute with BigInt first. A hash is integrity evidence, not a malware verdict. |
| `title`, `description`, `originalFilename`, existing timestamps/category | Validated display metadata; original name is never an on-disk path. No HTML interpretation. |
| `upload.auditOutbox` | Minimal deterministic events persisted with the state transition and delivered idempotently to `portal_audit`; no file body or credentials. |

The pending document is not a readable file simply because it has `type: file`. Update schema validation, selectors, all render paths and usage reporting together. Reporting separates committed usage, reserved capacity, quarantined/uncertain charges and known physical staging bytes. Current `collectUsage()` must not sum a pending object's declared size as though it were committed or omit its reservation. Original unschematized managed metadata stays accounted as in 7F, but unresolved storage provenance blocks new uploads until reviewed; no automatic data migration is approved.

The managed ledger must propagate DB errors, distinguish real 404 absence, validate stored revisions/schema and reject conflicts. Current catch-all `findFileById()` is unsuitable for deciding that a timed-out write did not happen. A dedicated strict ledger adapter is preferable to changing unrelated legacy error behavior. New IDs/idempotency mappings require explicit persistence methods rather than repeated calls to current random-ID `createFile()`.

## 6. Quota admission and commit rules

Adopt Justin's preferred policy: **if the global quota or effective user quota is Not configured, reject new upload intents and new commits until that applicable policy is explicitly configured.** An explicit numeric or Unlimited override is an effective user policy even when the default is Not configured. An explicit Not configured override blocks that user even when the default is numeric. Unlimited lifts only that logical byte limit, never authentication, physical-space, size, rate, count or integrity controls.

For a numeric policy and declared byte count `B`:

```text
global charge = committed managed bytes + outstanding reserved/uncertain bytes
owner charge  = owner's retained committed bytes + owner's reserved/uncertain bytes
admit only if global charge + B <= global limit
          and owner charge  + B <= effective user limit
```

Count each object/reservation once, including quarantine/cleanup-pending while bytes may remain. Retained Closed/disabled owners' files continue to count. No deduplication discount for equal hashes. Legacy NAS/SMB files remain outside these logical quotas. Physical disk safety is a separate condition and must account for their competition for space if they share a pool.

Use the existing byte precision, canonical validation and BigInt sums from 7F. Reject malformed, overflowing, duplicate-conflicting or unowned managed accounting; never treat errors as zero usage. Recommend blocking **all new uploads**, including Unlimited users, while global accounting or ownership attribution is incomplete. Readable healthy committed files can remain available. Unknown physical objects also require reconciliation, not a guessed owner or hidden zero charge.

Zero-byte files are valid only when both policies are configured, both accounts/totals are otherwise eligible and at/below their caps, and count/rate/space limits permit. They receive an empty-file hash and metadata, not an exemption from those controls. At a numeric zero quota, only such empty files fit. Already over-quota accounts cannot commit another file, including an empty file. Existing downloads are unaffected by over-quota state.

### Shared coordination and policy changes

Use **one shared short mutation coordinator** for upload admission/finalization, quota changes and account status/closure decisions, extending the existing single-instance UsersService coordination through a common primitive. Independent locks in UsersService and UploadService would leave races. Do not hold the mutation lock during the network transfer, scanning or full-file hashing. Limit lock-held finalization to bounded metadata/filesystem transitions; set DB timeouts. Avoid nested acquisition/deadlocks with existing methods.

Under that coordinator, load fresh policy/account versions and complete trusted accounting before reserving. Persist the full declared size before creating any payload. Maintain the reservation for the entire operation; never reserve only the first chunk. The declared size is untrusted but enforced exactly: reject excess bytes before forwarding them to disk and reject short bodies at completion. Unknown-size/chunked transfers need an explicit declared size in the intent and the same counter; arbitrary growing/resumable uploads are deferred.

At finalization reload current active account/session version, effective policy, reservations and storage readiness, then revalidate both charges under the same coordinator. Reload the live session from the existing session store as well: the request's cached session object is not proof that logout, expiry or session destruction has not occurred. Session-store failure blocks commit; Redis does not become the reservation store. A changed/expired/destroyed session, closure, disabled account, Not configured policy, lower quota or integrity inconsistency can cancel an in-flight upload. Existing 7F policy edits may lower limits below usage; they cannot retroactively remove committed files. Mark affected transfers for cancellation and require commit-time checks regardless of cancellation notification. Finalization must not rely on the policy snapshot taken at admission. Revalidate logout ordering in HTTP concurrency tests; do not change existing Redis/session or bootstrap policy as a workaround.

Converting this object's reservation into committed usage occurs in the **same document update**, so the total charge never disappears between two writes. Other reservations remain charged during the calculation. A quota reduction can leave already committed usage over limit, but no later successful upload may increase usage past an applicable numeric limit. Account closure concurrent with finalization is ordered by the shared coordinator: closure first blocks commit; commit first retains/charges the file and subsequent closure revokes access. Pending deletion requests alone do not close accounts. Preserve self-disable/last-admin and bootstrap recovery rules; no bootstrap storage bypass is added.

This is one Node process and one writer for the managed root/database, not Redis-distributed locking, a clustered guarantee or protection from independent database edits. Redis may disappear/restart without losing a reservation journal. Do not run parallel replicas, overlapping old/new app containers or a standalone upload writer. A second writer or external metadata edit requires stopping admission and reconciling. Horizontal scaling remains separately authorized work.

### Physical space and staging budgets

Before admission, use actual available filesystem space and conservatively subtract unwritten reserved capacity, per-file allocation/metadata overhead and the configured minimum-free watermark. Already-written staging bytes have reduced reported free space; do not charge them twice. A conservative upper bound is acceptable when exact physical allocation is unknown. Enforce a separate bounded total staging/reservation budget even when logical quotas are Unlimited. Zero-byte objects still need inode/database space.

Recheck during transfer and before commit, including CouchDB's volume if different. Refuse admission on unknown space information; handle actual `ENOSPC`, `EDQUOT` and `EIO` on every write/sync. Another DSM/SMB writer can consume space after a check, so no absolute disk-availability guarantee is claimed. Reserve headroom for database/log growth and compaction; CouchDB documents that [compaction may temporarily require roughly twice a database's space](https://docs.couchdb.org/en/stable/api/database/compact.html#db-compact). Quotas represent logical bytes, not physical block allocation, backups, snapshots or the entire NAS capacity.

## 7. Streaming, request and content safety

Recommend a two-request browser flow using a small self-hosted external script permitted by existing CSP:

1. A small JSON upload-intent POST carries metadata, declared exact file size and a bounded idempotency key. Actual AuthGuard/session validation, CSRF and strict DTO validation run before reservation. Reject client-supplied role, status, ACL, owner, path and quota fields.
2. An authenticated body PUT for that intent carries `application/octet-stream`, the current `x-csrf-token`, and the raw File/Blob body. The intent ID is not authority: bind it to the authenticated user and session version, validate current status and allow only one receiving attempt. Reject unsupported content type/encoding, multiple files, multipart and compressed request bodies rather than adding an implicit parser.

The existing CSRF header mechanism can validate before stream consumption. Restrict the raw route so global JSON/form parsers and Nest interceptors do not buffer its payload. Verify middleware/guard order through real HTTP, not an assumed order. Check length headers for inconsistency when present, but do not mistake multipart/request Content-Length for a file's size. The observed byte counter is authoritative. Do not put CSRF/session/intent bearer tokens in query strings or logs. Keep strict same-origin behavior, secure cookies, existing proxy trust and Helmet/CSP; do not enable broad CORS or inline handlers. Without JavaScript, display a clear unavailable-upload message; a native multipart alternative needs separate review of pre-body admission.

Use a backpressured stream pipeline with bounded buffers, byte count and incremental SHA-256. Abort on disconnect, timeout, invalid length, scan failure or storage error; stop accepting bytes and close all handles. Node documents [pipeline abort/error behavior](https://nodejs.org/docs/latest-v22.x/api/stream.html#streampipeline), but pipeline completion alone is not a durable upload. Keep proxy buffering/spooling bounded or disabled specifically for this future route; align proxy limits/timeouts and test them later on the selected DSM proxy. Do not buffer complete files in RAM, decompress archives, create previews or run uploaded content.

Validate original display filenames with a strict length/Unicode/control-character policy. Reject traversal, path separators, NUL, CR/LF, drive/alternate-stream syntax, reserved device names, trailing dots/spaces and malformed encoding. Do not silently rewrite an unsafe path into an acceptable one. Escape titles, descriptions and filenames in templates; encode attachment headers safely. Generate every stored key server-side from an opaque ID. Download MIME comes from a trusted validated policy, not a client MIME string; retain attachment disposition and `nosniff`, use private/no-store responses and no inline previews for managed content.

Require a reviewed allowlist and bounded signature/content checks. Candidate initial types for review are plain UTF-8 text, PDF, JPEG and PNG; do not treat that list or magic bytes as proof of safety. PDFs/images may exploit clients and text may contain harmful instructions. Deny executables, scripts/HTML/SVG, macros, archives and unsupported/encrypted formats initially. No archive extraction, shell commands, dynamic imports, user-selected template names or path-driven processing.

Malware choices require a decision before enabling uploads:

| Choice | Consequence |
| --- | --- |
| Required scanner before commit | Stronger screening; unavailable/stale/error/timeout verdict keeps the object non-downloadable and charged until cleanup. Requires an approved scanner integration, update policy and resource measurement. No service/package is added in 7G-A. |
| Restricted types without AV | Lower resource cost, but cannot claim malware-free content. Requires explicit risk acceptance; record `not-scanned`, never `clean`. Owner-private storage does not make dangerous downloads harmless. |
| External scanning service | Additional data disclosure, credentials, availability and cost; outside current approval. |

Recommendation: decide the scanner/risk policy explicitly; leave upload readiness closed until selected. Do not assume a resident ClamAV service fits alongside DSM/CouchDB/Redis in 4 GB. Benchmark any selected scanner with bounded concurrency and signature updates on disposable resources. A timeout or lack of RAM must not silently skip scanning. No production scanner or SMTP/cloud service is authorized here.

## 8. Recoverable file/metadata commit protocol

There is **no atomic transaction between CouchDB and the filesystem**. The design promises ordered, recoverable states under the stated trust assumptions, not perfect survival of drive failure or host tampering.

Use a same-filesystem **no-overwrite promotion by hard-link then unlink**, rather than assuming Node's ordinary rename is no-replace. Linux [link semantics](https://man7.org/linux/man-pages/man2/link.2.html) refuse an existing destination; [ordinary rename can replace it](https://man7.org/linux/man-pages/man2/rename.2.html). The deliberate two-link window is internal, journaled and never downloadable; committed objects must have one link. This avoids a second payload copy while retaining exclusive destination creation. It requires filesystem support confirmed by preflight/tests; do not fall back silently to cross-device copy or overwriting rename. Native no-replace rename could be a future alternative but needs its own compatibility review.

| Step | Durable/state action and invariant |
| --- | --- |
| 1. Admit/reserve | Under shared coordinator, authorize, validate metadata, locate user-scoped idempotency identity, recheck policy/usage/disk, choose immutable object ID and persist `reserved` with full byte charge. Confirm an ordinary synchronous DB acknowledgement before any payload write. Unknown outcome stops admission until resolved by strict read. |
| 2. Begin receiving | Revision-check `reserved -> receiving`, bound to user/session/attempt. Exclusively create an opaque staging file using `O_CREAT | O_EXCL`, restrictive mode and no-follow support. No overwrite/reuse and no arbitrary path. Confirm regular file, identity and link count. A crash after creation still has a pre-existing durable reservation. |
| 3. Stream/verify | Stream exactly the declared bytes with SHA-256, limits and cancellation. Perform bounded content validation/selected scan. Sync the file and staging directory and close write handles; record measured size/hash and `prepared` in the same journal document. No ordinary file access yet. |
| 4. Revalidate/promote | Under shared coordinator, reload account/session, current quotas and all charges; check current filesystem identity and size/hash evidence. Link verified staging inode to exclusive `objects/<opaque-key>`. Sync destination directory. Unlink the known staging alias, sync staging directory and verify the final inode is a regular file with `nlink == 1`, correct size and identity. Any surprise collision/link/path state blocks rather than overwrites. |
| 5. Commit metadata | With the coordinator still held, revision-check `prepared -> committed`, set measured metadata, replace this reservation charge with committed bytes and persist a deterministic upload audit outbox event in the same document. Obtain the durable DB response; no batch acceptance. Read back exact ID/revision/state through the strict adapter for completion verification. The payload is already promoted and synced before readable metadata exists. |
| 6. Acknowledge | Only now return successful committed-upload status and a stable file ID. An earlier intent response only means reserved, explicitly not uploaded. Audit delivery can be pending because the event itself is durably in the outbox. Disconnect after commit does not roll back/delete the file; a status/retry returns the same result. |

Use validated roots/parents, `lstat`/canonical containment and descriptor identity checks for all operations. The deliberate two-link state is accepted **only** for this prepared journal's exact staging/object pair with matching device/inode/hash; arbitrary links, extra aliases or a link elsewhere are rejected. No client can request a hard link. New committed reads must reject unexpected links; legacy hard-link provenance remains its documented limitation rather than an unapproved retrofit.

Node 22 supplies the needed [filesystem primitives](https://nodejs.org/docs/latest-v22.x/api/fs.html) for exclusive opens, links, identity checks, file sync and filesystem statistics. Directory sync, no-follow behavior and Windows ACL/handle semantics require platform tests. Path checks do not stop a hostile root/host administrator or a process with the same write identity from replacing parents between calls. Trusted private parents, no other writers and the non-root container are required assumptions; portable Node path APIs are not an `openat2` security sandbox.

For CouchDB 3, do not add `_ensure_full_commit` as supposed extra durability: it is a [deprecated no-op and delayed commits are disabled](https://docs.couchdb.org/en/stable/api/database/compact.html#db-ensure-full-commit). Use normal non-batch document writes, check actual adapter response semantics and revision conflicts; the [document API distinguishes stored-on-disk 201 from accepted-but-not-durable 202](https://docs.couchdb.org/en/stable/api/document/common.html#put--db-docid). A successful read alone is not evidence that a prior 202 became durable. Do not use async/batch acknowledgements for this protocol.

File sync, directory sync and DB acknowledgement provide application ordering, conditional on OS/filesystem/device guarantees. They are not a two-resource atomic commit and do not establish power-loss safety of the actual DS925+, drive write cache or backup. Windows developer tests may demonstrate process-crash recovery but cannot certify Linux/Btrfs power-loss behavior. A failed required durability primitive keeps production uploads unavailable; do not silently claim equivalent durability on an unsupported backend.

### Idempotency and audit behavior

Scope a bounded, browser-generated random retry key to immutable user ID. Derive the document ID deterministically from a namespaced digest of that pair, while generating a separate random opaque payload key. Store the digest/fingerprint in that one document; do not insert a separate mapping that could be lost after creating the journal. Creation is serialized and revision-checked, so a crash/retry addresses the same document even when an acknowledgement was lost. Repeat same key/parameters returns the existing intent/result; different parameters return 409. Only one attempt may receive bytes. A failed/expired key remains a terminal result; starting afresh requires a new key. A lost response must not allocate another object or create another audit event. A new intentional key is a new object and consumes quota again; content deduplication is deferred. The ID/digest is not authorization, and status lookups must still verify the current authenticated owner.

Record events such as upload committed/rejected/aborted/recovery-blocked with actor ID/username snapshot, file ID, owner ID, measured bytes/hash where appropriate, timestamp and bounded request context. Do not store passwords, cookies, CSRF/idempotency tokens or raw content. Successful transitions place deterministic event IDs in the file document's outbox; replay to `portal_audit` uses that ID, verifies conflicting existing payloads and is idempotent. Crash after delivery but before marking delivered must not duplicate the audit. Cap outstanding outbox backlog and fail new admission if it cannot be serviced safely.

This proposes reliable delivery for **new upload events only**. It does not claim atomic audit visibility in `portal_audit`, or silently repair the previously documented non-atomic account/settings/download auditing. Existing records and bootstrap policy remain untouched.

## 9. Failure, cancellation and recovery

Release a reservation only after its known uncommitted payload/aliases are verified removed and the containing directory cleanup is synced. Then persist `aborted`/released charge. A crash before that update over-reserves safely. Cleanup failure remains `cleanup-pending` and charged; never free capacity on a timer while bytes may still exist. Keep a bounded journal entry for retry/audit history. No automatic committed-file deletion or broad recursive cleanup is proposed.

| Failure point | Required outcome |
| --- | --- |
| Before durable reservation | No payload is created; rejection has no storage effect. |
| Reservation write times out | Strictly read the known ID/key; block further admission while outcome is unknown. Never infer absence from a generic DB exception. |
| Short/oversized body, client cancellation, idle/total timeout, invalid type | Abort pipeline, close handles, cleanup known staging entry; retain charge on any cleanup uncertainty. No readable file or success response. |
| Disk full, permission/read-only change, write/sync/close error | Same cleanup protocol, generic controlled HTTP error or aborted connection, operator diagnostic without public filesystem paths. Keep process alive. |
| DB unavailable during stream/finalize | Stop/abort as soon as detected; no metadata fallback. If cleanup can safely run, keep persistent reservation charged until DB recovery acknowledges release. |
| Crash with `reserved`/`receiving` | On startup there is no trusted old worker in the single-instance model. Validate its known entries, abort/clean incomplete bodies and release only after verified cleanup. No automatic partial upload resume. |
| Crash with `prepared`, staging only | Strictly establish it was not committed, validate its known staging entry and abort/clean it. Initial release does not automatically commit unacknowledged in-flight uploads after restart; the user retries with a new intent after confirmed cleanup. |
| Crash after link, before unlink | Verify the two expected aliases are the same regular inode and match journal evidence. After confirming uncommitted state, remove only this known pair under the cleanup protocol. Unexpected alias/link count requires quarantine/operator review. |
| Crash after promotion, before committed DB write | Prepared journal still reserves capacity. Strictly resolve the DB outcome first, then abort/clean only the positively identified uncommitted object. Never generate another file document, and never remove a possibly committed object while the outcome remains uncertain. |
| Commit response/readback lost | Treat result as uncertain; status/recovery reads the exact ID. Never delete an object that might already be committed. No successful response until resolution. |
| Crash after commit, before response/audit delivery | Retain committed object/charge; retry/status returns original result and replay deterministic pending audit. |
| Committed payload missing, corrupt or unexpectedly linked | Deny download, retain logical charge, flag unavailable/quarantined and stop uploads pending reconciliation. Do not pretend it uses zero bytes or substitute another NAS path. Restore/review, not silent metadata deletion. |
| Unknown file, wrong storage marker, orphan or conflicting ledger | Close upload admission, report discrepancy and retain files. Do not automatically delete it, assign it to an administrator or make it downloadable. |

At startup with uploads enabled, recover **before** upload readiness: verify storage identity, enumerate the managed directories without following links, page/validate the ledger, reconcile every object/intent and rebuild committed/reserved/uncertain totals. Initial release aborts definitively uncommitted interrupted work rather than attempting to resurrect its old authenticated request; committed objects survive and uncertain outcomes remain blocked until resolved. Stream hashes with one recovery worker; do not load payloads or the entire directory tree into memory. Admit no uploads while completeness is unknown. Keep legacy downloads available only if their existing dependencies allow it; managed reads require verified committed objects. A large full hash scan on one HDD can delay readiness, so report progress and allow an explicit download-only maintenance mode, not a bypass.

During operation, run bounded reconciliation and health checks through the same coordinator for state changes. Never delete a live upload just because an expiry time elapsed: cancellation must stop its actual worker and close handles before cleanup. Observe in-process attempt ownership as well as persistent state. On graceful shutdown stop admission, abort/drain workers within a bound, close handles and leave recoverable charged journals; on forced termination startup performs the same recovery.

Automatic cleanup authority is limited to **positively identified uncommitted staging/promotion entries created by this protocol**. Unknown data, retained committed objects, legacy NAS files, accounts and volumes require operator review and explicit disposition/restore policy. No such cleanup runs in 7G-A.

## 10. DS925+ provisioning, expansion and restore checklist

These are prerequisites for a later, separately authorized deployment. No NAS was accessed.

1. Justin verifies actual DSM/Container Manager/Compose versions, filesystem/pool identity, available space, backup support and selected absolute host directories. The legacy and managed roots must be separate, non-overlapping and backed by the intended storage. Do not copy example paths from other documents as facts about this NAS.
2. Select/provision the app UID/GID and verify DSM shared-folder/file ACL inheritance, effective permissions and isolation from ordinary SMB users. Confirm the exact image identity and legacy reads from inside a disposable container. See Synology's [shared-folder permission controls](https://kb.synology.com/en-global/DSM/help/DSM/AdminCenter/file_share_privilege?version=7); actual ACL values remain unverified.
3. Provision the managed root, directories and random identity marker deliberately; record storage UUID in protected deployment configuration and a CouchDB storage-registration record. Registering a first empty root must be an explicit operator action, not automatic acceptance of whatever directory appears. Do not initialize over existing files without approved reconciliation.
4. Validate Compose and missing-path/read-only tests on disposable paths with the installed tooling. Verify effective mounts from inside the container, legacy writes fail, managed writes succeed as non-root, no root replacement occurs, and link/sync/rename behavior matches the selected backend. Stop if compatibility or ACL checks fail.
5. Choose max-file, staging, object-count, rate, concurrency and physical headroom budgets; measure DSM + CouchDB + Redis + app memory and I/O with two bounded streams. Confirm proxy limits and HTTPS/secure-session behavior. Do not infer available bytes from the 20 TB label or promise line-rate throughput.
6. Keep storage UUID and container logical root stable during expansion. Adding drives may initially add redundancy rather than usable capacity; [Synology explains single-drive SHR expansion](https://kb.synology.com/index.php/en-global/DSM/help/DSM/StorageManager/storage_pool_expand_add_disk). Verify usable space after changes, retain headroom and adjust logical quotas only by explicit admin action. No drive addition/migration/formatting is part of this session.
7. Back up CouchDB databases, managed objects, recovery journals/outbox, storage marker and protected configuration as a consistent set. Pause admission, drain/resolve in-flight operations and take a coordinated filesystem/database backup with the selected supported tools. A CouchDB-only backup does not back up payloads; a payload-only snapshot does not reconstruct authoritative ownership/ACLs. Independent snapshots of live resources may disagree.
8. Restore offline to disposable storage first, retain IDs, verify hashes/ACLs/charges, reconcile missing/extra objects and replay outbox events before readiness. Do not silently register a different empty root. Test documented recovery objectives and off-device backup restoration before deployment approval. Snapshot retention consumes extra physical space and is outside logical file quotas.

**One physical HDD in SHR has no drive-failure redundancy.** Synology lists [single-drive SHR as without data protection](https://kb.synology.com/en-ro/DSM/tutorial/Without_data_protection). Persistent containers/volumes, application hashes and same-device snapshots do not recover a failed drive. Off-device tested backup is required for meaningful recovery; additional drives/UPS may reduce other risks but are not assumed installed. No backup service or NAS configuration is introduced here.

## 11. Threat assessment and Release 1 boundaries

| Threat | Proposed control | Remaining risk |
| --- | --- | --- |
| ID guessing, role/owner injection, cross-user leakage | Active sessions, CSRF before body, strict DTOs, owner/ACL discriminator, one authorization service, no pending-file visibility | Administrator privileged access and sharing policy need explicit review; XSS/compromised credentials remain relevant. |
| Traversal, symlinks/junctions, device files, hard-link escape | Opaque generated names, exclusive opens, trusted parents, regular-file/inode/link checks, no-follow support, separate roots, no direct SMB writers | Host root/same-UID compromise and parent replacement are outside portable path-check guarantees. |
| Quota race/retry abuse | Durable full-size reservations, shared coordinator, current-policy checks, stable idempotency identity | Single writer only; not safe with multiple app replicas or independent DB writers. |
| Disk/RAM/CPU exhaustion, many empty files, slow clients | Backpressure, byte/count/rate/concurrency/time/space budgets, bounded scanning/reconciliation | External NAS writers and HDD contention can still cause safe failures; hardware needs load measurement. |
| Malicious content, MIME spoofing, stored XSS | Validated allowlist, explicit scan policy, escaping, attachment/nosniff/no-store, no previews/execution | No file-type/hash test proves content harmless; scanner bypass/staleness and client vulnerabilities remain. |
| DB/FS split writes, restart, uncertain responses | Persistent state machine, sync ordering, strict reads, continued charges, startup recovery, deterministic outbox | No cross-resource atomicity, actual power-loss certification or drive-failure tolerance. |
| Closure used to free quota or restore revoked access | Retained immutable owner/charge, current status/version checks at commit and download | File disposition, ownership transfer and retention duration require later policy. |
| Backup mismatch, wrong/empty mount | Explicit storage identity, no production mkdir, coordinated backup/restore rehearsal | Marker can be copied/forged by privileged host; untested restore is not recovery evidence. |

Deferred beyond the initial upload release unless separately approved: distributed coordination, resumable/chunk-restart transfers, external/cloud scanning, public links, role-wide uploaded-file sharing, file edits/version replacement/deduplication, thumbnail/transcoding/archive extraction, automated ownership transfer/permanent deletion, automatic NAS migration and host-compromise isolation. A cryptographic hash is not encryption; at-rest encryption and key recovery require DSM/deployment decisions, not an implicit application promise.

## 12. Phase 7G-B RED → GREEN → REFACTOR acceptance plan

No upload test has been written or executed in 7G-A. The following is a plan, not passing evidence. Reuse current regressions; add meaningful tests before each production behavior change, record actual RED causes, implement the minimum and rerun targeted plus full suites. Correct existing behavior should be characterized without artificial failures.

| Area | Required executable acceptance and fault evidence |
| --- | --- |
| 1. HTTP admission/CSRF | Actual Nest routes, real session/guards/CSRF/DTOs; anonymous, pending, disabled, Closed and stale-version denial; wrong/missing/header CSRF, content type, body encoding and injected owner/role/path fields. Assert no reservation/file before acceptance and no request buffering. |
| 2. Ownership/visibility | Owner succeeds; another member receives 404 with no metadata; approved admin policy and deliberate recipients only; anonymous/public denied. Cover list/dashboard/details/download, malicious display values, empty roles and closure-sharing behavior. |
| 3. Exact quotas | Default/override precedence and removal; global and user Not configured denial; Unlimited distinction; zero bytes, zero budget, exact boundary and one byte over; large precise sums, retained owners, pre-existing over-limit data and lower-policy changes during transfer. |
| 4. Concurrency | Deterministic barriers pause two real HTTP streams competing for the last bytes. Verify one succeeds where only one fits; no overlap in receiving attempts for an intent. Race global vs user capacity, policy edits and disable/closure. Assert total committed plus remaining reservations, not merely HTTP statuses. |
| 5. Corrupt metadata | Real CouchDB fixtures with missing owner/size, unknown scope/state, conflicting duplicates/revisions, malformed policy and missing files. Assert fail-closed admission and honest incomplete reporting, including Unlimited cases. No zero fallback. |
| 6. Body/content abuse | Long/short/chunked-with-declared-size bodies, dishonest length, oversized headers/fields, byte-limit crossing mid-chunk, forbidden/mismatched signatures, invalid names, many empty files, slow clients and connection aborts. Selected scanner clean/malicious/stale/timeout/OOM/unavailable paths; no swallowed failures. |
| 7. Filesystem boundary | Temporary private roots with traversal, separators, ADS/device names, symlink/junction file and parent swaps, directories/FIFOs, unexpected hard links and destination collisions. Plant an outside sentinel; assert its bytes/metadata stay unchanged. Confirm exclusive creation and committed one-link invariant. |
| 8. Crash/cleanup | Child-process kill at deterministic protocol checkpoints: after reserve/create/stream/sync/prepared/link/unlink/commit/audit delivery. Restart fresh instance with same DB/root and prove recovery/accounting/idempotency; cleanup failure retains charge. No arbitrary sleeps as correctness evidence. |
| 9. Real DB failures | Stop/unreachable CouchDB before reserve and after prepared/promotion; inject connection loss after actual DB acceptance before response. Test revision conflicts and strict 404 versus outage. Verify uncertain writes cannot produce a duplicate/free reservation or success. Restore service and reconcile. |
| 10. Real FS failures/integrity | Read-only mount/permission denial, missing mount/marker, disk exhaustion on a disposable size-limited Linux filesystem, and write/link/unlink/sync/close failures. Use narrow injectable operation boundaries for otherwise nondeterministic faults, plus real filesystem/container checks. Corrupt/truncate a prepared/committed payload and verify hash/length detection and blocked readiness. Never fill a developer/NAS disk. |
| 11. Legacy downloads | Existing role-limited/public-to-authenticated/empty-role rules, unauthorized metadata denial, streaming/error/audit headers/content stay unchanged. Legacy root remains `EROFS`; managed reads cannot fall back there. No static access to staging/objects. |
| 12. Accounts/audit | All 7D/7E/7F administrator, capacity/bootstrap and session regressions retained. Logout, session expiry/destruction and closure mid-upload; no auto deletion/reassignment/quota release. Real CouchDB upload outbox replay, deterministic event collision, audit outage/backlog and correct actor/owner context; no credentials logged. |
| 13. Persistent containers | Create a managed file through HTTP in production image, restart/recreate app and CouchDB using retained disposable storage, verify bytes/hash/owner/quotas/audit via a fresh instance. Verify no payload in image layer and retain named volumes; no `down -v`. |
| 14. Real services/Docker | Full real Redis/CouchDB suites and production HTTPS/session smoke, Compose validation/missing-path/ACL/identity/preflight, TS build, Docker build/start/bootstrap, absence of compiled tests, clean full/production audits and dependency tree. No mocked service replacement for integration evidence. |
| 15. Windows/Rider | Windows temporary-directory streaming/cancellation/idempotency/restart tests plus existing watch/debug lifecycle; Linux tests for production sync/ACL/link primitives. Report genuinely unsupported operations separately. Provide exact Rider attach/source-map/start/stop checklist when interactive validation is unavailable; no invented Rider pass. |

Fault injection must assert persisted ledger revisions, actual directory entries/inodes, hashes, response completion and audit IDs at each boundary. Transport tests must lose real acknowledgements, not simply throw before an operation. Every temporary target is resolved and checked inside the disposable fixture root before cleanup; no recursive cleanup outside it, production credentials, NAS paths or deleted retained volumes. Use bounded polling/event signals to coordinate workers and cancellation.

## 13. Decisions for Justin and independent review

Approval of 7G-A documentation is **not** implementation authorization. Before 7G-B, decide:

1. **Storage and identity:** approve dedicated local DSM bind approach A, explicit non-root app execution, storage registration/marker and required durability preflight. Justin supplies verified host directory, UID/GID, ACLs and installed platform versions later; no invented values or provisioning now.
2. **Access model:** approve owner-private default and explicit administrator managed-file access. Decide whether recipient sharing belongs in the first implementation or remains deferred; approve closure suspension if sharing is included. No new public or broad role access.
3. **Quota behavior:** approve rejecting either applicable Not configured policy, fail-closed incomplete accounting, full-size persistent reservations, same charge through cleanup/quarantine and commit-time revalidation alongside account/quota changes.
4. **Transaction/schema:** approve versioned managed file journal in `portal_files`, the controlled two-link promotion window with final one-link invariant, stable user-scoped idempotency, startup reconciliation and upload-specific durable audit outbox. These are necessary new behaviors, not claims about existing 7F guarantees.
5. **Content policy:** choose initial allowed types and required scanner integration, or explicitly accept the restricted-type/no-AV risk. No silent scanner bypass or new external/cloud package/service. An unapproved scanner dependency would require separate review.
6. **Resource budgets:** select maximum file size, concurrent streams, outstanding/committed object counts, rates/timeouts, staging budget and free-space headroom. Approve the header-CSRF/two-request browser flow and its external CSP-compatible script; no-JavaScript multipart support is deferred.
7. **Operations and release gate:** retain one app writer, no overlapping containers, fail-closed recovery, no automatic committed/unknown-file deletion and no quota release on closure. Agree on off-device backup/restore verification and separately authorized NAS preflight before any deployment.

## 14. Verification and publication record

The reviewed starting SHA/branch and preserved unrelated working-tree state were checked locally. The latest run at that exact SHA, [7F CI run 42549550176](https://github.com/justinwj/portal-bsc/actions/runs/42549550176), was independently queried and is completed/successful. The [7F report](development-session-7f.md) records 328 distinct tests / 351 executions: 235 unit/HTTP/tooling, 79 real-service, 14 container and 23 Windows repeats, with no failures/cancellations/skips. Those are **7F baseline results**, not executed upload acceptance tests.

7G-A local regression: `npm.cmd test` executed **235 tests: 235 passed, 0 failed, 0 cancelled, 0 skipped**. Local runtime was Node **24.19.0**, npm **11.17.0**; approved CI remains Node 22. The initial `npm` launcher was blocked by PowerShell script policy; using the installed `npm.cmd` ran the suite without changing that policy. This is existing unit/HTTP/tooling coverage, not new upload acceptance evidence. Real-service/container suites were not rerun locally for this documentation-only change.

Relative documentation links were checked against existing files and whitespace validation passed. No NAS access, upload implementation, fault injection, filesystem migration, deployment or production credential change occurs in this phase. Documentation publication does not establish upload security or quota enforcement. The design must return for independent architecture review before implementation.
