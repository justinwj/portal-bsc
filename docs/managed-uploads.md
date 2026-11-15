# Managed uploads, sharing and recovery

Session 7G-B adds opt-in Portal-managed storage. It does not deploy anything to a NAS. Complete the target-side checks below before a separately approved deployment. Use one application process and one writable storage identity; replicas, independent upload writers and direct CouchDB edits are unsupported.

## Storage and access boundaries

Legacy files remain in `NAS_FILES_DIR`, mounted **read-only**, with their existing role-based permissions. Uploads never write there. Managed payloads use a dedicated persistent directory outside the application checkout, legacy share and public assets:

```text
<verified dedicated managed root>/
  .portal-storage.json
  staging/
  objects/
  quarantine/
```

The marker contains `{"schemaVersion":1,"id":"<UUID v4>"}`. Select and record that UUID when provisioning storage; it must match `PORTAL_UPLOADS_STORAGE_ID` and CouchDB's `managed-storage-registration` document. An empty replacement directory or newly invented UUID is not a recovery procedure.

Only approved active accounts can upload. Each new file is **Private** to its owner. The owner can select approved active recipients on **Share**; recipients can list, inspect and download that file, but cannot change its grants. Unchecking recipients revokes access on subsequent requests. Every listing, details request and download checks authorization; unauthorized and nonexistent file IDs return the same not-found response.

Administrators have **no private-file bypass**. An owner must explicitly select an administrator as a recipient. Administrator access to another owner's file requires a durable `file.administrator_access` audit before metadata is disclosed. Ownership is the separate authorization for an administrator's own uploads. All managed downloads require a durable `file.download_started` event before opening the payload. There are no anonymous links, automatic all-member shares, previews or editing.

Disabled, closed, pending or rejected users cannot use grants. Disabling/reactivating a recipient invalidates the old grant as well as old sessions; the owner must save a new grant. An inactive/closed owner suspends recipient access. Reactivating an owner also requires renewing grants. Ownership, bytes, quota charges and audit history remain; account closure does not delete or transfer files. Copies already downloaded cannot be revoked, and an already authorized in-flight download may finish.

## Provisioning and configuration

Justin must verify actual DSM paths, mounted storage identity, ACLs, UID/GID and the installed Container Manager/Compose version. No particular NAS directory or service account is assumed.

1. Select a dedicated existing persistent folder, separate from the canonical legacy share, application checkout, database data and public web roots. Do not use symlink/junction aliases or submounts. Canonicalize **host** paths and verify that neither share contains the other; container paths alone cannot prove host isolation.
2. Choose a non-root application UID **and** GID. Grant that identity read/search on the legacy directory, never write permission through Portal's mount. Keep managed-root parents and its marker under trusted administrator control; the app needs read/search on the root and read on the marker. Grant the app read/write/search only on `staging`, `objects` and `quarantine`. A Linux starting point is `0700` for writable subdirectories and `0600` for payloads; verify DSM ACLs rather than relying on mode bits alone. No SMB client or untrusted process should write these directories or create hard links there. Give the existing backup/scanning facilities explicitly reviewed access.
3. Provision the empty layout and marker explicitly. Portal never creates a missing production managed root or subdirectory. Do not hand-create records or insert files into `objects`; unknown data fails reconciliation.
4. Retain protected CouchDB/session configuration and set the following environment values. Do not put secrets in Git or paste expanded Compose output into reports.

| Variable | Selection |
| --- | --- |
| `PORTAL_APP_UID`, `PORTAL_APP_GID` | Verified nonzero DSM identity, required by production Compose |
| `NAS_FILES_HOST_PATH` | Canonical existing legacy host directory, still read-only |
| `PORTAL_UPLOADS_ENABLED` | `true` only after provisioning; default `false` keeps download-only operation |
| `PORTAL_UPLOADS_DIR` | Existing absolute container root; override uses `/var/lib/portal-bsc/uploads` |
| `PORTAL_UPLOADS_HOST_PATH` | Canonical dedicated existing host directory |
| `PORTAL_UPLOADS_STORAGE_ID` | Marker UUID v4, preserved with backups |
| `PORTAL_UPLOAD_MIN_FREE_BYTES` | Explicit positive integer-byte physical free-space reserve; select for the actual shared filesystem |
| `PORTAL_UPLOAD_MAX_OBJECTS_PER_USER` | Default `1000`; accepted range `1`–`100000`, including retained non-aborted objects |

5. Validate the **selected** project, including the opt-in override, with `docker compose -f docker-compose.app.yml -f docker-compose.uploads.yml config --quiet`. This checks configuration without printing expanded credentials. Inspect the resulting mounts: legacy destination `/var/lib/portal-bsc/files` must have `RW=false`; managed destination `/var/lib/portal-bsc/uploads` must use the dedicated verified bind. Both authored binds require `create_host_path: false`. The default Docker runtime uses `node`; Compose selects the verified UID/GID. Production enabled uploads reject root UID/GID and non-Linux runtimes.
6. Check that the installed Synology Compose implementation preserves long bind syntax and missing-source rejection. If unsupported, stop deployment and select an explicitly reviewed equivalent Engine `--mount` operation/compatible Compose CLI; do not silently replace it with auto-creating short volume syntax. Use only disposable paths for rejection/writability probes. See [Docker bind mounts](https://docs.docker.com/engine/storage/bind-mounts/) and [Compose long syntax](https://docs.docker.com/reference/compose-file/services/#long-syntax-5).
7. Confirm existing backup coverage and scanning access, then perform the disposable acceptance checks below. No real NAS data was used in development.

Startup verifies canonical roots, marker/registration identity, no legacy/checkout overlap, regular entries, filesystem device identity, permissions and exclusive-create/link/unlink/fsync support. It creates and removes a bounded managed-storage probe, never a legacy NAS file. Staging and final objects must share the same filesystem; publication uses an exclusive hard link followed by unlinking staging, not overwrite. Managed payloads must ultimately have one link. Host/root administrators remain trusted: the app cannot defend a compromised kernel or arbitrary writes by its own UID.

## Administrator quota confirmation

Open **Capacity and quotas** to review existing policies and overrides, then **Managed storage policy**. An enabled, safe root does not itself authorize uploads: an administrator must explicitly confirm the policies and scheduled-scanning risk.

Recommended initial limits are **10 GB per user, 100 GB globally, 1 GB per upload**, using decimal GB (`1 GB = 1,000,000,000 bytes`). The confirmation checkbox can populate only currently **Not configured** default/global policies. Existing numeric, zero, Unlimited and individual override policies are preserved. No background migration resets policies.

For initial confirmation the default and global policies must be selected. On every admission/finalization, both the current global and effective user policy must be configured. A user override takes precedence, including an explicit Not configured override: that account is blocked until policy is selected. Unlimited is an explicit decision; it is distinct from Not configured. The file maximum is a nonnegative numeric GB value adjustable on the policy page, never an implicit Unlimited. Zero permits only a valid zero-byte TXT file when all other limits allow it.

Reservations charge the entire declared size before bytes are accepted. Finalization rereads account/session, file maximum, current policies and existing charges. Reducing a policy while work is pending can reject finalization and clean its known partial bytes. Existing over-quota files remain downloadable; there is no automatic deletion. Usage reports distinguish committed from reserved/uncertain bytes and keep retained closed-account files charged to the owner. Sharing adds no copy or recipient charge; each managed ID counts once globally.

Incomplete ownership, unsafe sizes, unknown states, incompatible managed provenance, missing committed objects or physical/metadata conflicts block new uploads rather than assuming zero usage. Legacy records without managed scope remain outside this ledger. An older manually populated `portal-managed` record without the new trustworthy journal cannot be adopted automatically; it needs separately reviewed provenance/reconciliation.

The physical watermark also accounts for unfilled reservations and a small per-object allowance. It is a safety margin, **not** a reservation against other DSM/SMB writers. Filesystem exhaustion can still cause a safe upload failure. These quotas control Portal-managed bytes, not total NAS/SHR capacity or direct SMB usage.

## Supported document formats

Extensions are case-insensitive. The original filename is retained as metadata; the physical name is an opaque server-generated UUID. Unsafe separators, device names, control characters and malformed names are rejected, never repaired into a path.

| Family | Allowlist |
| --- | --- |
| Excel | `.xlsx`, `.xls`, `.xlsm`, `.xlsb`, `.xlt`, `.xltx`, `.xltm`, `.xlam` |
| Word | `.docx`, `.doc`, `.docm`, `.dot`, `.dotx`, `.dotm` |
| PowerPoint | `.pptx`, `.ppt`, `.pptm`, `.pps`, `.ppsx`, `.ppsm`, `.pot`, `.potx`, `.potm` |
| Access | `.accdb`, `.mdb` |
| Visio | `.vsdx`, `.vsdm`, `.vsd` |
| OneNote | `.one`, `.onepkg` |
| Project, Publisher, Outlook | `.mpp`, `.pub`, `.msg` |
| Other | `.txt`, `.pdf`, `.jpg`, `.jpeg`, `.png`, `.tif`, `.tiff`, `.heic` |
| Native models/projects | `.3dm`, `.3dmbak`, `.blend`, `.fbx`, `.3ds`, `.3mf`, `.glb`, `.gltf`, `.obj`, `.stl`, `.skp` |
| CAD interchange | `.dwg`, `.dxf`, `.dae`, `.sat`, `.igs`, `.stp`, `.step`, `.x_t`, `.usd`, `.usda`, `.usdc`, `.usdz` |
| Scripts/lock records | `.py`, `.pyc`, `.rhl` |
| Media/project archives/data | `.mp4`, `.mp3`, `.zip`, `.csv` |
| Additional practical formats | `.ai`, `.amf`, `.x`, `.emf`, `.kmz`, `.gts`, `.lwo`, `.ply`, `.pov`, `.raw`, `.rib`, `.svg`, `.slc`, `.vda`, `.wrl`, `.vrml`, `.wmf`, `.x3dv`, `.xaml` |

This is **90 distinct case-insensitive extensions**. `.xlam` is deliberately included as the requested macro-based Excel add-in. Python/bytecode and project ZIPs are explicitly approved as untrusted downloads. Other direct executable/add-in uploads (`.xll`, DLL/COM/EXE, JavaScript/VBS/PowerShell, legacy `.xla`, `.ppa`/`.ppam`) remain rejected. An archive may contain files that cannot be uploaded individually; Portal does not inspect/decompress their contents or certify them as safe. No uploaded content is executed, extracted or rendered by the server.

TIFF accepts either byte order with classic TIFF/BigTIFF headers and a bounded first-directory check. HEIC requires an explicit HEVC image brand (`heic`, `heix`, `hevc` or `hevx`), bounded ISO-BMFF boxes, metadata/track structure and nonempty media data. Generic HEIF/AVIF is not implicitly accepted. These are structural signature checks, not complete image decoders or malware validation. TIFF/HEIC use opaque attachment downloads; no preview or conversion is added. See [Session 7G-C1 acceptance](development-session-7g-c1.md) for real supplied-file results and pending Office visual checks.

OOXML checks a bounded ZIP directory and expected family parts, rejects malformed/encrypted/multidisk/ZIP64 containers and VBA parts under non-macro extensions. Legacy compound files, Access and OneNote use practical header/signature checks. TXT requires UTF-8 without NUL/executable signatures; PDF/images use bounded signature checks. These checks detect obvious mismatches, **not full Office validity, macro safety or malware**. Some same-container legacy disguises cannot be distinguished by the header. Password-encrypted OOXML, ZIP64 or unusually large container directories may be rejected. Synthetic automated fixtures do not replace testing representative real documents from each installed Office application.

Office downloads use `application/octet-stream`, attachment disposition, `nosniff` and private/no-store headers. There is no browser Office preview. Validate downloaded original names, including non-ASCII names, in the actual browsers; the safe quoted download name currently uses percent encoding. Do not enable client macros merely because Portal accepted a file.

### Engineering and project distribution

All newly added engineering, script, markup, CSV and multimedia formats use opaque attachment downloads (`application/octet-stream`); SVG/XAML are never embedded inline. Portal never starts Python, Blender, Rhino, a CAD importer, media codec or external-resource resolver. `.py`, `.pyc`, `.blend`, macros, SVG/XAML, PostScript/Illustrator and CSV formulas can be active when opened by client software. Treat downloaded content as untrusted, keep application protections enabled and review it before opening. `.rhl` is a temporary Rhino lock record, **not a model**.

Recognizers use bounded headers, lengths or container directories where possible; they do not prove complete CAD/media validity. OBJ, Parasolid text, POV/VDA scene data, Python source, lock text and CSV have no dependable unique magic: accepted variants must be valid UTF-8 or BOM-tagged UTF-16 without NUL characters. No code/formula interpretation is performed. RAW support is specifically numeric ASCII-style triangle text with nine finite coordinates in the first record; camera/binary RAW is not implied. PYC recognition covers modern CPython-style PEP 552 headers, not every historical interpreter. Compressed Blender gzip/Zstandard recognition checks the outer signature only, without decompression; it cannot establish the inner document's identity. Some XML/comment/header variants, codecs and proprietary versions remain untested or may be rejected.

Priority 2 review remains for `.cd`, `.gf`, `.pm`, `.udo`, `.gdf`, `.xgl` (ambiguous/vendor variants) and `.nwd`, `.nwc` (Navisworks formats needing reviewed version/signature coverage). These are not silently admitted as arbitrary binary data. Identify the originating application and supply sanitized representative files before broadening admission. Files such as `.bin`, `.mtl`, `.FCStd` and README `.md` in a project can be carried intact **inside a ZIP**; their presence in a sample set does not add them to direct-upload policy.

After testing supplied proprietary samples, Justin explicitly chose **Keep NWD/NWC deferred; use ZIP for now**. The supplied Rhino `.3dm`, DWG and SketchUp files passed direct browser round-trips; NWD/NWC remain rejected as direct uploads but passed intact inside a client-created ZIP. This is not native Navisworks validity or encryption-status certification. See [proprietary sample acceptance](development-session-7g-c1-proprietary.md).

### ZIP project bundles

Create the project archive **on your workstation**, including textures, materials, binary buffers, drawings and documentation while preserving relative paths. Upload the completed `.zip` through the ordinary form. It is stored unchanged as one private managed object, charged once to its owner and global usage by its actual archive byte size, and can be selectively shared/revoked. Recipients download the original bytes and extract locally with trusted tools. Portal neither creates/recompresses archives nor extracts, previews, executes or fetches referenced resources. ZIP support does not create anonymous links or bypass quotas, sessions, audit/recovery controls.

Metadata-only admission supports ordinary single-disk ZIP with stored/Deflate entries, explicit directories, streaming data descriptors, comments and UTF-8/legacy name bytes. Windows-produced backslash separators are treated as separators **only during safety inspection**; the archive is never rewritten. Relative subdirectories are permitted; traversal/absolute/drive/ADS/device paths, separator/case/Unicode-normalization collisions, file-directory conflicts and UNIX links/special entries are rejected. Local headers, central entries and descriptors must agree and not overlap or hide unindexed bytes.

Limits: at most **10,000 entries**, **8 MiB central directory**, **16 MiB total metadata inspection**, **1,024 filename bytes per entry**. Password/encrypted members (including AES/strong encryption), split/self-extracting archives, ZIP64, unsupported compression methods and conflicting Unicode path overrides are rejected under the initial policy. Use standard stored/Deflate ZIP without passwords. ZIP64 may appear even in small archives from some writers; request a reviewed compatibility change rather than bypassing validation. 3MF/KMZ/USDZ use bounded package checks as well, with family markers and USDZ stored/alignment checks; those checks do not establish application interoperability.

No payload decompression occurs in admission, so compressed-stream validity and member CRCs are not exhaustively verified there. The archive's SHA-256 and exact stored/downloaded bytes are verified. A structurally accepted archive can still contain malware, scripts, misleading metadata or a decompression bomb. Extract cautiously on a protected workstation, inspect content before running it, and do not assume claimed expanded sizes are trustworthy. Expanded size is not a Portal quota charge because expansion never occurs on the server.

The encryption policy covers the inspected container's members; nested files stay opaque, so Portal cannot establish that a nested archive is unencrypted. Legacy name bytes are preserved, but recipient code-page interpretation and locale-specific alias rules can differ; do not treat metadata admission as a guarantee of safe extraction on every workstation.

Scheduled Synology Antivirus Essential remains **no pre-download gate** and may have reduced effectiveness on archived/nested/compressed content. Portal does not claim members or archives are scanned/clean. Encrypted archives are rejected; no new antivirus engine or mandatory scan service is introduced.

The recommended **1 GB** upload maximum remains unchanged and administrator-adjustable. The supplied engineering/media samples were small (largest supplied Blender file: 452,296 bytes), so they do not establish a need or performance capacity for larger limits. For larger Rhino/Blender/video/project files, first identify expected archive sizes, proxy/timeouts, quotas, free-space/backup needs and trusted-client extraction capacity. Do not silently increase persisted settings. A proposal above Antivirus Essential's documented **2,048 MB** scan exclusion requires an explicit risk decision. See [engineering acceptance evidence](development-session-7g-c1-projects.md).

## User workflow and transfer limits

1. Sign in, open **Upload**, select an allowed file and enter title/description. New files are private.
2. Submit once. The browser obtains a durable intent using an idempotency key, then sends a raw bounded stream with a session CSRF header. There is no whole-file server memory buffer or multipart temporary-file middleware.
3. On transient response loss, retry in the same page: it reuses the intent or checks completion before sending bytes again. A page refresh loses its in-memory retry identity; check the file list before starting another upload. Known aborted attempts can start a fresh intent; uncertain writes require recovery.
4. Open the committed file's **Share** page. Select only intended approved recipients; saving unchecked selections revokes them. Recipients see only authorized metadata/files.

At most two receiving streams run globally and one per owner; pending intents are limited to 16 globally/two per owner. Unused intents expire after ten minutes on the next admission. Streaming has a 60-second idle timeout and a 60-minute total deadline. Persistent journals also have bounded admission budgets (10,000 per owner/50,000 total); exhaustion requires operator review, not deletion of audit or retained records.

Align reverse-proxy maximum body size and timeouts with the chosen upload maximum/deadline. The example Nginx configuration is not an automatically tuned upload deployment. Prefer request streaming to an extra proxy disk spool where supported; review buffering, disk headroom and LAN transfer time explicitly. Never expand public exposure or trust-forwarding settings to make uploads work.

## Commit, cleanup and recovery

The filesystem and CouchDB are **not one atomic transaction**. One in-process coordinator serializes account/policy decisions, reservations, finalization and sharing, while network streaming runs outside it. The sequence is:

1. Persist an owner/session-bound journal and full byte reservation with a stable idempotent ID.
2. Exclusively create staging (`0600`, no symlink following), persist device/inode identity, stream/count/hash exact bytes and validate the container. Flush/close bytes and sync directory entries on Linux.
3. Persist `prepared`, reread current capacity/session/policies, exclusively publish the same inode into `objects`, remove staging and sync both directories.
4. Persist `committed` and its audit outbox in the same file revision, verify acknowledgement/readback, deliver the deterministic audit event and acknowledge the outbox. Only then return success. CouchDB's synchronous `201` acknowledgement is required; `202`, unavailable DB or memory fallback is not success.

Only committed, authorized files are readable. Downloads verify root/identity, size and SHA-256 before successful headers, then stream from the checked descriptor; late read/stream failures abort the transfer. This entails an extra sequential read before download on the modest HDD. Startup rehashes all committed payloads before opening admission; future capacity/performance tuning needs measurement.

Known failed/cancelled work records `cleanup-pending` **before** unlink. It validates every candidate's stored device/inode/link count, removes only verified partials, syncs directories, then acknowledges `aborted` before releasing charges. Uncertain handles, unlink failures, unknown collisions, unexpected missing bytes or DB uncertainty retain charges and fail closed. A verified normal browser disconnect cleans its own partial without blocking later uploads. A graceful SIGTERM aborts active streams; SIGKILL leaves journals for startup recovery.

Startup, before listening, reconciles the registered root with all managed records and directory entries, completes known cleanup, checks committed hashes and replays outstanding audit events. Crash after commit acknowledgement loss returns the same committed file rather than a second object. Unknown objects/probe leftovers, quarantine data, missing payloads, wrong markers and conflicting metadata require operator review. `quarantine/` is reserved for reviewed recovery; it is not an antivirus clean state or automatic permanent-deletion bin.

On a blocked deployment:

1. Stop new writes; preserve the root, all four CouchDB databases, operator logs and configuration. Do not delete unexplained files, change the storage UUID or edit quota totals to hide a mismatch.
2. Check actual mount identity/permissions/free space, file/journal states and the backup generation together. Do not run a second app against the same root. Unexpected identity/ownership conflicts require independent review.
3. For verified transient DB/close/cleanup failures, restore the dependency and restart the single app so reconciliation runs before admission. An uncertain close specifically requires process restart. If reconciliation still fails, keep uploads closed and review evidence; do not bypass checks.
4. Restore missing/corrupt payloads only from a verified matching backup under an explicitly reviewed recovery operation. There is no automatic adoption, rebinding, hard-link repair, migration or irreversible file disposition.

Upload/share audits use a durable outbox with fixed event IDs; a lost acknowledgement is replayed without duplicate events. Policy confirmation and existing quota/account-policy audits are separate writes: a 503 can explicitly mean **saved policy, missing audit**, not rollback. Inspect state before retry; these policy operations have no replay guarantee. Completed `file.download` and download-history writes remain separate post-transfer operations and may fail after bytes reached the client. The pre-transfer event records authorization/start, not successful client receipt.

## Synology scheduled antivirus acceptance

The approved R1 policy is **Synology Antivirus Essential with scheduled Smart Scan**, plus client protection. There is no mandatory scan-before-download gate and Portal always records `not-scanned`; a just-uploaded file can be downloaded before the next scan. This is an accepted residual risk, not a clean-file certification.

Before separately approved deployment, Justin must:

1. In DSM Package Center, verify model/DSM support, install Antivirus Essential and update signatures. Confirm package permissions can read the actual managed `objects` directory and opaque extensionless filenames.
2. Create a scheduled custom scan selecting that managed **objects** folder. Exclude live `staging` from routine scanning/actions to avoid interfering with in-progress writes; never publish staging files manually. Verify the selected path maps to the same reviewed host bind, not just a similarly named empty directory.
3. Enable Smart Scan as appropriate and select a low-usage schedule. Review signature-update scheduling, logs and detection actions; establish an administrator response procedure. Confirm scan coverage/logs on disposable benign fixtures. Do not execute malware samples or change NAS jobs during this development session.
4. Understand that scheduled/Smart Scan can miss newly uploaded content before download. [Synology documents the 2,048 MB file-size exclusion](https://kb.synology.com/en-global/DSM/help/AntiVirus/av_desc). The initial 1 GB upload maximum is below it; increasing the maximum requires reviewing that risk. See also [Synology's Smart Scan guidance](https://kb.synology.com/en-us/DSM/tutorial/The_scan_takes_so_long_What_is_the_recommendation_on_running_Antivirus_Essential).
5. Rehearse detection handling separately: if AV moves/quarantines/deletes a committed payload, Portal retains its logical charge and fails closed on the mismatch. Review affected access, backup and file disposition explicitly; Portal does not silently recreate or remove metadata. The application does not integrate AV scan results into its audits.

Actual DSM installation, ACLs, scan coverage and scheduling have **not** been performed by Codex.

## Existing backup coverage and restore verification

Use the owner's existing backup arrangements; no new service or job is introduced. Verify inclusion of the dedicated managed root (marker and all subdirectories), the **actual** retained CouchDB data volume backing all four Portal databases, and protected storage/quota/configuration secrets. Policy/registration documents are in `portal_users`, upload journals/ACLs in `portal_files`, with events/history in `portal_audit`/`portal_downloads`. A container export does not back up mounted data.

Filesystem and database backups must describe a coherent generation. For a straightforward low-volume backup, quiesce/stop the app gracefully, confirm streams have ended, then use the existing approved CouchDB-consistent backup procedure and copy/snapshot managed storage while no writer runs. A stopped DB/quiet stack is a practical way to avoid mismatched independent live copies; a different live-backup scheme needs its own consistency validation. Restoring pending journals onto a different filesystem can invalidate stored inode identity and require manual review. Do not modify existing NAS backup jobs without a separate operational approval.

Restore acceptance, using isolated disposable storage and a matching backup:

1. Verify backup date/generation, protected configuration and recorded UUID. Inspect the intended mounts before startup; keep the legacy NAS read-only.
2. Restore the managed root and retained CouchDB data together using the approved backup method. Preserve source backups; do not point tests at production records. Use a fresh session store so pre-restore sessions do not regain old privileges after database rollback.
3. Start one app and require reconciliation/readiness. If identity/unknown-file checks fail, stop for reviewed recovery rather than bypassing them. Check hashes/counts, owner attribution, committed/reserved totals, policies and user overrides.
4. Sign in with the existing stored administrator password; bootstrap is not a password reset or member promotion. Verify owner and selected-recipient downloads, unauthorized denial, revocation, retained closed-account files and new upload admission at quota boundaries.
5. Confirm upload/share/download events and fresh session behavior. Retain the verification record, then obtain independent review before restoring real service.

The reported single HDD persists bytes but has no second drive to protect against drive failure; SHR alone does not change that. See [Synology's storage protection guidance](https://kb.synology.com/en-ro/DSM/tutorial/Without_data_protection). Neither CI nor file fsync certifies NAS power-loss durability or the owner's backup restorability.

## Manual Windows/Rider and browser acceptance

Automated Windows process/filesystem tests do not operate Rider. In a disposable project/configuration with temporary real services and managed storage outside the checkout:

1. Use Node 22 and npm 10.9.9, run `npm ci`, configure safe test directories/marker and a test administrator, then run `npm run start:dev` from Rider's terminal. Linux is required for enabled production mode; Windows development does not certify directory-fsync durability.
2. Confirm initial build readiness, edit a source file, and verify one restart. Introduce a type error, verify the app stops rather than running partially emitted code, then fix and confirm recovery.
3. Run `npm run start:debug`, attach Rider to **127.0.0.1:9229**, and set a TypeScript breakpoint on upload intent or sharing. Verify source-map resolution across a successful restart. Stop the run configuration and verify no app/debugger child or occupied port remains.
4. In administrator/member browser sessions, confirm explicit quota setup, upload representative real Office/macros/legacy files, private defaults, recipient selection, revocation and attachment bytes/names. Confirm recipient/admin denials expose no title/description. Inspect native forms with keyboard navigation and at narrow widths.
5. Cancel an upload, retry a lost response in the same page, and confirm no duplicate commit; inspect audit/quotas. Review visible errors and screenshots with Justin. No interactive Rider, Office, accessibility or Synology acceptance pass is claimed here.

See [Session 7G-B evidence](development-session-7g-b.md) and [DS925+ readiness](ds925-production-readiness.md). Deployment, permanent deletion/disposition, distributed writers, cloud integrations, public links, SMTP and Office editing remain outside this change.
