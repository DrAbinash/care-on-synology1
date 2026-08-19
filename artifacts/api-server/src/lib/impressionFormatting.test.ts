import { describe, expect, it } from "vitest";
import {
  normalizeImpressionBullet,
  parseImpressionBullets,
  renderImpressionSectionHtml,
  parseImpressionStyle,
} from "./impressionFormatting";

describe("impressionFormatting", () => {
  it("strips manual leading numbers and bullets", () => {
    expect(normalizeImpressionBullet("1. Normal chest")).toBe("Normal chest");
    expect(normalizeImpressionBullet("2) Follow up")).toBe("Follow up");
    expect(normalizeImpressionBullet("- bullet item")).toBe("bullet item");
  });

  it("parses JSON array and newline plain text", () => {
    expect(parseImpressionBullets(JSON.stringify(["A", "B"]))).toEqual(["A", "B"]);
    expect(parseImpressionBullets("1. First line\nSecond line")).toEqual(["First line", "Second line"]);
  });

  it("splits multi-line JSON array entries", () => {
    expect(parseImpressionBullets(JSON.stringify(["1. One\nTwo\nThree"]))).toEqual(["One", "Two", "Three"]);
  });

  it("renders numbered, bulleted, and plain lists", () => {
    const esc = (s: string) => s;
    expect(renderImpressionSectionHtml(["A", "B"], "numbered", esc)).toContain("<ol>");
    expect(renderImpressionSectionHtml(["A", "B"], "bulleted", esc)).toContain("<ul>");
    expect(renderImpressionSectionHtml(["A", "B"], "plain", esc)).toContain("A; B");
  });

  it("defaults unknown impression style to bulleted", () => {
    expect(parseImpressionStyle("weird")).toBe("bulleted");
    expect(parseImpressionStyle("numbered")).toBe("numbered");
  });
});
