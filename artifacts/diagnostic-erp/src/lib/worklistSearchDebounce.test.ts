/**
 * worklistSearchDebounce.test.ts — the worklist search must not mint one API
 * request (and one Orthanc C-FIND) per keystroke.
 *
 * Measured live during the audit (F-07): typing "SHANTI" into the worklist
 * search fired six sequential GETs (search=S, SH, SHA, SHAN, SHANT, SHANTI),
 * each with orthanc=1 — so every keystroke also triggered a PACS C-FIND on the
 * server, against a React Query with staleTime 0 and gcTime 0 that treated each
 * prefix as a brand-new key. The Report Hub already debounced the same pattern
 * at 300 ms; the worklist had not.
 *
 * Source pin in the repo's no-DOM idiom (see quickSelectLaterality.contract.test.ts):
 * the contract is that the QUERY is keyed on a debounced value while the input
 * shows the live keystrokes. What this cannot catch: a future second search box
 * wired straight into the query key.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = resolve(HERE, "../..");
const read = (rel: string) => readFileSync(resolve(PKG_DIR, rel), "utf8");

const PAGE = "src/pages/RadiologyWorklist.tsx";
const page = read(PAGE).replace(/\r\n/g, "\n");

describe("the worklist search is debounced before it reaches the query", () => {
  it("keeps a live input state separate from the query-keyed search state", () => {
    expect(page).toMatch(/const \[searchInput, setSearchInput\] = useState/);
    expect(page).toMatch(/const \[search, setSearch\] = useState/);
  });

  it("debounces the input into the query state at 300 ms", () => {
    // Same idiom as the Report Hub's search debounce.
    expect(page).toMatch(
      /useEffect\(\(\) => \{\s*const t = setTimeout\(\(\) => setSearch\(searchInput\.trim\(\)\), 300\);\s*return \(\) => clearTimeout\(t\);\s*\}, \[searchInput\]\);/,
    );
  });

  it("binds the input box to the live state, never straight to the query state", () => {
    expect(page).toMatch(/value=\{searchInput\}/);
    expect(page).toMatch(/onChange=\{\(e\) => setSearchInput\(e\.target\.value\)\}/);
    // The per-keystroke query write is the defect; any reappearance of it fails.
    expect(page).not.toMatch(/onChange=\{\(e\) => setSearch\(e\.target\.value\)\}/);
  });

  it("still seeds both states from the ?q deep link so the first fetch includes it", () => {
    expect(page.match(/new URLSearchParams\(window\.location\.search\)\.get\("q"\)/g)?.length)
      .toBeGreaterThanOrEqual(2);
  });

  it("Clear resets the input immediately, not one debounce later", () => {
    // Both Clear paths (toolbar Clear and the empty-state Clear All Filters)
    // must clear the visible box AND the query state in the same click.
    expect(page.match(/setSearch\(""\); setSearchInput\(""\);/g)?.length).toBe(2);
  });
});
