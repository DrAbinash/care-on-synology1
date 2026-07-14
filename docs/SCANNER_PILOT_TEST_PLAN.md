# Care Diagnostics Scanner System — One-Day Reception Pilot Test Plan

**Purpose:** the first real-world validation of the scanner overhaul on
the actual reception workstation, with actual staff and actual documents.
Nothing in the code changes so far has been tested against physical
hardware — this pilot is what closes that gap, and what Phase 6's full
cleanup (removing any remaining legacy fallback paths) should wait on
completing successfully at least once, ideally over a longer window than
one day before being treated as fully proven.

## Pre-pilot setup (do the day before, not the morning of)

- [ ] Run through the entire `docs/SCANNER_PRODUCTION_DEPLOYMENT_CHECKLIST.md`.
- [ ] Bind the TVS PDS 8M in `/settings/scanner` and confirm the live
  preview actually shows the camera feed.
- [ ] Confirm the Canon scanner + Scanner Bridge show "Ready" (green) in
  the Existing Scanner tile.
- [ ] Confirm a Gemini API key is configured and a test OCR call succeeds.
- [ ] Brief reception staff for ~15 minutes: show them the new unified
  scan dialog, the TVS placement guide, and where to report anything that
  looks wrong (don't make them debug it themselves).
- [ ] Have a fallback plan ready and communicated: if the TVS PDS 8M or
  any new path fails mid-pilot, staff should immediately fall back to
  Upload Image or the Existing Scanner tile — the pilot should not create
  a patient-facing backlog while something is debugged.

## Test material (bring these in, don't rely on whoever walks in)

| Document type | Count | Mix |
|---|---|---|
| Aadhaar cards | 20 | Include both old plain-XML QR cards (pre-~2019 print) and newer Secure-QR cards, roughly half and half if available — this is the only real test of the QR-format detection logic. |
| PAN cards | 10 | No QR — pure OCR path test. |
| Referral / prescription slips | 10 | Handwriting-heavy — worst case for OCR, good stress test. |
| Expense bills | 10 | Mix of printed receipts and handwritten vouchers. |
| PDFs (any document type) | 5 | Confirms PDF upload + storage works and that the UI correctly shows "no preview available" rather than erroring. |

Total: 55 documents. At a rough 2-3 minutes each including staff
discussion/note-taking, budget 2-3 hours of hands-on testing, spread
across the day rather than one continuous block, so it overlaps with
actual patient flow rather than being a synthetic-only test.

## What to test per document

For each document, cycle through capture sources so every path gets real
coverage across the pilot (don't use only one source for all 55):

- Aadhaar/PAN/referral slips: split roughly evenly across **TVS PDS 8M**,
  **Existing Scanner (Canon)**, **Upload**, and **Webcam**.
- At least 5 of the 20 Aadhaar cards via **Mobile Scan** (QR code, staff's
  own phone) specifically — this is the path with the most moving parts
  (session token, phone camera, upload, poll) and the least real-world
  exercise so far.
- Expense bills: through the existing Expenses "Bill/Receipt Scanner"
  panel (unchanged this pass, still worth re-confirming with the OCR
  preprocessing update applied).

## Metrics to record

Keep a simple spreadsheet/notepad with one row per document:

| Field | How to record |
|---|---|
| **Capture success rate** | Did the chosen capture method produce a usable image on the first attempt? (Y/N + note if a retry was needed and why) |
| **OCR accuracy** | Compare the extracted guardian name/address against the physical card — exact match / close-but-wrong / no extraction. Note the confidence % shown and whether it was in the correct tier (did a genuinely-clear card score >=95%? did a genuinely-blurry one score <80%?). |
| **QR decode result** | For Aadhaar cards specifically: did it decode via QR (fast path) or fall through to OCR? If it fell through, was the "QR code detected but not readable" toast shown (confirms the Secure-QR-detected-but-unsupported path is working, not silently skipping)? |
| **Time per patient** | Stopwatch from "open scan dialog" to "fields accepted/confirmed" — compare across capture sources to see which is fastest in practice, not just in theory. |
| **Staff feedback** | Free text — confusing UI moments, anything that needed IT help, anything staff instinctively reached for that wasn't there. |
| **Failure log** | Any error message shown verbatim, which capture source, which document, and whether the new diagnostic messages (camera-in-use, permission-denied, etc.) were actually helpful or still confusing. |

## Specific things this pilot should confirm or refute

1. **TVS PDS 8M actually works as a document camera** — this is the
   single biggest unknown in the whole project. Record: does it focus at
   a usable card-reading distance? Is the placement guide's card-sized
   rectangle actually the right size/position for the device's real field
   of view? Is the blur-score warning accurate (does a visibly blurry
   shot actually get flagged, and does a sharp shot not get falsely
   flagged)?
2. **Secure QR vs legacy QR detection** — with a real mix of old/new
   Aadhaar cards, confirm the format detection correctly identifies each
   and that Secure QR cards visibly fall back to OCR rather than silently
   failing.
3. **Scanner Bridge stability over a real session** — does "Existing
   Scanner" stay "Ready" all day, or does it drop and require a bridge
   restart? (Tests the Phase 1 CORS/PNA fixes under real, sustained use.)
4. **OCR confidence tiering feels right** — does the 95/80 split actually
   correspond to "this is obviously fine to trust" vs. "this needs a
   second look" in staff's actual judgment, or does it need tuning?

## After the pilot

- [ ] Compile the failure log into concrete follow-up items — do not treat
  a rough pilot day as blocking, but do not treat a clean one as
  sufficient to auto-proceed to Phase 6 cleanup either; a single day is a
  first data point, not a full pilot cycle.
- [ ] If the TVS PDS 8M performed well, update
  `docs/TVS_PDS_8M_VALIDATION.md`'s "Status" line from "awaiting hardware
  validation" to reflect what was actually confirmed (label string,
  resolution, FPS, blur threshold) — do not just delete the caveat.
- [ ] Decide, based on real failure-rate data, whether more pilot days are
  needed before considering the old scan UI (already removed in Phase 6)
  safe to have removed, or whether it should be temporarily restored from
  git history if the failure rate is too high.
