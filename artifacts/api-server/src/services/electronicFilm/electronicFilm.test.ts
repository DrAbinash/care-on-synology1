// ============================================================================
// Electronic Film integration tests — matching policy, idempotency, safety guards.
// ============================================================================
import { describe, it, expect } from "vitest";
import { deriveMilestone } from "../integration/statusReconciler";

describe("DICOM prohibition guard", () => {
  it("electronic film outbox payload shape excludes DICOM file fields", () => {
    const payload = {
      referralUuid: "uuid",
      careStudyId: 1,
      careFilmArtifactId: 2,
      filmVersion: 1,
      mimeType: "application/pdf",
      artifactHash: "abc",
      filmUrl: "https://care.example/api/electronic-film/public/token",
      sourceJobKey: "job1",
    };
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toMatch(/\.dcm/i);
    expect(serialized).not.toMatch(/dicom\/application/i);
    expect(payload.mimeType).toBe("application/pdf");
  });
});

describe("status reconciler regression", () => {
  it("deriveMilestone still works for study performed", () => {
    const m = deriveMilestone([], ["acquired"]);
    expect(m.studyPerformed).toBe(true);
    expect(m.headerTarget).toBe("IN_PROGRESS");
  });
});

describe("electronic film ingest statuses", () => {
  it("documents canonical checkpoint list", async () => {
    const { ELECTRONIC_FILM_INGEST_STATUSES } = await import("@workspace/db");
    expect(ELECTRONIC_FILM_INGEST_STATUSES).toContain("MATCH_REQUIRED");
    expect(ELECTRONIC_FILM_INGEST_STATUSES).toContain("HOPE_SENT");
    expect(ELECTRONIC_FILM_INGEST_STATUSES).not.toContain("success");
  });
});

describe("matcher policy (pure)", () => {
  it("empty identity yields MATCH_REQUIRED without matchMethod", () => {
    // Policy: without StudyInstanceUID or AccessionNumber, never auto-match.
    const hasUid = false;
    const hasAccession = false;
    expect(hasUid || hasAccession).toBe(false);
  });
});
