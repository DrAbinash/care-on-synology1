import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Ensures the patient-communication AI draft endpoint cannot return
 * canned clinical interpretation (e.g. "findings are normal").
 */
describe("POST /patient-communications/:id/draft — disabled", () => {
  it("handler returns 501 and contains no canned clinical text", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.join(here, "aiReporting.ts"), "utf8");
    const start = src.indexOf('router.post("/patient-communications/:id/draft"');
    expect(start).toBeGreaterThan(0);
    const end = src.indexOf('router.patch("/patient-communications/:id"', start);
    expect(end).toBeGreaterThan(start);
    const handler = src.slice(start, end);
    expect(handler).toContain("patient_communication_ai_not_configured");
    expect(handler).toContain("501");
    expect(handler.toLowerCase()).not.toContain("overall findings are normal");
    expect(handler.toLowerCase()).not.toContain("no significant abnormalities");
    expect(handler).not.toContain("within 2 weeks");
    expect(handler).not.toMatch(/db\.update\([\s\S]*aiDraft/);
  });
});
