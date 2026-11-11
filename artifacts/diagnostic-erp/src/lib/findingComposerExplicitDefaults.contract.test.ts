/**
 * findingComposerExplicitDefaults.contract.test.ts — the composer must not
 * commit clinical claims the radiologist never chose (audit F-09).
 *
 * Switching a finding used to auto-select the first severity ('mild') and the
 * first level, silently pre-check 'Include in Impression', and
 * renderComposerPhrase would inject the catalog default for any unanswered
 * question. One click on 'Disc bulge' plus 'Add Finding' then committed
 * 'mild diffuse disc bulge' with a laterality or level claim that was never
 * reviewed. Severity is a clinical claim and must be chosen, not implied —
 * the same refusal the Quick Select strip already implements for
 * un-lateralized picks.
 *
 * Source pin in this repo's no-DOM idiom (composerAuditFixes.contract.test.ts
 * convention).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "..");
const read = (rel: string) => readFileSync(resolve(SRC, rel), "utf8").replace(/\r\n/g, "\n");

const composer = read("components/radiology/reporting-canvas/FindingComposer.tsx");

describe("F-09: finding switches no longer auto-pick clinical claims", () => {
  it("a finding switch resets unpicked severity to the placeholder", () => {
    // The old line auto-selected severityOptionsForEntry(next)[0] — 'mild'.
    expect(composer).toMatch(/severity: keepSeverity \? draft\.severity : "",/);
    expect(composer).toMatch(/const keepSeverity = \(vis\.severity \|\| vis\.grade\) && !!draft\.severity && nextSeverities\.includes\(draft\.severity\);/);
  });

  it("a finding switch resets unpicked level to the placeholder (A-8 preserved)", () => {
    // The old line fell back to nextLevels[0]; the kept level must still be one
    // the NEW entry offers.
    expect(composer).toMatch(/level: keepLevel \? draft\.level : "",/);
    expect(composer).toMatch(/const keepLevel = vis\.level && !!draft\.level && nextLevels\.includes\(draft\.level\);/);
  });

  it("'Include in Impression' is never silently pre-checked by the entry", () => {
    // The old line OR-ed in Boolean(next?.impressionText?.trim()).
    expect(composer).toMatch(/includeInImpression: draft\.includeInImpression,/);
    expect(composer).not.toMatch(/includeInImpression: Boolean\(next\?\.impressionText/);
  });
});

describe("F-09: Add Finding is blocked until the claims are picked", () => {
  it("the submit predicate includes the missing-picks gate", () => {
    expect(composer).toMatch(/missingPicks\.length === 0;?\s*$/m);
    expect(composer).toMatch(/canSubmit =\s*Boolean\(entry && phrase\?\.findings\.trim\(\)\) && !disabled && missingPicks\.length === 0;/);
  });

  it("the submit handler refuses the same path, not just the button", () => {
    expect(composer).toMatch(/if \(disabled \|\| !entry \|\| !phrase\?\.findings\.trim\(\) \|\| missingPicks\.length > 0\) return;/);
  });

  it("severity, level and laterality are all enumerated as blocking claims", () => {
    expect(composer).toMatch(/if \(controls\.level && !draft\.level\) missingPicks\.push\("level"\);/);
    expect(composer).toMatch(/if \(\(controls\.severity \|\| controls\.grade\) && !draft\.severity\) \{\s*missingPicks\.push\(controls\.grade \? "grade" : "severity"\);/);
    expect(composer).toMatch(/if \(controls\.laterality && !draft\.laterality\) missingPicks\.push\("laterality"\);/);
  });

  it("the radiologist is told what is still missing", () => {
    expect(composer).toMatch(/data-testid="composer-missing-picks"/);
  });
});
