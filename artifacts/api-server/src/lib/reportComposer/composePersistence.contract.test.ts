/**
 * The server's copy of the workspace's report projection, pinned.
 *
 * `projectStoredImpression` is a mirror of `normalizeImpressionLines` in
 * `artifacts/diagnostic-erp/src/lib/workspaceReportState.ts`. Two packages, one
 * behaviour, no shared module (the SPA cannot be imported by the API), so the
 * agreement is asserted from a table of vectors that BOTH suites run: the same
 * twelve rows appear in
 * `artifacts/diagnostic-erp/src/lib/workspaceImpressionProjection.test.ts`.
 *
 * Why it matters: the durability proof compares the accepted AI sentence against
 * what the stored `impression` column projects to. If the server projected
 * differently from the editor, the token would describe a report nobody is
 * looking at, and an honest apply would be refused — or, worse, a stale one
 * accepted. The vectors below are the shapes that make that happen: outer padding
 * the display throws away, blank lines it keeps, an impression that merely looks
 * like a JSON array, CRLF, and the clinic's own punctuation.
 *
 * Each expectation is what the real route and the real reload were measured to
 * produce, not what the function was assumed to do.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  composeNarrativeToken,
  projectComposeNarrative,
  projectEditorNarrative,
  projectStoredImpression,
  EMPTY_REPORT_TOKEN,
  type ComposeDraftRow,
} from "./composePersistence";

/** One stored impression column (always written as a JSON array by /save-draft)
 *  and the text the radiologist's screen shows for it. */
const VECTORS: Array<{ name: string; stored: string; display: string }> = [
  { name: "plain", stored: "Mild disc bulge.", display: "Mild disc bulge." },
  { name: "multi-line", stored: "Line one.\nLine two.", display: "Line one.\nLine two." },
  { name: "outer blank lines dropped, inner kept", stored: "\nLine one.\n\nLine two.\n", display: "Line one.\n\nLine two." },
  { name: "only the element edges are trimmed", stored: "  Line one.  \n  Line two.  ", display: "Line one.  \n  Line two." },
  { name: "whitespace only becomes empty", stored: "   \n  ", display: "" },
  { name: "empty stays empty", stored: "", display: "" },
  { name: "text that looks like a JSON array survives whole", stored: '["Already","an","array"]', display: '["Already","an","array"]' },
  { name: "CRLF inside the element is preserved", stored: "Line one.\r\nLine two.", display: "Line one.\r\nLine two." },
  { name: "clinic punctuation", stored: "Findings · ₹500 — L4/5.", display: "Findings · ₹500 — L4/5." },
  { name: "trailing newline trimmed", stored: "Impression.\n", display: "Impression." },
];

function draft(over: Partial<ComposeDraftRow>): ComposeDraftRow {
  return {
    id: 1,
    studyId: 1,
    worklistId: 1,
    patientId: 1,
    rawFindings: null,
    impression: null,
    recommendation: null,
    status: "DRAFT",
    finalReportId: null,
    updatedAt: "2026-10-09T00:00:00.000Z",
    ...over,
  };
}

describe("Composer server-side report projection", () => {
  it.each(VECTORS)("projects the stored impression column to what the editor shows: $name", ({ stored, display }) => {
    const column = JSON.stringify([stored]);
    expect(projectStoredImpression(column)).toBe(display);
    expect(projectComposeNarrative(draft({ impression: column })).impression).toBe(display);
  });

  it("the editor-side projection of the same text agrees with the stored one", () => {
    // The apply sends what the editor holds; the row holds what was written from
    // it. Both must land on the same string, or a padding difference would look
    // like a concurrent edit.
    for (const { stored } of VECTORS) {
      const fromRow = projectStoredImpression(JSON.stringify([stored]));
      const fromEditor = projectEditorNarrative({ findings: "", impression: stored, recommendation: "" }).impression;
      expect(fromEditor).toBe(fromRow);
    }
  });

  it("findings and recommendation are taken verbatim, padding and all", () => {
    // Measured against POST /save-draft: leading blank lines and an interior tab
    // come back byte-identical, so the token must see a change in them.
    const padded = draft({ rawFindings: "\n\n  Bulge L4-L5.\n\tFacet.\n\n", recommendation: "  Physio.  \n" });
    const plain = draft({ rawFindings: "Bulge L4-L5.\nFacet.", recommendation: "Physio." });
    expect(projectComposeNarrative(padded).findings).toBe("\n\n  Bulge L4-L5.\n\tFacet.\n\n");
    expect(composeNarrativeToken(projectComposeNarrative(padded)))
      .not.toBe(composeNarrativeToken(projectComposeNarrative(plain)));
  });

  it("an absent draft row has a defined token, and it is not the empty string", () => {
    expect(EMPTY_REPORT_TOKEN).toHaveLength(32);
    expect(EMPTY_REPORT_TOKEN).not.toBe("");
    // A study whose report is genuinely empty and a job that never captured a
    // baseline must be distinguishable — the first is a state, the second is
    // missing evidence.
    expect(composeNarrativeToken(projectComposeNarrative(null))).toBe(EMPTY_REPORT_TOKEN);
    expect(composeNarrativeToken(projectComposeNarrative(draft({ rawFindings: "" })))).toBe(EMPTY_REPORT_TOKEN);
    expect(composeNarrativeToken(projectComposeNarrative(draft({ rawFindings: " " })))).not.toBe(EMPTY_REPORT_TOKEN);
  });

  it("the token is stable for identical content and moves for one character", () => {
    const a = composeNarrativeToken(projectComposeNarrative(draft({ rawFindings: "A.", impression: '["B."]' })));
    const b = composeNarrativeToken(projectComposeNarrative(draft({ rawFindings: "A.", impression: '["B."]' })));
    const c = composeNarrativeToken(projectComposeNarrative(draft({ rawFindings: "A. ", impression: '["B."]' })));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("field boundaries cannot be forged by shifting text between fields", () => {
    // Without a separator, {findings:"AB", impression:""} and
    // {findings:"A", impression:"B"} would collide, and a client could move an
    // accepted sentence across a field boundary and still "match".
    const one = composeNarrativeToken({ findings: "AB", impression: "", recommendation: "" });
    const two = composeNarrativeToken({ findings: "A", impression: "B", recommendation: "" });
    expect(one).not.toBe(two);
  });

  it("reads the stored row exactly as GET /drafts returns it", () => {
    // The route is a full-row select with no projection, so a token computed from
    // its JSON must equal the token computed from a direct read. That is what
    // lets the browser hold a server-issued value at all.
    const routeShape = draft({ rawFindings: "Bulge.", impression: JSON.stringify(["Bulge."]), recommendation: "Physio." });
    expect(projectComposeNarrative(routeShape)).toEqual({
      findings: "Bulge.",
      impression: "Bulge.",
      recommendation: "Physio.",
    });
  });
});

describe("Composer persistence evidence stays on this machine", () => {
  const source = readFileSync(join(__dirname, "composePersistence.ts"), "utf8");

  it("imports no AI provider, no network client and no PHI egress", () => {
    // §7 case 20: the baseline is read from Postgres and hashed in-process. A
    // report text must never leave through this path.
    expect(source).not.toMatch(/ai-providers|ollama|fetch\(|axios|https?:\/\//);
    for (const line of source.split(/\r?\n/)) {
      if (!/^import\b/.test(line.trim()) && !/^\s+from "|^import\s*\{/.test(line)) continue;
      expect(line).not.toMatch(/node:https|node:http|undici|google-cloud|openai/);
    }
  });

  it("touches only the composer job and the draft row", () => {
    const tables = [...source.matchAll(/FROM\s+([a-z_]+)|UPDATE\s+([a-z_]+)|INTO\s+([a-z_]+)/g)]
      .map((m) => m[1] ?? m[2] ?? m[3])
      .filter((t): t is string => Boolean(t));
    expect([...new Set(tables)].sort()).toEqual(["ai_report_compose_jobs", "radiology_report_drafts"]);
  });

  it("never writes a clinical column", () => {
    // The server records evidence; the editor writes reports. If this file ever
    // gained a write to a narrative column it would be a second authoring surface,
    // which is exactly what #884 and #885 removed.
    expect(source).not.toMatch(/SET\s+(raw_findings|impression|recommendation)\s*=/);
    expect(source).not.toMatch(/INSERT INTO radiology_report_drafts/);
  });
});
