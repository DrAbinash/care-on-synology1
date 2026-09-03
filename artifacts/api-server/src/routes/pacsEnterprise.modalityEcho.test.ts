import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function modalityEchoBlock(src: string): string {
  const start = src.indexOf('router.post("/modalities/:id/echo-test"');
  const end = src.indexOf('// POST /api/radiology/test-modality');
  if (start < 0 || end < 0 || end <= start) return "";
  return src.slice(start, end);
}

describe("pacsEnterprise modality echo route", () => {
  test("uses canonical DIMSE test path and requires called AE", () => {
    const src = readFileSync(path.join(__dirname, "pacsEnterprise.ts"), "utf8");
    const block = modalityEchoBlock(src);
    expect(block).toContain("testNodeConnection({");
    expect(block).toContain("No Called AE title configured for this modality");
    expect(block).toContain('testType: "DICOM_C_ECHO" | "TCP_FALLBACK"');
  });

  test("does not shell to echoscu in modality route", () => {
    const src = readFileSync(path.join(__dirname, "pacsEnterprise.ts"), "utf8");
    const block = modalityEchoBlock(src);
    expect(block).not.toContain("echoscu -aec");
    expect(block).not.toContain('-aet "DIAGNOCENTER"');
  });
});

