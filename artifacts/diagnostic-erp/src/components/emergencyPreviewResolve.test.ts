import { describe, expect, it } from "vitest";
import { previewRowCanResolve, resolvedCaption } from "./emergencyPreviewResolve";

describe("emergency preview resolve UI", () => {
  it("shows Resolve on CONFLICT / PROBABLE, not on exact or imported", () => {
    expect(previewRowCanResolve({ matchClass: "CONFLICT", alreadyImported: false, blocked: false })).toBe(true);
    expect(previewRowCanResolve({ matchClass: "PROBABLE_MATCH", alreadyImported: false, blocked: false })).toBe(true);
    expect(previewRowCanResolve({ matchClass: "EXACT_MATCH", alreadyImported: false, blocked: false })).toBe(false);
    expect(previewRowCanResolve({ matchClass: "CONFLICT", alreadyImported: true, blocked: false })).toBe(false);
    expect(previewRowCanResolve({ matchClass: "CONFLICT", alreadyImported: false, blocked: true })).toBe(false);
  });

  it("keeps resolver available after a stored resolution until import", () => {
    expect(previewRowCanResolve({
      matchClass: "EXACT_MATCH",
      alreadyImported: false,
      blocked: false,
      resolution: { action: "select_existing" },
    })).toBe(true);
    expect(previewRowCanResolve({
      matchClass: "EXACT_MATCH",
      alreadyImported: true,
      blocked: false,
      resolution: { action: "select_existing" },
    })).toBe(false);
  });

  it("formats resolved caption with UHID and name", () => {
    expect(resolvedCaption({
      alreadyImported: false,
      resolution: { carePatientLabel: "P-00011 — Abinash Kumar", resolvedByStaffName: "Owner", resolvedAt: "2026-08-15T00:00:00.000Z" },
    })).toMatch(/Resolved to: P-00011 — Abinash Kumar/);
  });
});
