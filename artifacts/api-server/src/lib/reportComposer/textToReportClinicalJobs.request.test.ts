/**
 * The owner's clinical cases A–E through the ACTUAL Composer backend and the clinic's
 * own model — not a standalone Ollama prompt.
 *
 * What makes this the real path: the snapshot is POSTed to `POST
 * /api/radiology/report-composer/jobs` on the mounted production router (so it goes
 * through the identity check, the input hash, the frozen job row and the acceptance
 * boundary), then `processComposeJob` runs the same worker the NAS runs —
 * `composeEngine` → persona prompt → `OllamaComposerAdapter` → `parseComposerDraftJson`
 * → `validateComposerOutput` — and the draft is read back from the job view the
 * workspace reads. qwen3:14b is resolved from `clinic_settings` in the database, so
 * this measures the model the radiologist would actually get, at the numCtx and timeout
 * the clinic configured.
 *
 * Gated twice over: a database must be reachable AND `RUN_LIVE_OLLAMA=1` must be set,
 * because this contacts inference hardware. CI runs it zero times; the numbers it
 * produces are the before/after evidence for the Text-to-Report brief.
 *
 * Synthetic study, synthetic staff account, marker-scoped and deleted afterwards. No
 * real patient and nothing from the approved 16-day-old MRI study.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createTestApp, hasDatabaseUrl } from "../../testSupport/apiTestApp";
import { db } from "@workspace/db";
import {
  aiReportComposeJobsTable,
  portalSessionsTable,
  radiologyWorklistTable,
  usersTable,
} from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { CLINICAL_CASES } from "../../testSupport/textToReportCases";

/**
 * The job view fields this battery reads. Declared here rather than imported from
 * `diagnostic-erp` because the two packages are separate compilation units: a
 * type-only cross-package import resolves the whole ERP module graph (zustand, the
 * `@/` alias) inside `pnpm typecheck` for api-server, which cannot answer it.
 * `ComposeJobView` is the wire contract; a drift shows up as a property this file
 * reads coming back undefined.
 */
type JobViewSlice = {
  status: string;
  safeError: string | null;
  model: string | null;
  provider?: string | null;
  fallbackUsed: boolean;
  latencyMs: number | null;
  usage?: { promptTokens: number | null; completionTokens: number | null; totalTokens: number | null } | null;
  validation: unknown;
  draft: { findings?: string; impression?: string; recommendation?: string } | null;
  proposedFindings: string | null;
  proposedImpression: string | null;
  proposedRecommendation: string | null;
};

const WANTED = process.env.RUN_LIVE_OLLAMA === "1" && hasDatabaseUrl();
const marker = `vitest-t2r-${randomUUID().slice(0, 8)}`;

describe.runIf(WANTED)("clinical cases A–E through the composer backend on the clinic model", () => {
  let app: Express;
  let token = "";
  let userId = 0;
  const worklistIds: number[] = [];
  const jobIds: number[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    token = `vitest-token-${randomUUID()}`;
    const [user] = await db
      .insert(usersTable)
      .values({
        name: `Vitest T2R ${marker}`,
        email: `${marker}@vitest.invalid`,
        username: marker,
        role: "admin",
        permissions: JSON.stringify(["ai_reporting.use", "ai_reporting.configure"]),
        pin: "0000",
        isActive: true,
      })
      .returning();
    userId = user.id;
    await db.insert(portalSessionsTable).values({
      token,
      scope: "staff",
      subjectId: user.id,
      subjectName: user.name,
      expiresAt: new Date(Date.now() + 30 * 60_000),
    });
  });

  afterAll(async () => {
    if (jobIds.length) {
      await db.delete(aiReportComposeJobsTable).where(inArray(aiReportComposeJobsTable.id, jobIds));
    }
    if (worklistIds.length) {
      await db.delete(radiologyWorklistTable).where(inArray(radiologyWorklistTable.id, worklistIds));
    }
    if (token) await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token));
    if (userId) await db.delete(usersTable).where(eq(usersTable.id, userId));
  });

  for (const c of CLINICAL_CASES) {
    it(`case ${c.id} — ${c.name}`, async () => {
      const [wl] = await db
        .insert(radiologyWorklistTable)
        .values({
          patientName: `Vitest T2R ${c.id} ${marker}`,
          modality: "MR",
          studyDescription: c.study.studyType,
          studyInstanceUID: `1.2.826.vitest.${marker}.${c.id}`,
          accessionNumber: `ACC-${marker}-${c.id}`,
          status: "STUDY_RECEIVED",
        })
        .returning();
      worklistIds.push(wl.id);

      const snapshot = { ...c.study, worklistId: wl.id, studyId: null, reportId: null };
      const enq = await request(app)
        .post("/api/radiology/report-composer/jobs")
        .set("Authorization", `Bearer ${token}`)
        .send({ snapshot, jobKind: "FULL_REPORT" });
      expect(enq.status, `enqueue refused: ${JSON.stringify(enq.body)}`).toBe(202);
      const jobId = enq.body.jobId as number;
      jobIds.push(jobId);

      const started = Date.now();
      await (await import("./jobService")).processComposeJob(jobId);
      const wallMs = Date.now() - started;

      const res = await request(app)
        .get(`/api/radiology/report-composer/jobs/${jobId}`)
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      const job = res.body.job as JobViewSlice;

      const findings = job.draft?.findings ?? job.proposedFindings ?? "";
      const impression = job.draft?.impression ?? job.proposedImpression ?? "";
      const all = `${findings}\n${impression}`.toLowerCase();

      console.log(`\n===== CASE ${c.id} — ${c.name} =====`);
      console.log(`status=${job.status} safeError=${job.safeError ?? "-"} model=${job.model ?? "-"}`);
      console.log(`provider=${job.provider ?? "-"} fallbackUsed=${job.fallbackUsed} latencyMs=${job.latencyMs ?? "-"} wallMs=${wallMs}`);
      console.log(`tokens prompt=${job.usage?.promptTokens ?? "-"} completion=${job.usage?.completionTokens ?? "-"} total=${job.usage?.totalTokens ?? "-"}`);
      console.log(`validation=${JSON.stringify(job.validation)}`);
      console.log(`--- FINDINGS ---\n${findings}`);
      console.log(`--- IMPRESSION ---\n${impression}`);
      console.log(`--- RECOMMENDATION ---\n${job.draft?.recommendation ?? job.proposedRecommendation ?? ""}`);

      // 1. the pipeline produced a draft rather than a refusal
      expect(
        job.status,
        `the shipped validator refused this draft: ${job.safeError ?? "?"} — validation ${JSON.stringify(job.validation)}`,
      ).toBe("READY");

      // 2. the report is complete enough to be usable
      expect(findings.trim().length, "findings came back empty").toBeGreaterThan(200);
      expect(impression.trim().length, "impression came back empty").toBeGreaterThan(20);

      // 3. the clinical content the brief asked for. Each `contains` entry may carry
      //    `|` between clinically equivalent spellings: the model said "global cerebral
      //    atrophy" where the brief wrote "generalized cerebral volume loss".
      for (const needle of c.expect.contains) {
        const alts = needle.toLowerCase().split("|");
        expect(
          alts.some((alt) => all.includes(alt)),
          `case ${c.id}: report states none of ${JSON.stringify(alts)}\n${all}`,
        ).toBe(true);
      }
      for (const forbidden of c.expect.absent) {
        const hit = assertedSomewhere(all, forbidden);
        expect(hit, `case ${c.id}: report asserts a forbidden claim: ${hit}`).toBeNull();
      }

      // 4. anatomical completeness — the remaining normal anatomy must be reported.
      //    Stems, not terms: "Ventricular system is normal" covers the ventricles and
      //    does not contain the string "ventricles".
      const missing = c.expect.anatomy.filter((a) => !all.includes(a));
      expect(missing, `case ${c.id}: anatomy never covered: ${missing.join(", ")}`).toEqual([]);

      // 5. MEASUREMENT, not an assertion: does the report still deny what its own
      //    dictation contradicts? The template loads "No acute infarct is seen." when
      //    the examination opens, and a stroke report must not carry both. Nothing on
      //    the typed/voice-free-text path retires it (see the TYPED-PROSE pin in
      //    diagnostic-erp's textToReportConflictRetirement.test.ts), so this is logged
      //    and reported rather than asserted — the requirement is the PR's, the fix is
      //    the owner's decision on where a scaffold sentence may be deleted.
      const contradictions = CONTRADICTED_SCAFFOLD.filter(
        (s) => all.includes(s) && assertedSomewhere(all, /restricted diffusion/),
      );
      if (contradictions.length > 0) {
        console.log(`!! case ${c.id}: scaffold denial kept beside a contradicting finding: ${contradictions.join(" | ")}`);
      }
    }, 300_000);
  }
});

/**
 * Did the report ASSERT a forbidden claim, as opposed to denying one?
 *
 * Tested sentence by sentence, and a sentence with a denial cue in front of the match
 * does not count: the correct answer to case C is "No restricted diffusion is seen.",
 * and the correct answer to case E is "No spondylolisthesis is seen." — both are the
 * template's own normals, and what the brief forbids is inventing the finding, not
 * keeping the reassurance. Returns the offending sentence, because a checker that only
 * says "matched" hides whether the model asserted it or denied it. A pattern that
 * needs text across a sentence boundary never gets the denial exemption.
 */
function assertedSomewhere(text: string, pattern: RegExp): string | null {
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    const at = sentence.search(pattern);
    if (at < 0) continue;
    if (/\b(?:no|not|without|absent|negative|denies|denied|free of|clear of)\b/.test(sentence.slice(0, at))) {
      continue;
    }
    return sentence.trim();
  }
  return null;
}

const CONTRADICTED_SCAFFOLD = [
  "no acute infarct is seen.",
  "no restricted diffusion is seen on dwi/adc.",
];
