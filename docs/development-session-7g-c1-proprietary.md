# Session 7G-C1 follow-up: proprietary sample acceptance

Starting/reviewed implementation SHA: `8bc9ec194ef7012637411dcdd43244e44f51897e`, branch `codex/portal-bsc-r1-fixes`. **No application, test, dependency or allowlist changes.** This is additional local browser acceptance and an explicit owner policy decision. The exact documentation-publication SHA is supplied in the handoff.

## Privacy and isolation

Justin supplied a local proprietary-sample directory containing five files. Read originals only and copied them to temporary storage outside the checkout. Used a fresh local Chrome 157.0.8103.52 profile, actual login/upload/sharing forms and browser downloads against a new, disposable application/CouchDB/Redis stack. The app was published only on loopback, dependencies had no host ports, sessions used real Redis with no memory fallback, managed storage used a fresh dedicated volume/UUID and the legacy fixture remained read-only. No existing Portal/NAS records or prior acceptance volumes were altered.

The runtime image was built locally from the reviewed source, using the existing non-root app user. Testing used development HTTP-cookie mode on loopback, not a production configuration change. Browser background networking/sync was disabled and external browser traffic sent to a closed loopback proxy. No sample was sent to GitHub, an external viewer/converter, cloud storage or a native CAD application. Raw hashes, original names, file contents, private manifests and the browser helper remain outside Git/build contexts.

## Direct browser results

| Sample | Extension | Bytes | Current direct upload | Download/integrity |
| --- | --- | ---: | --- | --- |
| P01 | `.3dm` | 108,867 | Accepted/private | SHA-256 matches; suggested filename matches |
| P02 | `.dwg` | 26,850 | Accepted/private | SHA-256 matches; suggested filename matches |
| P03 | `.nwc` | 5,504 | Rejected: Unsupported file extension | No direct download record created |
| P04 | `.nwd` | 5,574 | Rejected: Unsupported file extension | No direct download record created |
| P05 | `.skp` | 15,785 | Accepted/private | SHA-256 matches; suggested filename matches |

The supported files matched the existing practical header checks. This is transport/admission evidence, not proof that the corresponding native application can open every supplied document. No Rhino, AutoCAD, SketchUp or Navisworks process opened the files. All five originals were rehashed unchanged after testing, including the rejected samples.

The Rhino representative also passed space/long/Unicode filename cases, repeated downloads, separate duplicate uploads, unauthorized private-download denial, selected-recipient download and subsequent revocation. All observed round-trips preserved exact bytes. No failed test was removed or validation weakened. The two unsupported extensions are expected policy rejections, not an invented RED failure.

## NWD/NWC decision

Autodesk identifies NWD as a published model snapshot and NWC as converted/cache data ([native formats](https://help.autodesk.com/cloudhelp/2027/ENU/Navisworks/files/GUID-C6936A0B-1597-4880-83F9-7041894A4204.htm)). The format creator describes a proprietary, versioned serialization/container format without a public specification ([Tim Wiegand](https://www.thecandidstartup.org/2023/10/30/navisworks-file-formats.html)). Autodesk also supports password/expiration options for published NWD files ([publishing](https://help.autodesk.com/cloudhelp/2023/ENU/Navisworks/files/GUID-EC3A423C-A415-47BD-AF43-008B0EBC35B9.htm)). These references establish format context; they do not supply a reviewed bounded validator for these particular samples or prove their validity/encryption status.

Did not derive a production binary recognizer from an undocumented sample pair, install a proprietary SDK or silently replace validation with arbitrary binary admission. Presented the concrete tradeoff: retain the ZIP-only workaround, or explicitly approve opaque direct downloads without native validity/encryption assurance. Justin selected:

> Keep NWD/NWC deferred; use ZIP for now.

Therefore the allowlist remains at **90 extensions**, with the same eight Priority 2 deferrals. Direct NWD/NWC admission remains closed. No additional policy approval is pending for this follow-up, and no unsupported format is described as corrupted merely because Portal rejects its extension.

## Verified ZIP workaround

Created a **106,712-byte ZIP on the local workstation** from copies of the five supplied files. Portal stored it intact as one private managed upload; no server-side extraction, archive creation, recompression, preview or execution occurred. Actual browser download SHA-256 matched the client-created original archive.

Extracted the downloaded archive into a fresh local temporary directory using the workstation's `Expand-Archive`, with the known client-created source as the reference. All **five files**, totaling **162,580 bytes**, had matching SHA-256 hashes and identical directory structure. NWD and NWC stayed opaque throughout; extraction did not open or execute them.

The ZIP also passed space/long/Unicode download-name checks, duplicate/separate uploads, repeated downloads, private denial, sharing and revocation through the normal browser controls. The existing exact archive-byte owner/global quota accounting was not changed. Scheduled scanning remains no pre-download gate; a ZIP containing proprietary opaque files is not certified safe, valid or unencrypted internally.

## Verification and handoff

No production defect or missing approved behavior was corrected, so no artificial RED/GREEN cycle or new runtime tests were introduced. Built and started the actual runtime image and exercised real HTTP/session/storage behavior as above. The accepted [920-execution CI baseline](https://github.com/justinwj/portal-bsc/actions/runs/43767265819) is unchanged; it includes 623 distinct tests, Windows, real services, container/build and clean audit checks. Any automatic CI run on this documentation publication will be inspected separately; its results are not presumed here.

Only this report and the operations-guide policy clarification change. Final real-database inspection found 12 committed files including the deliberate filename/duplicate cases, zero direct NWD/NWC records, zero staging entries, zero pending audit entries and an unchanged legacy sentinel. Session-owned app/Redis/CouchDB containers were stopped and their three data volumes retained. Staged `.idea` files and unrelated work are preserved. Private copies/downloads remain locally retained for review. No merge, deployment, image publication, NAS/backup changes, native application installation or allowlist expansion.
