/**
 * Scan Station's Report Delivery modes — structural guarantees.
 *
 * These are source contracts, not greps for strings the owner happens to like.
 * Each one states an invariant whose violation is a real clinic failure, and each
 * is written so a comment inserted above the code cannot empty the slice and turn
 * the assertion decorative: they count occurrences and capture named regions, and
 * they fail loudly if their own anchor is missing.
 *
 * The suite runs in a node environment with no DOM, so the page cannot be mounted
 * here. That is exactly why the invariants worth pinning are the ones a render would
 * never reveal on its own — one capture hook, no countdown inside the counter modes,
 * and exactly one click that writes.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

const station = read("src/pages/ScanStation.tsx");
const receive = read("src/components/ReportReceiveBatch.tsx");
const deliver = read("src/components/ReportDeliverBatch.tsx");
const serverReceive = read("../api-server/src/lib/reportCustodyReceive.ts");
const serverDeliver = read("../api-server/src/lib/reportCustodyDeliver.ts");

/** The two counter lists, under the invariants they must both hold. */
const counters: Array<[string, string]> = [
  ["receive list", receive],
  ["deliver list", deliver],
];

const count = (src: string, re: RegExp) => (src.match(re) || []).length;

/**
 * Source with the comments removed.
 *
 * Without this, the guards below would fail on their own documentation: this file
 * explains that the counter lists have no countdown, so a naive
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

  it.each(counters)("%s installs no listener and no capture hook of its own", (_name, src) => {
    const code = codeOnly(src);
    expect(count(code, /addEventListener\(/g)).toBe(0);
    expect(code).not.toMatch(/useGlobalScanner/);
    expect(code).not.toMatch(/onKeyDown/);
  });

  it("the receive list has no scanner field of its own", () => {
    // What this guards is a second capture target: a field in the component that
    // starts a scan would compete with the page's hidden input, and which half of
    // the batch arrived would then depend on where the cursor was.
    //
    // The receive list does have `onChange` handlers — the tick and the Word
    // report's signer name — and both are form state, not scanning. So the guard
    // names the two it allows and checks what each does, instead of counting zero
    // of a thing that legitimately had to exist.
    const code = codeOnly(receive);
    const handlers = [...code.matchAll(/onChange=\{([^}]*)\}/g)].map((m) => m[1]!);
    expect(handlers.length, "the receive list's change handlers were not found — anchor stale").toBe(2);
    for (const handler of handlers) {
      expect(handler, "a change handler must never start a scan").not.toMatch(/runScan|\.scan\(|submitCode/);
    }
    expect(code).not.toMatch(/<input[^>]*value=/);   // no controlled text field fed to the scanner
    // The deliver list does have form fields — recipient and override reason — and
    // none of them may become a second scanner target.
    expect(count(deliver, /<Input/g)).toBeLessThanOrEqual(3);
    expect(deliver).not.toMatch(/autoFocus/);
  });

  it("every code — scanned or typed — goes through one entry point", () => {
    // Both the hidden scanner input and the manual field must reach the same
    // decision, or switching modes would change what a scan means per input box.
    expect(count(station, /submitCode\(/g)).toBe(3); // hidden Enter, manual Enter, Lookup/Add
    expect(station).toMatch(/const submitCode = useCallback\(/);
    expect(station).toMatch(
      /const counter = mode === "receive" \? receiveRef\.current : mode === "deliver" \? deliverRef\.current : null;/,
    );
    expect(station).toMatch(/if \(counter\) \{\s*counter\.scan\(code\);/);
  });

  it("neither counter mode can reach the sample and kiosk lookups", () => {
    // `mode !== "samples"` rather than a list of the two: a counter mode added
    // later must be excluded by default, not remembered.
    expect(station).toMatch(
      /const lookupBarcode = useCallback\(async \(barcode: string\)[\s\S]{0,400}if \(mode !== "samples"\) return;/,
    );
  });

  it("each counter mode renders only its own component", () => {
    expect(station).toMatch(
      /mode === "receive" \? \(\s*<ReportReceiveBatch ref=\{receiveRef\} \/>\s*\) : mode === "deliver" \? \(\s*<ReportDeliverBatch ref=\{deliverRef\} \/>/,
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

  it.each(counters)("%s holds no countdown, no timer and no auto-clear", (_name, src) => {
    const code = codeOnly(src);
    expect(code).not.toMatch(/countdown/i);
    // The only deferred call is refocusing the scanner input, which lives in the page.
    expect(count(code, /setTimeout|setInterval/)).toBe(0);
  });
});

describe("the counter modes are permission-gated, each on its own grant", () => {
  it("receive and handover read separate sub-permissions", () => {
    expect(station).toMatch(/const mayReceiveReports = hasSubPermission\(session, "\/report-delivery", "receive"\);/);
    expect(station).toMatch(/const mayHandOverReports = hasSubPermission\(session, "\/report-delivery", "handover"\);/);
  });

  it("each button is gated on its own grant, not on the pair", () => {
    // A clerk who may receive but not release must not be handed a mode whose
    // confirm would 403 — and the reverse holds too.
    expect(station).toMatch(/const mayWorkCounter = mayReceiveReports \|\| mayHandOverReports;/);
    expect(station).toMatch(/\{mayWorkCounter && \(/);
    expect(count(station, /\{mayReceiveReports && \(/g)).toBe(1);
    expect(count(station, /\{mayHandOverReports && \(/g)).toBe(1);
  });

  it("defaults to the laboratory page everyone already uses", () => {
    // A default of "receive" or "deliver" would change what every Scan Station in
    // the clinic does on the next deploy.
    expect(station).toMatch(/useState<StationMode>\("samples"\)/);
  });
});

describe("scanning never writes, in either direction", () => {
  it("the deliver list calls exactly the three endpoints it is meant to", () => {
    // Two reads and one write. A fourth call, or a second call to the write, would
    // be an act the clerk never confirmed. `api.post<T>(` is the real spelling, so
    // the pattern has to allow the generic — otherwise this counts zero and passes
    // by accident.
    expect(count(deliver, /api\.post[<(]/g)).toBe(3);
    expect(count(deliver, /"\/api\/report-custody\/handover"/g)).toBe(1);
    expect(count(deliver, /"\/api\/report-custody\/bill"/g)).toBe(1);
    expect(count(deliver, /"\/api\/report-custody\/handover\/scan"/g)).toBe(1);
  });

  it("the write is inside confirm, not inside a scan", () => {
    const confirmRegion = deliver.match(/const confirm = async \(\) => \{[\s\S]*?\n    \};/);
    expect(confirmRegion, "confirm() was not found — anchor stale, not the code safe").toBeTruthy();
    expect(confirmRegion![0]).toMatch(/\/api\/report-custody\/handover"/);
    const scanRegion = deliver.match(/const runScan = useCallback[\s\S]*?\n    \}, \[/);
    expect(scanRegion, "runScan() was not found — anchor stale").toBeTruthy();
    expect(scanRegion![0]).not.toMatch(/\/handover"/);
  });

  it("a retried click reuses one request id, so the same paper cannot go twice", () => {
    for (const [, code] of counters) {
      expect(code).toMatch(/if \(!requestIdRef\.current\) requestIdRef\.current = newKey\(\);/);
      expect(code).toMatch(/requestId: requestIdRef\.current,/);
    }
  });

  it("a bill scan ticks nothing, in either direction", () => {
    // The owner's two requirements, stated as data: "do not mark all reports
    // delivered simply because the bill QR was scanned", and "allow staff to select
    // which physically signed reports have reached the counter". A bill says who is
    // at the desk; only a person says which sheets are in their hand.
    const receiveBill = /const addExaminations = useCallback\([\s\S]*?\n    \}, \[\]\);/.exec(receive);
    expect(receiveBill, "addExaminations() not found — anchor stale, not the code safe").toBeTruthy();
    expect(receiveBill![0]).toMatch(/include: false/);
    expect(receiveBill![0]).not.toMatch(/include: [^,}\n]*[vV]erdict/);

    const openBill = /const openBill = useCallback\([\s\S]*?\n    \}, \[readBill\]\);/.exec(deliver);
    expect(openBill, "openBill() not found — anchor stale, not the code safe").toBeTruthy();
    expect(openBill![0]).toMatch(/include: false/);
    expect(openBill![0]).not.toMatch(/include: [^,}\n]*[vV]erdict/);

    // This second assertion is what makes the two above falsifiable. Without it, a
    // pattern as loose as `include: false` would still pass on
    // `include: c.handoverVerdict === "DELIVERABLE"` — because the wrong spelling
    // contains the right one as a substring.
    for (const [name, region] of [["receive", receiveBill], ["deliver", openBill]] as const) {
      expect(region![0], `${name}: a bill row must not be ticked by its verdict`)
        .not.toMatch(/include:\s*[\w.]+(\.candidate)?\.?\w*[vV]erdict/);
      expect(region![0], `${name}: the tick is a literal, not a computation`)
        .toMatch(/include:\s*false/);
    }
  });

  it("each confirmation can name a Word paper by its examination", () => {
    // A Word-typed report has no `patient_reports` row, so the confirmation has to
    // be able to say "this examination" instead of "this report id". If either desk
    // silently dropped that branch, the clinic's majority of paper would stop being
    // accountable and the tests would not notice, because they would still send ids.
    for (const [name, src] of counters) {
      const region = src.match(/const confirm = async \(\) => \{[\s\S]*?\n    \};/);
      expect(region, `${name}: confirm() not found — anchor stale`).toBeTruthy();
      expect(region![0]).toMatch(/reportId != null/);
      expect(region![0]).toMatch(/orderTestId/);
    }
  });

  it("a Word report cannot be confirmed out of a batch without naming its signer", () => {
    // This is a required-field check on the form, not the clinical gate — the server
    // answers `WORD_REPORT_NOT_REGISTERED` either way (proven at request level). It
    // is pinned here because a clerk who ticked three sheets and got two receipts
    // would have no way to see what was missing.
    expect(receive).toMatch(/const canConfirm = selected\.length > 0 && missingSigner === 0;/);
    const region = /const confirm = async \(\) => \{[\s\S]*?\n    \};/.exec(receive);
    expect(region, "confirm() not found — anchor stale").toBeTruthy();
    expect(region![0]).toMatch(/if \(!canConfirm\) return;/);
    expect(region![0]).toMatch(/paperSignedByName: it\.paperSignedByName\.trim\(\) \|\| null,/);
  });

  it("neither confirmation sends a staff name", () => {
    // The actor comes from the session, so the thing to pin on the client is that no
    // write payload offers one — a `actorName` in a body would let a clerk
    // acknowledge paper on a colleague's account, and the ledger could not tell.
    // (Reading the SERVER's `alreadyReceived.actorName` back is fine and wanted.)
    for (const [name, src] of counters) {
      const region = src.match(/const confirm = async \(\) => \{[\s\S]*?\n    \};/);
      expect(region, `${name}: confirm() not found — anchor stale`).toBeTruthy();
      expect(region![0]).not.toMatch(/actorName|actorRole|actor:/);
    }
  });
});

describe("a refusal keeps the server's own words", () => {
  it("carries the server's sentence for an ambiguous bill", () => {
    // Two books can issue one bill number, and only the server can tell that apart
    // from "not a bill". A client that re-types the refusal is where a true,
    // actionable message becomes a generic one, so the branch must pass `err.message`
    // straight through — the same reason the receive list shows the server's text.
    const branch = /if \(reason === "AMBIGUOUS_BILL"\) \{[\s\S]*?\}/.exec(deliver);
    expect(branch, "the ambiguous-bill branch was not found — anchor stale").toBeTruthy();
    expect(branch![0]).toMatch(/message: err\.message/);
  });
});

describe("the client's copy of each server rule is the same rule", () => {
  it("the batch cap is one number in three places", () => {
    const server = /export const RECEIVE_BATCH_LIMIT = (\d+)/.exec(serverReceive);
    const receiveCap = /export const RECEIVE_BATCH_LIMIT = (\d+)/.exec(receive);
    const deliverCap = /export const DELIVER_BATCH_LIMIT = (\d+)/.exec(deliver);
    expect(server, "server cap anchor stale").toBeTruthy();
    expect(receiveCap, "receive cap anchor stale").toBeTruthy();
    expect(deliverCap, "deliver cap anchor stale").toBeTruthy();
    expect(receiveCap![1]).toBe(server![1]);
    expect(deliverCap![1]).toBe(server![1]);
    expect(Number(server![1])).toBe(100);
  });

  it("the recipient categories offered are the ones the server accepts", () => {
    // The server answers anything outside its list with a 400, so a client that
    // invents or drops a category strands the clerk at the confirm button.
    const serverList = /export const RECIPIENT_CATEGORIES = \[([\s\S]*?)\] as const/.exec(serverDeliver);
    expect(serverList, "server recipient list anchor stale").toBeTruthy();
    const serverCats = [...serverList![1]!.matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]!);
    const clientCats = [...deliver.matchAll(/value: "([A-Z_]+)", label:/g)].map((m) => m[1]!);
    expect(serverCats).toEqual(["PATIENT", "FAMILY_MEMBER", "CARRYING_AGENT", "DOOR_DROP"]);
    expect(clientCats).toEqual(serverCats);
  });

  it("no counter component reads clinical text", () => {
    // The counter's data rule: identity and state, never content. A response that
    // carried the report body would be one render away from putting a diagnosis on
    // a delivery desk — and the server does not send it, so nothing here may ask.
    for (const [, code] of counters) {
      const bare = codeOnly(code);
      expect(bare).not.toMatch(/impression|findings|clinicalText|diagnosis/i);
      expect(bare).not.toMatch(/dangerouslySetInnerHTML/);
    }
  });
});
