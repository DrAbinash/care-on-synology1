/**
 * Source contract: the image-reference PATCH's presentation rules (P2-4 + E-2).
 *
 * The PATCH is the one door that rewrites a reference row's presentationJson.
 * Three properties must hold, and each is pinned here as source needles
 * (same convention as keyImagesReorderLock.sourceContract.test.ts — the
 * route is DB-gated in CI; this pin keeps the wiring from silently losing a
 * rule between green CI runs):
 *
 *  1. a framing-only edit must NOT strip the stored VOI (P2-4);
 *  2. a voi edit must NOT reset the framing, and must set the VOI (E-2);
 *  3. an explicit null voi clears the claim (back to the PACS window);
 *     an absent voi keeps whatever is stored.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "radiology-report-generator.ts"), "utf8");

const patchStart = src.indexOf("const ImageRefPatchSchema");
const patchEnd = src.indexOf("res.json(row);", src.indexOf("radiologyReportGeneratorRouter.patch(\"/image-references/:id\"", patchStart));
const patchSrc = src.slice(patchStart, patchEnd);

describe("image-reference PATCH — presentation rules (P2-4/E-2)", () => {
  it("the schema accepts a nullable voi pair (explicit clear vocabulary)", () => {
    expect(patchSrc).toMatch(/voi: z\.object\(\{[\s\S]*?windowWidth[\s\S]*?windowCenter[\s\S]*?\}\)\.nullable\(\)\.optional\(\)/);
  });

  it("a framing edit keeps the row's stored VOI (parseImageVoi of the target row)", () => {
    expect(patchSrc).toContain("parseImageVoi(target.presentationJson)");
  });

  it("a voi edit keeps the row's stored framing (parseImageFraming of the target row)", () => {
    expect(patchSrc).toContain("parseImageFraming(target.presentationJson)");
  });

  it("absent half keeps the stored value; explicit null clears (undefined-vs-null rule)", () => {
    expect(patchSrc).toContain("parsed.data.voi !== undefined ? parsed.data.voi : parseImageVoi(target.presentationJson)");
    expect(patchSrc).toContain("parsed.data.framing !== undefined || parsed.data.voi !== undefined");
  });
});
