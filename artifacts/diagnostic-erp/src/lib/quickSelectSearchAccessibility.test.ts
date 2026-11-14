/**
 * Audit item 21 — the Quick Select filter is visible, and the keyboard path into
 * and out of it lands on controls that exist.
 *
 * Two defects lived in one header row of `quick-select-strip.tsx` (baseline
 * `ba207aa62`):
 *
 *   1. `const [showSearch, setShowSearch] = useState(false)` (:211) and
 *      `{showSearch ? (<input …/>) : (<Button onClick={() => setShowSearch(true)} …/>)}`
 *      (:521-555). The filter was not on the page. A radiologist scanning a
 *      findings wall of 56 near-identical sentences had to notice and click a
 *      20px ghost icon before type-to-filter existed at all — and that click
 *      unmounted the add/edit door in the same row (`qs-edit-${field}` lived
 *      only in the `else` branch), so opening the filter closed something else.
 *   2. Escape in that input ran `setShowSearch(false)` (:528) while `search`
 *      kept its value: the box vanished, the rail stayed filtered to the term,
 *      and the strip read as broken with no visible way back.
 *
 * The third was a keybinding with no destination. Phase 3's roving-focus model
 * sends Escape out of the tile rail (`quickSelectKeyboardNavigation.ts`:
 * "Escape — leave the tile rail (back to the search field)"), and the strip
 * implements that by querying `input[aria-label='Quick select search']`
 * (now :395). No element in the repo carried that accessible name at baseline,
 * so the query returned null: focus stayed on the tile and the documented exit
 * was a no-op. The label is what this test cross-checks, by reading the
 * selector out of the handler rather than repeating the string.
 *
 * There is no DOM harness in this repo (`environment: "node"` repo-wide), so the
 * wiring is pinned from source the way `quickSelectStripStructuredRouting.test.ts`
 * pins it: comments stripped first (a prose mention of `showSearch` must not
 * count as code), slices bounded by the component's own markers rather than a
 * character budget, and CRLF normalised on read.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(HERE, rel), "utf8").replace(/\r\n/g, "\n");
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}
const STRIP = "../components/radiology/zai-workspace/quick-select-strip.tsx";
const strip = () => codeOnly(read(STRIP));

/** The header's control row only: from the row that holds them to whatever
 *  follows it (the parameter chips, then the tiles rail). Bounded by markers,
 *  never by a character budget, so a growing comment cannot empty the slice. */
function headerControls(): string {
  const src = strip();
  const start = src.indexOf('<div className="flex items-center gap-0.5">');
  expect(start, "the header control row must still exist").toBeGreaterThan(-1);
  const ends = [
    src.indexOf("{requiredParameters.size > 0", start),
    src.indexOf("data-testid={`qs-tiles-${field}`}", start),
  ].filter((i) => i > start);
  expect(ends.length, "the control row must still be followed by a known marker").toBeGreaterThan(0);
  return src.slice(start, Math.min(...ends));
}

/** The `<input>` element itself, attribute list and all. */
function searchInput(): string {
  const header = headerControls();
  const start = header.indexOf("<input");
  expect(start, "the filter input must be rendered in the header row").toBeGreaterThan(-1);
  const end = header.indexOf("/>", start);
  expect(end, "the filter input must still be a self-closing element").toBeGreaterThan(start);
  return header.slice(start, end);
}

describe("the Quick Select filter is on the page, not behind an icon", () => {
  it("renders the input unconditionally", () => {
    const src = strip();
    expect(src, "the hide-by-default flag must be gone").not.toMatch(/showSearch/);
    expect(src).not.toMatch(/setShowSearch/);
    const header = headerControls();
    // Nothing gates the row's children any more: the input and the add/edit
    // door are siblings, both mounted on every render of a strip.
    expect(header).toMatch(/<input/);
    expect(header).toMatch(/data-testid=\{`qs-search-\$\{field\}`\}/);
    expect(header).toMatch(/data-testid=\{`qs-edit-\$\{field\}`\}/);
    expect(header).not.toMatch(/\?\s*\(/);
    expect(header).not.toMatch(/&&\s*\(\s*$/m);
  });

  it("keeps the add/edit door live while the filter is used", () => {
    // Baseline: opening the filter replaced `qs-edit-${field}` with the input,
    // so the two doors could never both be reached in one glance.
    const header = headerControls();
    expect(header.indexOf("qs-search-${field}")).toBeGreaterThan(-1);
    expect(header.indexOf("qs-edit-${field}")).toBeGreaterThan(-1);
    expect(header.match(/data-testid=\{`qs-edit-\$\{field\}`\}/g)).toHaveLength(1);
  });

  it("stays reachable in the compact strips too", () => {
    // Impression / Recommendation render `compact`, where the rail is capped at
    // 72px — the place a filter helps most and the place the old hidden input
    // was hardest to notice.
    expect(headerControls()).toMatch(/compact \? "w-28" : "w-44"/);
  });

  it("clears the term on Escape instead of hiding the box", () => {
    const input = searchInput();
    const key = input.slice(input.indexOf("onKeyDown"));
    expect(key).toMatch(/e\.key !== "Escape"/);
    expect(key).toMatch(/setSearch\(""\)/);
    expect(key, "Escape must not dismiss the control it is pressed in").not.toMatch(/setShowSearch/);
    expect(input).toMatch(/onChange=\{\(e\) => setSearch\(e\.target\.value\)\}/);
    // And a mouse route to the same reset, for whoever is pointing.
    expect(headerControls()).toMatch(/data-testid=\{`qs-search-clear-\$\{field\}`\}/);
  });
});

describe("the keyboard exit lands on a control that exists", () => {
  it("focuses the input the tile rail's Escape asks for", () => {
    const src = strip();
    const at = src.indexOf('querySelector<HTMLInputElement>("');
    expect(at, "the rail's Escape must still hand focus to a named control").toBeGreaterThan(-1);
    const selector = src.slice(at + 'querySelector<HTMLInputElement>("'.length, src.indexOf('")', at + 1));
    expect(selector, "the exit target is still an input addressed by its accessible name").toMatch(
      /^input\[aria-label='(.+)'\]$/,
    );
    const label = /aria-label='(.+)'/.exec(selector)![1];
    // The cross-check: whatever the handler asks for, the rendered input is
    // named exactly that. Rename either side and this goes red.
    expect(searchInput()).toContain(`aria-label="${label}"`);
  });

  it("gives the input a name a screen reader can use", () => {
    const input = searchInput();
    expect(input).toMatch(/aria-label="Quick select search"/);
    expect(input).toMatch(/placeholder=\{`Search \$\{LABELS\[field\]\.toLowerCase\(\)\}…`\}/);
  });
});

describe("an emptied rail says why", () => {
  it("explains a term that matches no box, and offers the way back", () => {
    const src = strip();
    const at = src.indexOf("data-testid={`qs-search-empty-${field}`}");
    expect(at, "a filtered-empty strip must still explain itself").toBeGreaterThan(-1);
    const gate = src.slice(0, at);
    const conditionStart = gate.lastIndexOf("{");
    const condition = src.slice(conditionStart, at);
    expect(condition).toMatch(/filtered\.length === 0/);
    expect(condition).toMatch(/search\.trim\(\)\.length > 0/);
    const block = src.slice(at, src.indexOf("</div>", at));
    expect(block).toMatch(/matches “\{search\.trim\(\)\}”/);
    expect(block).toMatch(/setSearch\(""\)/);
  });
});
