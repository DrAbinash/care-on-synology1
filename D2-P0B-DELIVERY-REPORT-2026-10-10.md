# D2-P0b — Orthanc identity lookup: delivery report

Date: 2026-10-10
Repo: care-on-synology1 (CARE ERP)
PR: [#908](https://github.com/DrAbinash/care-on-synology1/pull/908) — branch `fix/d2-p0b-orthanc-qido`
Base `19c88b48` → head `a3c35967`. Scope: 3 files (`imageIdentity.ts` +32/−7, `mockDicomWeb.ts` +80/−55, `radiologyImageIdentity.request.test.ts` +2/−2). **Not merged, not deployed.**

---

## What was wrong

The D2 identity check asks the PACS "does this SOPInstanceUID live in this Series of
this Study, and how many frames does it hold?" Before this fix `createOrthancInstanceLookup`
built the URL as

```
/dicom-web/studies/{S}/series/{SE}/instances/{SOPInstanceUID}
```

That path-style single-instance retrieve is **keyed by Orthanc's internal id, not by the
SOP UID**. The clinic's Orthanc **1.13.0 answers HTTP 400** for it. The lookup maps any
non-2xx to `unreachable`, so every image — even a perfectly correct, genuinely-owned one —
came back `IMAGE_PACS_UNREACHABLE` and the durable writers stored **no DICOM identity**.
In other words server-side verification could never succeed against the real PACS. The
standalone test double had been written to answer that same path-style URL with a 200, so
the whole D2 suite was green while the shipped function was broken against Orthanc.

## What changed (smallest correction, no architecture change)

Use the one form this Orthanc actually answers — a **QIDO search scoped to the requested
Study + Series, filtered by the tag**:

- with an SOP named: `/dicom-web/studies/{S}/series/{SE}/instances?00080018={SOP}`
- with no SOP named: `/dicom-web/studies/{S}/series?0020000E={SE}`

An unmatched QIDO filter is an **HTTP 200 with an empty array, not a 404**, so "nothing
matched" is decided from the body, not the status. The path scoping is itself the ownership
question, and the returned object's `0020000D` (Study), `0020000E` (Series) and `00080018`
(SOP) are **re-checked against what we asked for** before it is trusted — a matching filter
that somehow returned a different object is treated as not-found.

Left deliberately untouched: `decideFrame`, `verifyImageIdentityClaim`, `verifyInstanceChain`,
`chainColumnsFor`, the base-URL resolution order, the verified / contradicted / unverifiable
three-way contract, the 409s, and fail-closed storage. No new dependencies, no second service,
no generic PACS compatibility layer, no unrelated edits.

`testSupport/mockDicomWeb.ts` now mirrors Orthanc 1.13.0: QIDO-filtered responses that carry
the study/series/SOP tags, and **400 for the path-style singletons**, so a regression back to
the broken URL shape fails the check instead of passing silently. The two "the request really
went to the PACS" non-vacuity assertions in the request suite were repointed to the QIDO URL.

## Whether the real Orthanc lookup works — YES

Ran the actual fixed `createOrthancInstanceLookup` against the live staging Orthanc
(`192.168.1.137:8043`) through the same fetch and base resolution as production (temporary
harness, deleted; not part of the PR):

| scenario | real result |
|---|---|
| valid multi-frame chain — SOP `…30101`, CINE series `…3.1` | `{ ok: true, numberOfFrames: 8 }` |
| single-frame instance — SOP `…30201`, STILL series `…3.2` | `{ ok: true, numberOfFrames: null }` (frame dropped) |
| CINE SOP claimed under the wrong (STILL) series | `{ ok: false, reason: "not-found" }` |
| real chain claimed under a different study (`…​.1`) | `{ ok: false, reason: "not-found" }` |
| series-only existence question (no SOP) | `{ ok: true }` |
| Orthanc down (dead port) | `{ ok: false, reason: "unreachable" }` — fail-closed |

The two "not-found" cases are real Orthanc returning `200 []` for an out-of-scope filter, and
the dead-port case proves the fail-closed path still maps to `unreachable`.

## Whether correct identity persists — YES (real database)

## Whether incorrect identity is refused — YES

Proven by `radiologyImageIdentity.request.test.ts`, which boots the real router over supertest
against the migrated scratch Postgres and reads back the rows the routes wrote, now running the
fixed function over the network:

- A verified single-frame capture persists Study/Series/SOP with `frameNumber = null`.
- The WADO-RS URL default of `"1"` on a single-frame object is **dropped to null** (a URL default
  is not a statement about the object).
- A multi-frame object keeps an in-range frame (17) and **refuses** an out-of-range one (999 →
  `IMAGE_FRAME_OUT_OF_RANGE`, 409).
- A cross-study claim nulls Study/SOP.
- When the PACS is unreachable, the identity columns are **nulled** — an unknown anchor is never
  guessed.

## Whether existing tests pass — YES

- `imageIdentity.test.ts` (17) + `radiologyImageIdentity.request.test.ts` (27) +
  `frozenKeyImages.request.test.ts` (10) = **54 passed**, on the migrated scratch DB.
- api-server `tsc --noEmit`: **exit 0, zero errors.**
- CI on the PR (static checks + real-Postgres tests): see the status noted at delivery below.

## What could not be verified here

The **deployed staging ERP container still runs pre-fix code**. A live browser
OHIF → staging-ERP → database capture therefore needs that container rebuilt first, which is
an operator action (no Docker/SSH from this box). The evidence above — real Orthanc lookups
through the actual shipped function, plus route-level reads/writes on real Postgres — is the
strongest proof available short of a deploy. This PR is the ERP half of the D2-P0b repair; the
OHIF capture-time fix is the sibling care-pacs PR #15 (independent of this change).

No merge. No production deploy.
