import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("orthancChangesPoller USG ERP pipeline gate", () => {
  const src = readFileSync(new URL("./orthancChangesPoller.ts", import.meta.url), "utf8");

  test("skips US ingest and SR fetch when the ERP pipeline is paused", () => {
    expect(src).toContain("isUsgErpPipelineEnabled");
    expect(src).toContain("USG ERP pipeline paused — skip intake");
    const ingest = src.slice(src.indexOf("async function ingestStudy"), src.indexOf("async function pollOnce"));
    const skipIdx = ingest.indexOf("isUsgErpPipelineEnabled");
    const srIdx = ingest.indexOf("fetchSrMetadata");
    expect(skipIdx).toBeGreaterThan(0);
    expect(srIdx).toBeGreaterThan(skipIdx);
  });
});
