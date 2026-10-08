/**
 * No money row in this app may be labelled with its own database row id.
 *
 * A bill has two names: the number printed on the paper (`BILL-2026-00412`) and the
 * integer Postgres gave the row (`4127`). Every screen that rendered the second one
 * as text was unreadable — and the refund rows were the worst, because a cashier
 * reconciling a drawer cannot look 4127 up without opening the bill they are trying
 * to find.
 *
 * This started as one complaint about My Activity Log and became a rule, because the
 * same defect was found on eight screens: Dashboard control logs, the Daily Summary
 * report, My Daily Summary's payments list and its suspense bucket, the post-closure
 * alert, Banking's fraud alerts and refund requests, and the online-booking
 * confirmation toast. A defect that recurs on eight screens recurs by default, so it
 * needs a ratchet rather than eight fixes.
 *
 * The guard has to be *local*. An earlier version only asked "does this file mention
 * `p.billNumber` anywhere", which excused a regression in the payments box because
 * the suspense box in the same file read the number — and it failed Accounting.tsx,
 * whose guard is a correct ternary spread over four lines. So: the row's own
 * `billNumber` must be on the same line, or be the condition of the ternary on one of
 * the three lines above.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "..");

/** `#{…}` (JSX interpolation) or `#${…}` (template literal) — the two label shapes. */
const INTERPOLATION_RE = /#\{([^{}]*)\}|#\$\{([^{}]*)\}/g;

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) tsxFiles(full, out);
    else if (entry.endsWith(".tsx") && !entry.includes(".test.")) out.push(full);
  }
  return out;
}

function escapeForRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The rendered labels that use a row id where that row's own bill number should be. */
export function unguardedBillIdLabels(src: string): string[] {
  const lines = src.split(/\r?\n/);
  const offenders: string[] = [];
  lines.forEach((line, i) => {
    for (const match of line.matchAll(INTERPOLATION_RE)) {
      const path = (match[1] ?? match[2] ?? "").trim();
      if (!/\bbillId\b/.test(path)) continue;
      const row = path.split(".")[0];
      if (!row) continue;
      const readsOwnNumber = new RegExp(
        `\\b${escapeForRegex(row)}\\.billNumber\\s*(?:\\?|\\|\\||\\?\\?)`,
      );
      if (readsOwnNumber.test(line)) continue;
      // A guard on a line above is only believed when it is the `?` of a ternary —
      // `{row.billNumber ? … : …Bill#{row.billId}…}`, which Accounting.tsx breaks
      // across lines. Letting `||` on a neighbouring line count as a guard excused a
      // real regression: dropping the label while leaving the enclosing condition.
      const window = lines.slice(Math.max(0, i - 3), i).join("\n");
      const ternaryGuard = new RegExp(`\\b${escapeForRegex(row)}\\.billNumber\\s{0,80}\\?`);
      if (ternaryGuard.test(window)) continue;
      offenders.push(`line ${i + 1}: ${match[0]}`);
    }
  });
  return offenders;
}

describe("the scanner — it sees the defect and passes the fix", () => {
  // Positive controls. Without them, "zero offenders across the tree" is equally
  // satisfied by a scanner that matches nothing.
  it("flags verbatim what the eight screens used to render", () => {
    expect(unguardedBillIdLabels('<Link>Bill #{r.billId}</Link>')).toEqual(["line 1: #{r.billId}"]);
    expect(unguardedBillIdLabels('<span className="block">Bill #{p.billId}</span>')).toHaveLength(1);
    expect(unguardedBillIdLabels("<TableCell>{`#${r.billId}`}</TableCell>")).toHaveLength(1);
    expect(unguardedBillIdLabels("`Bill #${res.billId} created and tokens issued.`")).toHaveLength(1);
  });

  it("accepts every guard form the codebase actually uses", () => {
    expect(unguardedBillIdLabels("{r.billNumber || `#${r.billId}`}")).toEqual([]);
    expect(unguardedBillIdLabels("{p.billNumber || `Bill #${p.billId}`}")).toEqual([]);
    expect(
      unguardedBillIdLabels(
        [
          "{v.billNumber",
          "  ? <a title='open'>{v.billNumber}</a>",
          "  : v.billId",
          "    ? <span>Bill#{v.billId}</span>",
          "    : null}",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("does not mistake a link target for a label", () => {
    // /billing/4127 is how the row is addressed; only rendered text is the defect.
    expect(unguardedBillIdLabels('<Link href={`/billing/${r.billId}`}>{r.patientName}</Link>')).toEqual([]);
  });

  it("refuses to excuse a row id because the same variable is guarded elsewhere", () => {
    // The whole point of the local rule: one guarded list in a file must not license
    // an unguarded one in the same file.
    const fileLike = [
      "<div>",
      "  {z.map((p) => <td>{p.billNumber}</td>)}",
      "  {rows.map((p) => <td>Bill #{p.billId}</td>)}",
      "</div>",
    ].join("\n");
    expect(unguardedBillIdLabels(fileLike)).toEqual(["line 3: #{p.billId}"]);
  });
});

describe("the whole ERP", () => {
  const files = tsxFiles(SRC);

  it("walks the screens, not an empty glob", () => {
    expect(files.length).toBeGreaterThan(400);
    const names = files.map((f) => f.split(/[\\/]/).pop());
    for (const screen of [
      "Dashboard.tsx",
      "DailySummary.tsx",
      "Banking.tsx",
      "MyDailySummary.tsx",
      "PostClosureLoudAlert.tsx",
      "RefundActivityTable.tsx",
      "OnlineBookings.tsx",
      "Accounting.tsx",
    ]) {
      expect(names, `${screen} must be inside the scanned tree`).toContain(screen);
    }
  });

  it("renders no bill row id where its own row number could have gone", () => {
    const hits: string[] = [];
    for (const file of files) {
      const offenders = unguardedBillIdLabels(readFileSync(file, "utf8"));
      if (offenders.length > 0) hits.push(`${file.replace(SRC, "")} ${offenders.join(", ")}`);
    }
    expect(hits).toEqual([]);
  });
});

describe("the screens this change fixed keep reading their payload", () => {
  const read = (rel: string) => readFileSync(resolve(SRC, rel), "utf8");

  it("each mounts a bill number, not a row id", () => {
    expect(read("components/RefundActivityTable.tsx")).toMatch(/r\.billNumber \|\|/);
    expect(read("components/PostClosureLoudAlert.tsx")).toMatch(/p\.billNumber \|\|/);
    expect(read("pages/Dashboard.tsx")).toContain("<RefundActivityTable");
    expect(read("pages/DailySummary.tsx")).toMatch(/r\.billNumber \|\| `#\$\{r\.billId\}`/);
    expect(read("pages/Banking.tsx")).toMatch(/a\.billNumber \|\|/);
    expect(read("pages/MyDailySummary.tsx")).toMatch(/p\.billNumber \|\| `#\$\{p\.billId\}`/);
    expect(read("pages/OnlineBookings.tsx")).toMatch(/res\.billNumber \|\|/);
  });

  it("the Daily Summary refund table no longer heads its column 'Bill ID'", () => {
    const src = read("pages/DailySummary.tsx");
    expect(src).not.toContain(">Bill ID<");
    expect(src).toContain(">Referral doctor<");
    expect(src).toContain("no reason recorded");
  });
});
