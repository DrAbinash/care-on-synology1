import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("UsgAdminSettings ERP pipeline switch", () => {
  const src = readFileSync(new URL("./UsgAdminSettings.tsx", import.meta.url), "utf8");

  test("settings form includes pipelineEnabled and does not tell staff to stop C-STORE", () => {
    expect(src).toContain("pipelineEnabled: boolean");
    expect(src).toContain("pipelineEnabled: true");
    expect(src).toContain("toggle(\"pipelineEnabled\")");
    expect(src).toContain("do not stop C-STORE on the scanner");
    expect(src).toContain("Recabling switches is optional");
  });
});
