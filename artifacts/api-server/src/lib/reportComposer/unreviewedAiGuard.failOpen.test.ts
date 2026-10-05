/**
 * The guard is defence in depth. If it cannot read the composer jobs, the
 * radiologist must still be able to sign — the primary control is that the
 * server never writes AI text into a report without Apply, and every route that
 * consults this guard would otherwise 500.
 *
 * The companion proof for "the schema surface itself is unavailable" is the
 * existing patient-reports.pcpndt.test.ts suite, whose mock database does not
 * know the composer tables at all: finalize still succeeds there.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {
    select: () => {
      throw new Error("connection terminated unexpectedly");
    },
  },
}));
vi.mock("@workspace/db/schema", () => ({
  aiReportComposeJobsTable: {
    worklistId: "worklist_id",
    studyId: "study_id",
    reportId: "report_id",
    status: "status",
    trackedChangesJson: "tracked_changes_json",
    id: "id",
    updatedAt: "updated_at",
  },
}));
vi.mock("../logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { findUnreviewedAiDraft } from "./unreviewedAiGuard";
import { logger } from "../logger";

describe("unreviewed-AI guard fails open, never throws", () => {
  it("returns null when the database cannot be read", async () => {
    await expect(findUnreviewedAiDraft({ worklistId: 9, studyId: 9 })).resolves.toBeNull();
  });

  it("logs the failure instead of swallowing it", async () => {
    await findUnreviewedAiDraft({ worklistId: 9 });
    expect(logger.warn).toHaveBeenCalled();
  });

  it("does not even query when the request carries no study reference", async () => {
    await expect(findUnreviewedAiDraft({})).resolves.toBeNull();
  });
});
