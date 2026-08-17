import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { safePrev } from "./StructuredFormatBuilder";

describe("structured format version history", () => {
  const src = readFileSync(resolve(__dirname, "StructuredFormatBuilder.tsx"), "utf8");

  it("declares modality state with the correct useState tuple", () => {
    expect(src).toContain('const [modality, setModality] = useState(template?.modality ?? "MRI")');
    expect(src).not.toMatch(/const odality,\s*setModality\]/);
  });

  it("only bumps formatVersion when sectionsJson changed", () => {
    expect(src).toContain("const sectionsChanged = template?.sectionsJson !== newSectionsJson");
    expect(src).toContain("(template?.formatVersion ?? 1) + (template?.id && sectionsChanged ? 1 : 0)");
  });

  it("does not append a history entry when sectionsJson is unchanged", () => {
    const json = '{"schemaVersion":2,"sections":[]}';
    const existing = JSON.stringify([
      { archivedAt: "2026-01-01T00:00:00.000Z", formatVersion: 1, sectionsJson: json },
    ]);
    expect(safePrev(existing, json, 1)).toBe(existing);
  });

  it("appends a capped history entry when sectionsJson changed", () => {
    const prev = '{"a":1}';
    const next = safePrev("[]", prev, 2);
    const arr = JSON.parse(next) as Array<{ sectionsJson: string; formatVersion: number }>;
    expect(arr).toHaveLength(1);
    expect(arr[0]!.sectionsJson).toBe(prev);
    expect(arr[0]!.formatVersion).toBe(2);
  });
});
