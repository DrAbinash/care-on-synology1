/**
 * How the radiology worklist opens its live-refresh stream.
 *
 * Source-contract assertions, because the ERP has no component-test runtime
 * (no @testing-library anywhere in the workspace) and the defect was in how the
 * page builds one URL: `BASE_URL` ("/erp/" in production) concatenated with
 * "api/…" produced /erp/api/radiology/pacs-worklist-stream, which matches the
 * nginx SPA location and is answered by index.html — the SSE handler was never
 * reached. What the page then does with the stream is exercised for real in
 * lib/authedEventStream.test.ts (the client) and
 * routes/pacsWorklistStream.request.test.ts (the route over HTTP).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "RadiologyWorklist.tsx"),
  "utf8",
);

const STREAM_PATH = "/api/radiology/pacs-worklist-stream";

describe("radiology worklist live-refresh wiring", () => {
  it("opens the stream at the API path the router actually serves", () => {
    expect(pageSource).toContain(`"${STREAM_PATH}"`);
    expect(pageSource).toContain("openAuthedEventStream");
  });

  it("never builds the stream URL from the SPA base", () => {
    // The old construction was `${base}api/…` with base = import.meta.env.BASE_URL.
    expect(pageSource).not.toContain("BASE_URL");
    expect(pageSource).not.toContain("}api/");
  });

  it("keeps the session token out of the stream URL", () => {
    expect(pageSource).not.toMatch(/staffToken\s*=/);
    expect(pageSource).not.toContain("getStaffToken");
    expect(pageSource).not.toMatch(/new EventSource\(/);
  });

  it("still closes the stream on unmount", () => {
    expect(pageSource).toMatch(/return\s*\(\)\s*=>\s*\{[^}]*\.close\(\)/);
  });

  it("keeps the 30-second poll the stream falls back to", () => {
    expect(pageSource).toContain("refetchInterval: 30_000");
  });
});
