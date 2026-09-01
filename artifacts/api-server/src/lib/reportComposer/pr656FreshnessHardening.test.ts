/**
 * PR #656 — Final safety hardening tests for the READY → STALE_READY
 * freshness path when canonical study context changes after enqueue.
 *
 * These tests exercise the PURE stale-decision helper `isComposeJobStale`
 * (no DB required) plus the server-side hash recomputation for the live
 * inputHash that the client sends.
 *
 * The client/server hash equivalence is covered separately by
 * `composeStudyContext.test.ts` on the diagnostic-erp side (which imports
 * server helpers and compares them to the client ones) — that test file
 * lives under diagnostic-erp because api-server's tsconfig enforces
 * `rootDir: "src"` and refuses cross-package test imports.
 *
 * Coverage (A–J from PR #656 brief):
 *   A. Plain → Contrast with identical narrative: READY → STALE_READY.
 *   B. Contrast → Plain: READY → STALE_READY.
 *   C. LS Spine + Whole Spine Screening → LS Spine only: READY → STALE_READY.
 *   D. reportTitle change only: READY → STALE_READY.
 *   E. bodyPart / family / spineSegment change: READY → STALE_READY.
 *   F. Unchanged context + unchanged report: stays READY (not stale).
 *   G. Narrative change: still STALE_READY as before.
 *   H. Observation-only change: still STALE_READY (PR #654 invariant).
 *   I. Legacy freshness request without inputHash: backward compatible.
 *   J. Client/server inputHash equivalence is covered by composeStudyContext.test.ts
 *      on the diagnostic-erp side (cross-package test file).
 */
import { describe, expect, it } from "vitest";
import {
  canonicalStudyContextHashPayload,
  computeSnapshotHashes,
  hashText,
  isComposeJobStale,
} from "./snapshot";
import { parseComposerSnapshot, type ComposerInputSnapshot } from "./types";

/**
 * Build a canonical MRI Brain Plain snapshot for testing.
 * Brain has no spine segment, so we omit that field rather than passing null
 * (server zod schema requires string when present).
 */
function brainSnapshot(overrides: Partial<ComposerInputSnapshot> = {}): ComposerInputSnapshot {
  return parseComposerSnapshot({
    modality: "MR",
    region: "Brain",
    regions: ["Brain"],
    bodyPart: "BRAIN",
    family: "brain",
    protocol: "Plain",
    reportTitle: "MRI BRAIN PLAIN",
    studyType: "MRI Brain Plain",
    findings: "Few punctate T2/FLAIR hyperintense white matter lesions.",
    impression: "Mild chronic small vessel ischemic disease.",
    recommendation: "",
    observations: [],
    jobKindHint: "FULL_REPORT",
    ...overrides,
  });
}

/**
 * Build a canonical MRI LS Spine + Whole Spine Screening snapshot for testing.
 */
function lsSpineWithScreeningSnapshot(overrides: Partial<ComposerInputSnapshot> = {}): ComposerInputSnapshot {
  return parseComposerSnapshot({
    modality: "MR",
    region: "LS Spine",
    regions: ["LS Spine", "Whole Spine Screening"],
    bodyPart: "SPINE_LUMBAR",
    family: "spine",
    spineSegment: "lumbar",
    protocol: "Plain",
    reportTitle: "MRI LUMBOSACRAL SPINE WITH WHOLE SPINE SCREENING",
    studyType: "MRI LS Spine + Whole Spine Screening",
    findings: "Degenerative disc disease at L4-L5.",
    impression: "Mild disc bulge at L4-L5.",
    recommendation: "",
    observations: [],
    jobKindHint: "FULL_REPORT",
    ...overrides,
  });
}

describe("PR #656 — freshness hardening: study-context change invalidates READY", () => {
  // ====================================================================
  // A. Plain → Contrast with identical narrative: READY → STALE_READY.
  // ====================================================================
  it("A. Plain → Contrast with identical narrative flips READY → STALE_READY", () => {
    const enqueue = brainSnapshot({ protocol: "Plain" });
    const enqueueHashes = computeSnapshotHashes(enqueue);
    // Live: protocol changed to Contrast, narrative + observations identical.
    const live = brainSnapshot({ protocol: "Contrast" });
    const liveHashes = computeSnapshotHashes(live);

    // Sanity: inputHash MUST differ (study context changed).
    expect(enqueueHashes.inputHash).not.toBe(liveHashes.inputHash);
    // Sanity: reportRevision MUST be identical (no narrative / observation change).
    expect(enqueueHashes.reportRevision).toBe(liveHashes.reportRevision);

    const { stale } = isComposeJobStale({
      jobStatus: "READY",
      storedReportRevision: enqueueHashes.reportRevision,
      storedFindingsHash: enqueueHashes.findingsHash,
      storedImpressionHash: enqueueHashes.impressionHash,
      storedInputHash: enqueueHashes.inputHash,
      current: {
        findingsHash: liveHashes.findingsHash,
        impressionHash: liveHashes.impressionHash,
        reportRevision: liveHashes.reportRevision,
        inputHash: liveHashes.inputHash,
      },
    });
    expect(stale).toBe(true);
  });

  // ====================================================================
  // B. Contrast → Plain: READY → STALE_READY (reverse direction also safe).
  // ====================================================================
  it("B. Contrast → Plain flips READY → STALE_READY", () => {
    const enqueue = brainSnapshot({ protocol: "Contrast" });
    const enqueueHashes = computeSnapshotHashes(enqueue);
    const live = brainSnapshot({ protocol: "Plain" });
    const liveHashes = computeSnapshotHashes(live);

    expect(enqueueHashes.inputHash).not.toBe(liveHashes.inputHash);
    expect(enqueueHashes.reportRevision).toBe(liveHashes.reportRevision);

    const { stale } = isComposeJobStale({
      jobStatus: "READY",
      storedReportRevision: enqueueHashes.reportRevision,
      storedFindingsHash: enqueueHashes.findingsHash,
      storedImpressionHash: enqueueHashes.impressionHash,
      storedInputHash: enqueueHashes.inputHash,
      current: {
        findingsHash: liveHashes.findingsHash,
        impressionHash: liveHashes.impressionHash,
        reportRevision: liveHashes.reportRevision,
        inputHash: liveHashes.inputHash,
      },
    });
    expect(stale).toBe(true);
  });

  // ====================================================================
  // C. LS Spine + Whole Spine Screening → LS Spine only: READY → STALE_READY.
  // ====================================================================
  it("C. LS Spine + Whole Spine Screening → LS Spine only flips READY → STALE_READY", () => {
    const enqueue = lsSpineWithScreeningSnapshot();
    const enqueueHashes = computeSnapshotHashes(enqueue);
    // Live: screening region removed, narrative + observations identical.
    const live = lsSpineWithScreeningSnapshot({
      regions: ["LS Spine"],
      reportTitle: "MRI LUMBOSACRAL SPINE",
    });
    const liveHashes = computeSnapshotHashes(live);

    expect(enqueueHashes.inputHash).not.toBe(liveHashes.inputHash);
    expect(enqueueHashes.reportRevision).toBe(liveHashes.reportRevision);

    const { stale } = isComposeJobStale({
      jobStatus: "READY",
      storedReportRevision: enqueueHashes.reportRevision,
      storedFindingsHash: enqueueHashes.findingsHash,
      storedImpressionHash: enqueueHashes.impressionHash,
      storedInputHash: enqueueHashes.inputHash,
      current: {
        findingsHash: liveHashes.findingsHash,
        impressionHash: liveHashes.impressionHash,
        reportRevision: liveHashes.reportRevision,
        inputHash: liveHashes.inputHash,
      },
    });
    expect(stale).toBe(true);
  });

  // ====================================================================
  // D. reportTitle change only: READY → STALE_READY.
  // ====================================================================
  it("D. reportTitle change only flips READY → STALE_READY", () => {
    const enqueue = brainSnapshot({ reportTitle: "MRI BRAIN PLAIN" });
    const enqueueHashes = computeSnapshotHashes(enqueue);
    // Live: only the printed report title changed.
    const live = brainSnapshot({ reportTitle: "MRI BRAIN WITH CONTRAST" });
    const liveHashes = computeSnapshotHashes(live);

    expect(enqueueHashes.inputHash).not.toBe(liveHashes.inputHash);
    expect(enqueueHashes.reportRevision).toBe(liveHashes.reportRevision);

    const { stale } = isComposeJobStale({
      jobStatus: "READY",
      storedReportRevision: enqueueHashes.reportRevision,
      storedFindingsHash: enqueueHashes.findingsHash,
      storedImpressionHash: enqueueHashes.impressionHash,
      storedInputHash: enqueueHashes.inputHash,
      current: {
        findingsHash: liveHashes.findingsHash,
        impressionHash: liveHashes.impressionHash,
        reportRevision: liveHashes.reportRevision,
        inputHash: liveHashes.inputHash,
      },
    });
    expect(stale).toBe(true);
  });

  // ====================================================================
  // E. bodyPart / family / spineSegment change: READY → STALE_READY.
  // ====================================================================
  it("E. bodyPart change flips READY → STALE_READY", () => {
    const enqueue = brainSnapshot({ bodyPart: "BRAIN" });
    const enqueueHashes = computeSnapshotHashes(enqueue);
    const live = brainSnapshot({ bodyPart: "BRAIN_WITH_CONTRAST" });
    const liveHashes = computeSnapshotHashes(live);

    expect(enqueueHashes.inputHash).not.toBe(liveHashes.inputHash);
    const { stale } = isComposeJobStale({
      jobStatus: "READY",
      storedReportRevision: enqueueHashes.reportRevision,
      storedFindingsHash: enqueueHashes.findingsHash,
      storedImpressionHash: enqueueHashes.impressionHash,
      storedInputHash: enqueueHashes.inputHash,
      current: {
        findingsHash: liveHashes.findingsHash,
        impressionHash: liveHashes.impressionHash,
        reportRevision: liveHashes.reportRevision,
        inputHash: liveHashes.inputHash,
      },
    });
    expect(stale).toBe(true);
  });

  it("E. family change (brain → spine) flips READY → STALE_READY", () => {
    const enqueue = brainSnapshot({ family: "brain" });
    const enqueueHashes = computeSnapshotHashes(enqueue);
    const live = brainSnapshot({ family: "spine" });
    const liveHashes = computeSnapshotHashes(live);

    expect(enqueueHashes.inputHash).not.toBe(liveHashes.inputHash);
    const { stale } = isComposeJobStale({
      jobStatus: "READY",
      storedReportRevision: enqueueHashes.reportRevision,
      storedFindingsHash: enqueueHashes.findingsHash,
      storedImpressionHash: enqueueHashes.impressionHash,
      storedInputHash: enqueueHashes.inputHash,
      current: {
        findingsHash: liveHashes.findingsHash,
        impressionHash: liveHashes.impressionHash,
        reportRevision: liveHashes.reportRevision,
        inputHash: liveHashes.inputHash,
      },
    });
    expect(stale).toBe(true);
  });

  it("E. spineSegment change (lumbar → cervical) flips READY → STALE_READY", () => {
    const enqueue = lsSpineWithScreeningSnapshot({ spineSegment: "lumbar" });
    const enqueueHashes = computeSnapshotHashes(enqueue);
    const live = lsSpineWithScreeningSnapshot({ spineSegment: "cervical" });
    const liveHashes = computeSnapshotHashes(live);

    expect(enqueueHashes.inputHash).not.toBe(liveHashes.inputHash);
    const { stale } = isComposeJobStale({
      jobStatus: "READY",
      storedReportRevision: enqueueHashes.reportRevision,
      storedFindingsHash: enqueueHashes.findingsHash,
      storedImpressionHash: enqueueHashes.impressionHash,
      storedInputHash: enqueueHashes.inputHash,
      current: {
        findingsHash: liveHashes.findingsHash,
        impressionHash: liveHashes.impressionHash,
        reportRevision: liveHashes.reportRevision,
        inputHash: liveHashes.inputHash,
      },
    });
    expect(stale).toBe(true);
  });

  it("E. modality change (MR → CT) flips READY → STALE_READY", () => {
    const enqueue = brainSnapshot({ modality: "MR" });
    const enqueueHashes = computeSnapshotHashes(enqueue);
    const live = brainSnapshot({ modality: "CT" });
    const liveHashes = computeSnapshotHashes(live);

    expect(enqueueHashes.inputHash).not.toBe(liveHashes.inputHash);
    const { stale } = isComposeJobStale({
      jobStatus: "READY",
      storedReportRevision: enqueueHashes.reportRevision,
      storedFindingsHash: enqueueHashes.findingsHash,
      storedImpressionHash: enqueueHashes.impressionHash,
      storedInputHash: enqueueHashes.inputHash,
      current: {
        findingsHash: liveHashes.findingsHash,
        impressionHash: liveHashes.impressionHash,
        reportRevision: liveHashes.reportRevision,
        inputHash: liveHashes.inputHash,
      },
    });
    expect(stale).toBe(true);
  });

  it("E. primary region change (LS Spine → Cervical Spine) flips READY → STALE_READY", () => {
    const enqueue = lsSpineWithScreeningSnapshot({ region: "LS Spine" });
    const enqueueHashes = computeSnapshotHashes(enqueue);
    const live = lsSpineWithScreeningSnapshot({ region: "Cervical Spine" });
    const liveHashes = computeSnapshotHashes(live);

    expect(enqueueHashes.inputHash).not.toBe(liveHashes.inputHash);
    const { stale } = isComposeJobStale({
      jobStatus: "READY",
      storedReportRevision: enqueueHashes.reportRevision,
      storedFindingsHash: enqueueHashes.findingsHash,
      storedImpressionHash: enqueueHashes.impressionHash,
      storedInputHash: enqueueHashes.inputHash,
      current: {
        findingsHash: liveHashes.findingsHash,
        impressionHash: liveHashes.impressionHash,
        reportRevision: liveHashes.reportRevision,
        inputHash: liveHashes.inputHash,
      },
    });
    expect(stale).toBe(true);
  });

  // ====================================================================
  // F. Unchanged context + unchanged report: stays READY (not stale).
  // ====================================================================
  it("F. unchanged context + unchanged report stays READY (not stale)", () => {
    const enqueue = brainSnapshot();
    const enqueueHashes = computeSnapshotHashes(enqueue);
    const live = brainSnapshot(); // identical
    const liveHashes = computeSnapshotHashes(live);

    expect(enqueueHashes.inputHash).toBe(liveHashes.inputHash);
    expect(enqueueHashes.reportRevision).toBe(liveHashes.reportRevision);

    const { stale } = isComposeJobStale({
      jobStatus: "READY",
      storedReportRevision: enqueueHashes.reportRevision,
      storedFindingsHash: enqueueHashes.findingsHash,
      storedImpressionHash: enqueueHashes.impressionHash,
      storedInputHash: enqueueHashes.inputHash,
      current: {
        findingsHash: liveHashes.findingsHash,
        impressionHash: liveHashes.impressionHash,
        reportRevision: liveHashes.reportRevision,
        inputHash: liveHashes.inputHash,
      },
    });
    expect(stale).toBe(false);
  });

  // ====================================================================
  // G. Narrative change: still STALE_READY as before (axis 1 still works).
  // ====================================================================
  it("G. narrative change still flips READY → STALE_READY", () => {
    const enqueue = brainSnapshot({
      findings: "Few punctate T2/FLAIR hyperintense white matter lesions.",
    });
    const enqueueHashes = computeSnapshotHashes(enqueue);
    const live = brainSnapshot({
      findings: "Confluent T2/FLAIR hyperintense white matter lesions, Fazekas grade 2.",
    });
    const liveHashes = computeSnapshotHashes(live);

    expect(enqueueHashes.reportRevision).not.toBe(liveHashes.reportRevision);

    const { stale } = isComposeJobStale({
      jobStatus: "READY",
      storedReportRevision: enqueueHashes.reportRevision,
      storedFindingsHash: enqueueHashes.findingsHash,
      storedImpressionHash: enqueueHashes.impressionHash,
      storedInputHash: enqueueHashes.inputHash,
      current: {
        findingsHash: liveHashes.findingsHash,
        impressionHash: liveHashes.impressionHash,
        reportRevision: liveHashes.reportRevision,
        inputHash: liveHashes.inputHash,
      },
    });
    expect(stale).toBe(true);
  });

  // ====================================================================
  // H. Observation-only change: still STALE_READY (PR #654 invariant).
  // ====================================================================
  it("H. observation-only change still flips READY → STALE_READY (PR #654 invariant)", () => {
    const enqueue = brainSnapshot({
      observations: [
        { concept: "fazekas", source: "quick-select", findingsText: "Fazekas grade 1." },
      ],
    });
    const enqueueHashes = computeSnapshotHashes(enqueue);
    // Same narrative text + same study context, but observation severity
    // changed from grade 1 to grade 2.
    const live = brainSnapshot({
      observations: [
        { concept: "fazekas", source: "quick-select", findingsText: "Fazekas grade 2." },
      ],
    });
    const liveHashes = computeSnapshotHashes(live);

    // PR #654: observation change captured in reportRevision via obsCanon.
    expect(enqueueHashes.reportRevision).not.toBe(liveHashes.reportRevision);
    // PR #656: observation change ALSO captured in inputHash.
    expect(enqueueHashes.inputHash).not.toBe(liveHashes.inputHash);

    const { stale } = isComposeJobStale({
      jobStatus: "READY",
      storedReportRevision: enqueueHashes.reportRevision,
      storedFindingsHash: enqueueHashes.findingsHash,
      storedImpressionHash: enqueueHashes.impressionHash,
      storedInputHash: enqueueHashes.inputHash,
      current: {
        findingsHash: liveHashes.findingsHash,
        impressionHash: liveHashes.impressionHash,
        reportRevision: liveHashes.reportRevision,
        inputHash: liveHashes.inputHash,
      },
    });
    expect(stale).toBe(true);
  });

  // ====================================================================
  // I. Legacy freshness request without inputHash: backward compatible.
  // ====================================================================
  it("I. legacy freshness request without inputHash retains reportRevision-only behavior", () => {
    // Enqueue a Plain study.
    const enqueue = brainSnapshot({ protocol: "Plain" });
    const enqueueHashes = computeSnapshotHashes(enqueue);
    // Live: protocol changed to Contrast — narrative identical.
    const live = brainSnapshot({ protocol: "Contrast" });
    const liveHashes = computeSnapshotHashes(live);

    // Legacy client OMITS inputHash — only axis 1 (reportRevision) is enforced.
    // Since narrative + observations are identical, reportRevision matches,
    // so the legacy freshness check returns NOT stale.
    const { stale } = isComposeJobStale({
      jobStatus: "READY",
      storedReportRevision: enqueueHashes.reportRevision,
      storedFindingsHash: enqueueHashes.findingsHash,
      storedImpressionHash: enqueueHashes.impressionHash,
      storedInputHash: enqueueHashes.inputHash,
      current: {
        findingsHash: liveHashes.findingsHash,
        impressionHash: liveHashes.impressionHash,
        reportRevision: liveHashes.reportRevision,
        // inputHash intentionally omitted — simulates a pre-PR #656 client.
      },
    });
    // Legacy client: NOT stale (cannot detect context change without inputHash).
    // This is the documented backward-compat behavior — new clients always
    // provide inputHash so this case does NOT arise in production.
    expect(stale).toBe(false);
  });

  it("I. legacy freshness without inputHash still detects narrative change (axis 1 preserved)", () => {
    const enqueue = brainSnapshot({ findings: "Original findings text." });
    const enqueueHashes = computeSnapshotHashes(enqueue);
    const live = brainSnapshot({ findings: "Edited findings text." });
    const liveHashes = computeSnapshotHashes(live);

    const { stale } = isComposeJobStale({
      jobStatus: "READY",
      storedReportRevision: enqueueHashes.reportRevision,
      storedFindingsHash: enqueueHashes.findingsHash,
      storedImpressionHash: enqueueHashes.impressionHash,
      storedInputHash: enqueueHashes.inputHash,
      current: {
        findingsHash: liveHashes.findingsHash,
        impressionHash: liveHashes.impressionHash,
        reportRevision: liveHashes.reportRevision,
        // inputHash intentionally omitted — legacy client.
      },
    });
    expect(stale).toBe(true);
  });

  // ====================================================================
  // J. Client/server inputHash equivalence is covered by
  // `composeStudyContext.test.ts` on the diagnostic-erp side (it imports
  // server helpers and compares them to the client ones in a single test
  // file that lives under diagnostic-erp because api-server's tsconfig
  // enforces `rootDir: "src"` and refuses cross-package test imports).
  //
  // The tests below verify the SERVER-SIDE hash behavior in isolation:
  //   - server inputHash must differ when study context changes.
  //   - server canonicalStudyContextHashPayload must differ when context changes.
  //   - server reportRevision must be identical when only context changes.
  // ====================================================================
  it("J. server computeSnapshotHashes: study-context change → different inputHash, identical reportRevision", () => {
    const plain = brainSnapshot({ protocol: "Plain" });
    const contrast = brainSnapshot({ protocol: "Contrast" });
    const plainHashes = computeSnapshotHashes(plain);
    const contrastHashes = computeSnapshotHashes(contrast);

    expect(plainHashes.inputHash).not.toBe(contrastHashes.inputHash);
    // reportRevision is INTENTIONALLY identical — context is NOT a clinically
    // editable report-state field. PR #654/PR P0-2 architecture separates
    // inputHash (frozen AI input incl. context) from reportRevision (editable
    // report state excl. context).
    expect(plainHashes.reportRevision).toBe(contrastHashes.reportRevision);
    expect(plainHashes.findingsHash).toBe(contrastHashes.findingsHash);
    expect(plainHashes.impressionHash).toBe(contrastHashes.impressionHash);
  });

  it("J. server canonicalStudyContextHashPayload differs when context changes", () => {
    const plain = brainSnapshot({ protocol: "Plain" });
    const contrast = brainSnapshot({ protocol: "Contrast" });
    expect(canonicalStudyContextHashPayload(plain)).not.toBe(canonicalStudyContextHashPayload(contrast));
  });

  it("J. server canonicalStudyContextHashPayload is stable for identical context", () => {
    const snap1 = brainSnapshot();
    const snap2 = brainSnapshot();
    expect(canonicalStudyContextHashPayload(snap1)).toBe(canonicalStudyContextHashPayload(snap2));
  });

  // ====================================================================
  // Edge cases: non-READY states, FAILED job, etc.
  // ====================================================================
  it("non-READY/STALE_READY jobs are never stale (terminal states)", () => {
    const enqueue = brainSnapshot();
    const enqueueHashes = computeSnapshotHashes(enqueue);
    const live = brainSnapshot({ protocol: "Contrast" });
    const liveHashes = computeSnapshotHashes(live);

    for (const status of ["QUEUED", "COMPOSING", "FAILED", "APPLIED", "DISCARDED", "CANCELLED", "OBSOLETE"]) {
      const { stale } = isComposeJobStale({
        jobStatus: status,
        storedReportRevision: enqueueHashes.reportRevision,
        storedFindingsHash: enqueueHashes.findingsHash,
        storedImpressionHash: enqueueHashes.impressionHash,
        storedInputHash: enqueueHashes.inputHash,
        current: {
          findingsHash: liveHashes.findingsHash,
          impressionHash: liveHashes.impressionHash,
          reportRevision: liveHashes.reportRevision,
          inputHash: liveHashes.inputHash,
        },
      });
      expect(stale).toBe(false);
    }
  });

  it("STALE_READY job with further context change remains stale (no spurious un-stale)", () => {
    const enqueue = brainSnapshot({ protocol: "Plain" });
    const enqueueHashes = computeSnapshotHashes(enqueue);
    const live = brainSnapshot({ protocol: "Contrast" });
    const liveHashes = computeSnapshotHashes(live);

    const { stale } = isComposeJobStale({
      jobStatus: "STALE_READY",
      storedReportRevision: enqueueHashes.reportRevision,
      storedFindingsHash: enqueueHashes.findingsHash,
      storedImpressionHash: enqueueHashes.impressionHash,
      storedInputHash: enqueueHashes.inputHash,
      current: {
        findingsHash: liveHashes.findingsHash,
        impressionHash: liveHashes.impressionHash,
        reportRevision: liveHashes.reportRevision,
        inputHash: liveHashes.inputHash,
      },
    });
    expect(stale).toBe(true);
  });
});

/**
 * End-to-end style: simulate the live client freshness call shape.
 *
 * This proves the data shape the client sends to
 * POST /api/radiology/report-composer/jobs/:id/freshness is what the server
 * route handler in routes/reportComposer.ts expects.
 *
 * Note: the client's WebCrypto `computeSnapshotHashes` is async; the server's
 * Node-crypto `computeSnapshotHashes` is sync. They MUST produce identical
 * hex digests (truncated SHA-256, 32 chars) for the same canonical snapshot.
 * That equivalence is verified in `composeStudyContext.test.ts` on the
 * diagnostic-erp side (which imports the server helper for cross-validation).
 * Here we exercise the SERVER side of the freshness handshake.
 */
describe("PR #656 — client → server freshness payload shape", () => {
  it("client computes reportRevision + inputHash and server-side isComposeJobStale consumes both", () => {
    const enqueue = brainSnapshot({ protocol: "Plain" });
    const enqueueHashes = computeSnapshotHashes(enqueue);

    // Simulate the client's refreshJob() recomputation:
    const liveSnap = brainSnapshot({ protocol: "Contrast" });
    // Server-side recomputation of the live snapshot's hashes. The client
    // computes these via its async WebCrypto variant — the digests are
    // identical to the server's because both use SHA-256 truncated to 32 hex
    // chars over the same canonical payload (see composeStudyContext.test.ts
    // on the diagnostic-erp side for the cross-package equivalence proof).
    const liveHashes = computeSnapshotHashes(liveSnap);

    // The client sends this body to /freshness:
    const freshnessRequestBody = {
      findings: liveSnap.findings ?? "",
      impression: liveSnap.impression ?? "",
      recommendation: liveSnap.recommendation ?? "",
      reportRevision: liveHashes.reportRevision,
      inputHash: liveHashes.inputHash,
    };

    // Sanity: request body has the expected keys.
    expect(freshnessRequestBody).toHaveProperty("reportRevision");
    expect(freshnessRequestBody).toHaveProperty("inputHash");

    // Server route handler extracts inputHash from the body, defaults to
    // undefined when absent (legacy client). Here it is present.
    const inputHashRaw = freshnessRequestBody.inputHash;
    const inputHash = typeof inputHashRaw === "string" && inputHashRaw.length > 0 ? inputHashRaw : undefined;
    expect(inputHash).toBe(liveHashes.inputHash);

    // Server computes findingsHash / impressionHash / recommendationHash
    // from the request body (matches the client's narrative text):
    const serverFindingsHash = hashText(freshnessRequestBody.findings);
    const serverImpressionHash = hashText(freshnessRequestBody.impression);
    expect(serverFindingsHash).toBe(liveHashes.findingsHash);
    expect(serverImpressionHash).toBe(liveHashes.impressionHash);

    // Server delegates to isComposeJobStale — must return stale=true because
    // inputHash changed (Plain → Contrast) even though reportRevision is
    // identical.
    const { stale } = isComposeJobStale({
      jobStatus: "READY",
      storedReportRevision: enqueueHashes.reportRevision,
      storedFindingsHash: enqueueHashes.findingsHash,
      storedImpressionHash: enqueueHashes.impressionHash,
      storedInputHash: enqueueHashes.inputHash,
      current: {
        findingsHash: serverFindingsHash,
        impressionHash: serverImpressionHash,
        reportRevision: freshnessRequestBody.reportRevision,
        ...(inputHash !== undefined ? { inputHash } : {}),
      },
    });
    expect(stale).toBe(true);
  });
});
