import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ScheduledStationAETitle (0040,0001) is matched byte for byte by the scanner's C-FIND:
// forcing one case made this clinic's CT station (measured AE "ct99") un-enterable —
// with the uppercaser in place, Chromium put "CT99" in the POST body.
const here = path.dirname(fileURLToPath(import.meta.url));
const pageSrc = readFileSync(
  path.join(here, "..", "pages", "ModalityManagement.tsx"),
  "utf8",
).replace(/\r\n/g, "\n");

function stationAeField(): string {
  const start = pageSrc.indexOf('label className="text-xs font-medium">Station AE Title');
  expect(start, "Station AE Title field is missing from the modality form").toBeGreaterThan(-1);
  return pageSrc.slice(start, pageSrc.indexOf("/>", start));
}

describe("Station AE Title field preserves the case it is typed with", () => {
  it("stores the typed value verbatim", () => {
    const field = stationAeField();
    expect(field).toContain('onChange={(e) => set("aeTitle", e.target.value)}');
    expect(field).not.toMatch(/aeTitle[^\n]*toUpperCase/);
  });

  it("sends that value to the API without re-casing it", () => {
    expect(pageSrc).toContain('aeTitle: data.aeTitle?.trim() || null');
  });
});
