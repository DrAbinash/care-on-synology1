import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@workspace/db", () => ({
  db: {},
  structuredReportTemplatesTable: {},
}));
vi.mock("../lib/usgReportTemplates", () => ({ USG_STRUCTURED_TEMPLATE_PRESETS: [] }));
vi.mock("../middleware/requireStaffAuth", () => ({ FULL_ACCESS_ROLES: new Set() }));
vi.mock("../lib/api-error", () => ({ apiErrorFromZod: () => undefined }));

import { PatchTemplateBody, PostTemplateBody } from "./structuredReportTemplates";

describe("structured report template body validation", () => {
  it("POST and PATCH parse req.body through Zod before writing", () => {
    const src = readFileSync(join(__dirname, "structuredReportTemplates.ts"), "utf8");
    expect(src).toContain("PostTemplateBody.safeParse(req.body)");
    expect(src).toContain("PatchTemplateBody.safeParse(req.body)");
    expect(src).not.toMatch(/req\.body as Partial<typeof structuredReportTemplatesTable/);
  });

  it("POST requires templateName, modality, and bodyPart", () => {
    const result = PostTemplateBody.safeParse({});
    expect(result.success).toBe(false);
    expect(PostTemplateBody.safeParse({
      templateName: "MRI Knee",
      modality: "MRI",
      bodyPart: "KNEE",
    }).success).toBe(true);
  });

  it("PATCH rejects schemaVersion outside 1–2 and invalid previousVersions JSON", () => {
    expect(PatchTemplateBody.safeParse({ schemaVersion: 3 }).success).toBe(false);
    expect(PatchTemplateBody.safeParse({ previousVersions: "not-json" }).success).toBe(false);
    expect(PatchTemplateBody.safeParse({
      schemaVersion: 2,
      formatVersion: 3,
      previousVersions: "[]",
      isDefault: true,
    }).success).toBe(true);
  });
});
