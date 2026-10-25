/**
 * Scan Station's Report Delivery mode — structural guarantees.
 *
 * These are source contracts, not greps for strings the owner happens to like.
 * Each one states an invariant whose violation is a real clinic failure, and each
 * is written so a comment inserted above the code cannot empty the slice and turn
 * the assertion decorative: they count occurrences and capture named regions, and
 * they fail loudly if their own anchor is missing.
 *
 * The suite runs in a node environment with no DOM, so the page cannot be mounted
 * here. That is exactly why the two invariants worth pinning are the ones a render
 * would never reveal on its own — one capture hook, and no countdown in the
 * delivery modes.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

const station = read("src/pages/ScanStation.tsx");
const batch = read("src/components/ReportReceiveBatch.tsx");
const serverLimits = read("../api-server/src/lib/reportCustodyReceive.ts");

const count = (src: string, re: RegExp) => (src.match(re) || []).length;

/**
 * Source with the comments removed.
 *
 * Without this, the guards below would fail on their own documentation: this file
 * explains that the receive list has no countdown, so a naive
 * `not.toMatch(/countdown/)` over the raw file refuses to let the reason be
 * written down — and the next person's fix is to delete the comment, which is the
 * opposite of what the guard is for.
 */
const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("one scanner, not two", () => {
  it("Scan Station keeps exactly one global keydown listener", () => {
    // The owner's rule: do not introduce another competing keyboard listener.
    // A second one splits every scan between two handlers, and the failure is
    // intermittent because it depends on which element holds focus.
    expect(count(station, /addEventListener\("keydown"/g)).toBe(1);
  });

  it("the receive component installs no listener and no capture hook of its own", () => {
    const code = codeOnly(batch);
    expect(count(code, /addEventListener\(/g)).toBe(0);
    expect(code).not.toMatch(/useGlobalScanner/);
    expect(code).not.toMatch(/onKeyDown|onChange=\{/);
  });

  it("every code — scanned or typed — goes through one entry point", () => {
    // Both the hidden scanner input and the manual field must reach the same
    // decision, or switching modes would change what a scan means per input box.
    expect(count(station, /submitCode\(/g)).toBe(3); // hidden Enter, manual Enter, Lookup/Add
    expect(station).toMatch(/const submitCode = useCallback\(/);
    expect(station).toMatch(/if \(mode === "receive"\) \{\s*receiveRef\.current\?\.scan\(code\);/);
  });

  it("receive mode cannot reach the sample and kiosk lookups", () => {
    expect(station).toMatch(
      /const lookupBarcode = useCallback\(async \(barcode: string\)[\s\S]{0,400}if \(mode === "receive"\) return;/,
    );
  });
});

describe("the kiosk behaviour stops inside the delivery modes", () => {
  it("auto-clear is gated on samples mode, not only on the clinic setting", () => {
    // A kiosk that wipes the screen 10 seconds after the first scan would throw
    // away a 40-report batch. The countdown effect must read the derived flag.
    expect(station).toMatch(/const countdownActive = autoClearEnabled && mode === "samples";/);
    const effect = station.match(
      /if \(countdown !== null[\s\S]*?\}, \[([^\]]*)\]\);/,
    );
    expect(effect, "the countdown effect was not found — anchor stale, not the code safe").toBeTruthy();
    expect(effect![0]).toContain("countdownActive");
    expect(effect![1]).toContain("countdownActive");
    // And the old spelling is gone from the effect, not merely added to.
    expect(effect![1]).not.toMatch(/\bautoClearEnabled\b/);
  });

  it("the receive list holds no countdown, no timer and no auto-clear", () => {
    const code = codeOnly(batch);
    expect(code).not.toMatch(/countdown/i);
    // The only deferred call is refocusing the scanner input, which lives in the page.
    expect(count(code, /setTimeout|setInterval/)).toBe(0);
  });
});

describe("the counter mode is permission-gated", () => {
  it("the mode switch renders only for a session that may receive", () => {
    expect(station).toMatch(/const mayReceiveReports = hasSubPermission\(session, "\/report-delivery", "receive"\);/);
    expect(station).toMatch(/\{mayReceiveReports && \(/);
  });

  it("defaults to the laboratory page everyone already uses", () => {
    // A default of "receive" would change what every Scan Station in the clinic
    // does on the next deploy.
    expect(station).toMatch(/useState<StationMode>\("samples"\)/);
  });
});

describe("the batch cap is one number", () => {
  it("the client's cap and the server's cap are the same value", () => {
    const server = /export const RECEIVE_BATCH_LIMIT = (\d+)/.exec(serverLimits);
    const client = /export const RECEIVE_BATCH_LIMIT = (\d+)/.exec(batch);
    expect(server, "server cap anchor stale").toBeTruthy();
    expect(client, "client cap anchor stale").toBeTruthy();
    expect(client![1]).toBe(server![1]);
    expect(Number(server![1])).toBe(100);
  });
});
