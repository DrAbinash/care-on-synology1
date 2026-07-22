# P5 OB Companion vs legacy Fetal-USG — parity report

Field-by-field comparison of the P5 OB canonical section
(`usgObSection` → `/api/usg-ob-doppler`) against the legacy
`FetalUsgLevel4.tsx` page. **Conclusion: PARTIAL parity — the legacy route must
NOT be retired or redirected yet.**

## Covered by the P5 OB section (parity reached)

| Field / group | P5 source | Notes |
|---|---|---|
| BPD, HC, AC, FL, CRL | `usg_measurements` → engine | biometry line |
| Gestational age (by US) | `establishGa` (CRL/LMP) | established once, projected |
| EDD | `calcEddFromEstablishedGa` / LMP | — |
| EFW | `calcEfwGrams` (HC/AC/FL) | Hadlock |
| AFI / liquor | `calcAfiInterpretation` | oligo/normal/poly band |
| Placenta position | `usg_measurements.placenta_position` | passthrough |
| Presentation | `usg_measurements.fetal_presentation` | passthrough |
| FHR / cardiac activity / liveness | `usg_measurements.fhr` | live gestation inferred from a recorded FHR |
| PCPNDT Form-F status | `checkPcpndtFormFCompliance` | **display only**; finalize gate unchanged |

## NOT yet covered (legacy still required)

| Legacy field / group | Status in P5 | Action |
|---|---|---|
| NT (nuchal translucency) + nasal bone | not in the OB section | add to `ObSectionInput` + measurement mapping |
| Full anatomical anomaly survey (cranium, CSP, ventricles, spine, 4-chamber heart, outflow tracts, diaphragm, stomach, kidneys, bladder, limbs, cord vessels) | not modelled | needs a structured anomaly checklist (P5 follow-up) |
| Growth charts vs configured reference standards / percentiles | engine returns EFW only | add percentile lookup against the approved reference set |
| Biophysical profile (BPP) | absent | add BPP scoring |
| Fetal-USG checklists / critical alerts (`fetal_usg_checklists`, `fetal_usg_critical_alerts`) | not wired | reuse the existing tables, do not duplicate |

## Guarantees verified

- **No fetal sex** anywhere in the OB section (asserted by an integration test).
- PCPNDT stays **fail-closed** — the P5 endpoint only *displays* Form-F status; the canonical finalize gate (`patient-reports` / `usgReports`) is unchanged.
- OB section output is canonical `{section, impression}` merged through the normal save-draft path — no second store.

## Decision

Keep `FetalUsgLevel4.tsx` and `/fetal-usg` live. The P5 OB section is an
*additive* canonical-reporting path behind `ff_radiology_usg_ob_canonical`; it
reaches parity on **dating + biometry + EFW + liquor + placenta + presentation +
liveness**, but the anomaly survey / NT / growth-percentile / BPP / checklist
surfaces remain legacy-only. Retiring the legacy route is blocked until those are
modelled and validated.
