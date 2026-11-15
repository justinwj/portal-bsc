# Session 7G-C1 extension: engineering, multimedia and ZIP bundles

Starting SHA: `b33d37714c9fa12f00f61de3545f24d431aa3efe`, authorized branch `codex/portal-bsc-r1-fixes`. Status: implementation and local acceptance complete; full GitHub Actions verification pending. No native CAD, Blender, Office, script or multimedia application execution is claimed.

## Baseline and scope

Verified branch/HEAD/status and the mandatory instructions in `origin/master:AGENTS.md` and `.github/copilot-instructions.md`. Baseline: **388/388** unit/HTTP/tooling tests and production build passed. Three staged `.idea` additions and the unrelated untracked options report were preserved. No credentials, existing records, NAS data, uploads/quota settings, backup jobs or dependencies were changed.

All Priority 1 extensions are implemented, preserving the previous 41 extensions. CSV was not actually allowlisted before this requirement; it is added explicitly. Added practical Priority 2 coverage gives **90 unique case-insensitive extensions**. The [operations guide](managed-uploads.md#supported-document-formats) contains the complete list and current safety limits.

| Group | Implemented extensions |
| --- | --- |
| Priority 1 native models/projects | `3dm 3dmbak blend fbx 3ds 3mf glb gltf obj stl skp` |
| Priority 1 CAD/interchange | `dwg dxf dae sat igs stp step x_t usd usda usdc usdz` |
| Scripts/lock records | `py pyc rhl` |
| Media/archives | `mp4 mp3 zip` plus existing `tif tiff heic` |
| Practical Priority 2 | `ai amf x emf kmz gts lwo ply pov raw rib svg slc vda wrl vrml wmf x3dv xaml` |
| Explicit CSV addition | `csv` |

Deferred for review: **`cd gf pm udo gdf xgl nwd nwc`**. Six are ambiguous/vendor-dependent without an identified variant/sample; Navisworks binary variants need reviewed signatures/version coverage. No arbitrary binary fallback or proprietary importer was introduced. Requested originating-application/sample clarification; Justin supplied a private sample directory, which established the ASCII-triangle RAW variant, but did not resolve these eight. Recommendation: retain their deferral pending identification. Other RAW variants, older bytecode and untested container/codecs are not implied by extension admission. Supporting `.bin`, `.mtl`, `.FCStd` and `.md` files remain outside direct admission and can travel inside project ZIPs.

## RED → GREEN → REFACTOR evidence

| Executed checkpoint | Actual result and correction |
| --- | --- |
| New `project-formats.test.ts`, before production changes | **104 failures / 0 passes**: every new format/ZIP behavior absent. Negative assertions require content rejection, so allowlist errors cannot make them pass vacuously. |
| First implementation plus existing format tests | **161/161 passed**. Added bounded recognizers/ZIP inspector; existing Office family checks remain unchanged. |
| Deflated directory + binary DirectX characterization | **104/106 passed**, then **163/163 combined passed** after allowing valid empty deflated directories and recognizing binary DirectX headers without decoding their payload. |
| Desktop-created Windows ZIP | Real upload rejected. A new separator compatibility regression yielded **107/108 passed**. Corrected metadata inspection to treat both separators uniformly while preserving archive bytes; targeted format/HTTP group **259/259 passed**. |
| Supplied IGES/RIB/RAW samples | Local admission exposed blank fixed-width IGES start records and optional RIB-header handling; RAW variant was not supported. Privacy-safe regressions: **108/111 passed**, then **262/262 combined passed** after preserving IGES columns, recognizing RIB commands and adding numeric triangle RAW text. |
| Upload warning copy | **94/95 HTTP passed**, before template correction. Added explicit never-execute/download-only/archive/Rhino-lock warnings, retaining Office/antivirus warnings. Full post-refactor result is below. |

The Windows ZIP correction replaced an over-restrictive new fixture assertion that any backslash was unsafe with genuine backslash/mixed-separator traversal and alias-collision assertions, plus a valid Windows ZIP case. It does not relax outer filename sanitization, use member names as server paths or weaken a traversal assertion. This is a documented compatibility correction prompted by actual workstation output.

New HTTP ZIP coverage verifies private/unauthorized metadata and download behavior, exact attachments for ZIP/Python/bytecode/Blender/SVG/XAML/media, selective sharing/revocation, one owner charge, competing reservations at the global boundary, short-transfer cleanup/released capacity and rejection of encrypted content without publishing partial files. These characterize the existing upload transaction's behavior with new formats; passing behavior was not given artificial RED failures.

New real Redis/CouchDB integration uploads a ZIP, starts a fresh app, shares exact bytes and revokes access while verifying persistent owner/size/hash. Existing real-service SIGTERM/SIGKILL, quota, sessions/account lifecycle, administrator, audit and container suites remain enabled.

Refactor separated archive inspection, format recognition and reusable synthetic fixtures. Formatting of the two new production modules preserved emitted JavaScript AST structure; removed redundant unreachable recognition rules. No decoder, archive library, native application, package or override was added. No user model, media or archive was committed; fixtures are tiny generated metadata/text in test source.

## Validation and security boundaries

`archive-validation.ts` inspects EOCD/central/local metadata with explicit entry, directory and aggregate read budgets. It supports stored/Deflate ZIP, directories and signed/unsigned streaming descriptors. Rejects encryption (central and local), AES/strong-encryption/ZIP64 extras, unknown compression, special/link entries, unsafe/colliding paths, conflicting Unicode overrides, overlaps, unindexed payloads and invalid bounds/CRC-size declarations. It never inflates, extracts, creates, recompresses or executes members. It cannot certify compressed payload/member CRC validity or malware safety without decoding; no such claim is made.

New direct formats always download as `application/octet-stream` attachments with nosniff/private headers. Recognizers check available binary/container/header structure or valid bounded-memory text, not complete CAD semantics. GLB/3DS/STL/IFF/media lengths receive bounded checks. Source, scene and interchange text can be active on a recipient's workstation. No embedded URL is fetched, no XML entity is resolved and no Python/Blender code is executed. `.rhl` is archived temporary lock text, not a model. Compressed Blender signatures recognize the wrapper only. RAW support is the documented text-triangle subset; all uploaded bytes remain untrusted.

Quota accounting remains exact archive-byte size, owned by the uploader, charged once globally and unaffected by sharing. Durable reservation, staging, hashing, finalization, outbox/recovery and existing read-only legacy boundaries are reused unchanged. The **1 GB** recommended maximum is not raised. None of the supplied samples establishes a need for a larger setting; future proposals above the **2,048 MB** antivirus exclusion need the owner's explicit risk decision. Scheduled scanning is not a pre-download gate and may have limited effectiveness with archived content.

References reviewed: [PKWARE ZIP specification](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT), [Khronos glTF](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html), [3MF Consortium](https://3mf.io/spec/core-v1-3-0/), [OpenUSD USDZ](https://openusd.org/25.11/spec_usdz.html), [Blender compression guidance](https://developer.blender.org/docs/release_notes/3.0/core/), and maintainer fingerprints in [file CAD](https://github.com/file/file/blob/master/magic/Magdir/cad) / [Python](https://github.com/file/file/blob/master/magic/Magdir/python). These inform recognition, not a conformance/antivirus certification.

## Private supplied-file browser acceptance

Justin identified a private local sample directory. Read originals only; tested copies outside the repository using a fresh loopback-only Chrome profile, actual forms/JavaScript, new isolated real CouchDB/Redis and dedicated managed/legacy volumes. No external file service or browser was used. Dependencies had no host-published ports, the test app was loopback-published with real sessions/no memory fallback, and legacy storage was read-only. The previous Office acceptance volumes and all existing Portal records were untouched. Browser profile external traffic was sent to a closed loopback proxy; no previews/native applications ran.

**38 supplied files** covering 37 extensions were uploaded/downloaded through the normal browser UI; every file was private, every original/downloaded SHA-256 matched, every suggested download name matched, and originals were rehashed unchanged afterward. Raw hashes, original names/contents, private manifests, browser harness and sample files remain outside Git/GitHub/build contexts. Each following row is pass/private/hash-match/name-match:

| ID | Extension | Bytes | ID | Extension | Bytes |
| --- | --- | ---: | --- | --- | ---: |
| D01 | zip | 2,413 | D20 | obj | 964 |
| D02 | kmz | 255 | D21 | ply | 628 |
| D03 | csv | 5,091 | D22 | step | 6,827 |
| D04 | mp4 | 1,925 | D23 | stl | 684 |
| D05 | jpg | 1,204 | D24 | stp | 6,827 |
| D06 | png | 411 | D25 | svg | 2,475 |
| D07 | tif | 802 | D26 | usd | 439 |
| D08 | tiff | 802 | D27 | usda | 439 |
| D09 | mp3 | 4,934 | D28 | wrl | 9,328 |
| D10 | pov | 231 | D29 | csv | 24 |
| D11 | x3dv | 73 | D30 | txt | 18 |
| D12 | xaml | 208 | D31 | rib | 146 |
| D13 | 3mf | 1,234 | D32 | dxf | 15,410 |
| D14 | amf | 2,584 | D33 | dae | 1,222 |
| D15 | blend | 452,296 | D34 | gts | 42 |
| D16 | fbx | 15,116 | D35 | raw | 20 |
| D17 | glb | 1,992 | D36 | x | 99 |
| D18 | gltf | 1,602 | D37 | py | 118 |
| D19 | igs | 12,393 | D38 | pyc | 400 |

Browser checks also passed for ZIP names with spaces, long valid names and non-ASCII characters; repeated downloads, distinct duplicate uploads, private denial, selective recipient download and subsequent revocation. Displayed progress remains state messages, not a percentage. The unchanged request limiter counts assets/forms/API calls: bounded test batches used recorded app-only restarts with retained real sessions/files, rather than raising/disabling limits. Initial local harness assertions around variants/duplicate navigation did not complete; fixed inherited Office-only filename assumptions and reran to a fully successful result without a corresponding production change. No failed partial run is counted as a complete acceptance pass.

Not supplied as real samples: Rhino `.3dm`/`.3dmbak`/`.rhl`, native DWG/SKP/SAT/Parasolid, USDC/USDZ, 3DS, most proprietary Priority 2 formats. Their implemented recognition has synthetic coverage only. Blender/FBX/CAD samples were transported, not opened/rendered in native software. Prior Office interoperability remains pending as recorded in the earlier C1 report; it is not reclassified as passed by this work.

## ZIP client extraction verification

Two actual downloaded archives were extracted **on the local workstation only**, using .NET ZIP streams with a fresh temporary output root, path containment, exclusive writes, 100-entry and 20 MiB expanded-byte test budgets. This client acceptance helper is not application code or an extraction endpoint.

- A client-created engineering project (OBJ/material/texture plus glTF/external binary buffer/documentation) contained six files. After the 1,135-byte Windows ZIP passed browser upload/download unchanged, extraction reproduced the **same six-file directory tree and all original SHA-256 hashes**.
- The **2,413-byte supplied ZIP** downloaded byte-identically and extracted six files; all six matched the original archive's member CRCs. Four matched loose supplied reference files exactly; two lacked an exact loose-file reference match. Three paths matched loose reference path suffixes. Therefore the full loose-reference-tree comparison is **not** claimed for that supplied bundle; the known-source project above establishes that complete comparison. No transport corruption was observed and no production correction was justified by those missing reference matches.
- Extraction did not execute models, scripts or multimedia. Portal itself never extracted either archive. Archive creation for the known-source test happened on the workstation, not in a production route. User archives and model/media binaries were never sent to CI or committed.

## Files, verification and remaining review

Local final complete suite: **511 passed, zero failed/cancelled/skipped**. Typecheck, production build, full/production audits and dependency tree each exited 0; both audits reported zero vulnerabilities. Actual local production Docker builds succeeded. The new real-service ZIP crash cases and container-recreation case await GitHub execution; they are not yet claimed passed. Windows CI now explicitly includes the new format suite.

The scoped change contains these **14 files**:

```text
.github/workflows/ci.yml
README.md
docs/managed-uploads.md
docs/development-session-7g-c1-projects.md
src/files/archive-validation.ts
src/files/project-formats.ts
src/files/project-formats.test.ts
src/files/upload-types.ts
src/files/managed-upload.http.test.ts
test/fixtures/documents.ts
test/fixtures/projects.ts
test/integration/managed-uploads.test.ts
test/persistence/persistence.test.ts
views/uploads.hbs
```

No package manifest/lockfile changed. Local private sample files, model/media binaries, ZIPs, extraction results and acceptance helpers are absent from this list and excluded from Git/build contexts. Final commit IDs and completed CI results will be recorded after job inspection. The queued verification includes real ZIP SIGKILL cases before/after CouchDB prepared/commit boundaries and actual ZIP persistence across application/database container recreation, alongside every previous suite.

No merge, NAS deployment, image publication, backup changes, new antivirus, anonymous sharing, extraction/preview/conversion endpoint or native-code execution. Request independent review of the implementation and the eight deferred Priority 2 extensions before broadening their admission. Preserve private local test artifacts and retained volumes; stop only session-owned services after verification.
