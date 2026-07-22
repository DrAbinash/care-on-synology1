# HOPE-side Adapter — Reference Implementation

> This integration is implemented and pushed only on the **CARE** side (the writable
> repo). HOPE is a separate repository; this document is the drop-in reference for
> the HOPE team. It targets HOPE's **real** files/tables (audited at
> `/workspace/hope`) and mirrors HOPE's existing pharmacy prescription-queue
> pattern so it fits the codebase idiomatically. Nothing here touches HOPE's
> protected files (`schema/pharmacy.ts`, `schema/billing.ts`, `auth.tsx`) or the
> `patients`/`uhid` invariants.

## 0. What HOPE needs to add

1. **Emit** a diagnostic referral to CARE when a doctor saves a prescription with
   lab/radiology tests — mirroring the `prescription_queue` upsert already inside
   `PUT /opd/:id` (`routes/opd.ts:129-178`).
2. **Receive** result callbacks from CARE — a new API-key/HMAC middleware in the
   empty `src/middlewares/`, mounted public (before `requireAuth`), landing results
   in `diagnostic_orders.items`/`status` and PDFs in `patient_documents`.

Config (env): `CARE_REFERRAL_URL=https://care.example/api/integration/v1`,
`CARE_PARTNER_KEY=intgk_…` (issued by CARE admin), `CARE_CALLBACK_SECRET=…`
(shared HMAC secret; also set as `INTEGRATION_HOPE_SIGNING_SECRET` on CARE).

## 1. Emit adapter — `artifacts/api-server/src/services/careReferralEmitter.ts`

```ts
import { randomUUID } from "node:crypto";

// Mirrors the pharmacy queue enrichment in routes/opd.ts:138-150, but the
// "queue" is CARE. Best-effort: a failure NEVER blocks the OPD save (exactly
// like the prescription_queue upsert's try/catch at opd.ts:175-177). For full
// downtime safety, persist the payload to a small hope-side `care_referral_outbox`
// table first and let a worker POST it — same shape as CARE's integration_outbox.
export async function emitDiagnosticReferral(visit: {
  id: number; visitNo: string; patientId: number; doctorId: number | null;
  chiefComplaints?: string | null; diagnosis?: string | null;
  labTests?: string | null; radiologyTests?: string | null;
}, patient: { uhid: string; name: string; age: number | null; gender: string | null; phone: string | null; address?: string | null },
   doctor: { id: number; name: string; specialization?: string | null; registrationNo?: string | null } | null): Promise<void> {
  const url = process.env.CARE_REFERRAL_URL, key = process.env.CARE_PARTNER_KEY;
  if (!url || !key) return; // integration not configured — no-op

  // Free-text lab_tests / radiology_tests → structured items. CARE's mapping
  // layer (service_catalogue_mappings) resolves names/synonyms; unmatched items
  // land in CARE's admin review queue, so free text is safe to send.
  const split = (s?: string | null, modality?: string) =>
    (s ?? "").split(/[,;\n]/).map((t) => t.trim()).filter(Boolean).map((name) => ({ name, modality }));
  const tests = [...split(visit.labTests, "lab"), ...split(visit.radiologyTests, "radiology")];
  if (tests.length === 0) return;

  const body = JSON.stringify({
    referralUuid: `hope-${visit.id}-${randomUUID()}`, // stable per emit; CARE dedupes
    idempotencyKey: `hope-opd-${visit.id}`,           // one referral per visit
    source: { org: "HOPE", patientId: patient.uhid, encounterId: visit.visitNo, prescriptionId: `OPD-${visit.id}` },
    patient: { name: patient.name, age: patient.age, ageUnit: "years", gender: patient.gender, phone: patient.phone, address: patient.address },
    referringDoctor: doctor ? { id: String(doctor.id), name: doctor.name, specialization: doctor.specialization, registrationNo: doctor.registrationNo } : undefined,
    clinical: { history: visit.chiefComplaints, provisionalDiagnosis: visit.diagnosis },
    priority: "routine",
    tests,
  });

  try {
    await fetch(`${url}/diagnostic-referrals`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body,
    });
  } catch (e) {
    console.error("[care-referral] emit failed (non-fatal):", (e as Error)?.message);
  }
}
```

Hook it into the existing OPD save, right beside the pharmacy queue upsert
(`routes/opd.ts`, inside `PUT /opd/:id` after the visit row is persisted):

```ts
// ... existing prescription_queue upsert (opd.ts:129-178) ...
// NEW: mirror it for diagnostics → CARE
if ((visit.labTests?.trim() || visit.radiologyTests?.trim())) {
  const [pt] = await db.select().from(patientsTable).where(eq(patientsTable.id, visit.patientId));
  const [doc] = visit.doctorId ? await db.select().from(doctorsTable).where(eq(doctorsTable.id, visit.doctorId)) : [null];
  void emitDiagnosticReferral(visit, pt, doc); // fire-and-forget, non-fatal
}
```

## 2. Receive callback — `artifacts/api-server/src/middlewares/careCallbackAuth.ts`

```ts
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

export function requireCareSignature(req: Request, res: Response, next: NextFunction) {
  const secret = process.env.CARE_CALLBACK_SECRET;
  if (!secret) return res.status(503).json({ error: "CARE callback not configured" });
  const ts = String(req.headers["x-care-timestamp"] ?? "");
  const sig = String(req.headers["x-care-signature"] ?? "").replace(/^sha256=/, "");
  // Replay protection: reject timestamps outside a 5-minute window.
  if (!ts || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return res.status(401).json({ error: "stale or missing timestamp" });
  const raw = (req as unknown as { rawBody?: string }).rawBody ?? JSON.stringify(req.body);
  const expected = createHmac("sha256", secret).update(`${ts}.${raw}`).digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(sig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return res.status(401).json({ error: "bad signature" });
  next();
}
```

Route — `artifacts/api-server/src/routes/care-callback.ts`, mounted in
`routes/index.ts` **before** `requireAuth` (public section):

```ts
router.post("/integration/care-callback", requireCareSignature, async (req, res) => {
  const { eventId, eventType, data } = req.body ?? {};
  // Idempotent receiver: dedupe on eventId (a tiny processed_events table).
  if (await alreadyProcessed(eventId)) return res.json({ ok: true, duplicate: true });

  if (eventType === "diagnostic_report.finalised") {
    // Land the result on the HOPE diagnostic order (reuse PUT /diagnostic-orders/:id
    // logic — write into items[].result / status, set completed_at), and attach
    // the PDF (if provided) to patient_documents (category "Lab Report"/"Radiology").
    await applyCareResult(data);          // updates diagnostic_orders.items + status
  } else if (eventType === "diagnostic_result.critical") {
    await raiseCriticalAlert(data);       // HOPE critical-result workflow + ack, then
                                          // POST back to CARE /acknowledge with recipient/time
  }
  await markProcessed(eventId);
  res.json({ ok: true });
});
```

Landing point rationale (from the HOPE audit): `diagnostic_orders` is the primary
lab/radiology record (`items` jsonb carries `result`/`observation`, `status` is free
text), `PUT /diagnostic-orders/:id` already writes exactly those fields, and
`patient_documents` is the binary report store. CARE-finalised reports must not be
editable in HOPE — store them read-only and use addendum/amendment for changes.

## 3. Downtime & reliability (recommended parity)

For guaranteed delivery of the emit side, add a HOPE `care_referral_outbox` table
(mirroring CARE's `integration_outbox`) and a small poller, so a HOPE→CARE POST that
fails is retried rather than dropped. The doctor's prescription always saves
regardless (the emit is fire-and-forget), and a pending-sync status is shown until
delivery succeeds — satisfying brief §16.
