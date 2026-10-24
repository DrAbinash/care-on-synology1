/**
 * Source contract: the key-image rail's write doors must speak when refused.
 *
 * patchMut / delMut / orderMut in FrozenKeyImagesRail each had only
 * onSuccess. A refused write — most often the 409 "Report finalized — its
 * images can no longer be modified" the server answers a locked draft with,
 * but also a 404 after a second tab deleted the row, or any 5xx/network
 * failure — changed nothing on screen and said nothing: the radiologist
 * toggled "exclude from report", watched the badge stay, and learned only
 * at the printer that the pictures were still included. That is the same
 * silent-door class the delivery-leg pass (#1168) fixed for the WhatsApp
 * dialog; this pin keeps the rail from regressing back to silence.
 *
 * The mutations must also disable their controls while in flight: a
 * reorder computed from a pre-reorder list double-submits when the arrows
 * stay clickable, which is precisely the race the server's reorder
 * advisory lock now has to survive.
 *
 * Source contract rather than DOM test deliberately: the rail is mounted
 * by a Phase 4 extraction file under `@ts-nocheck`, so the wiring a green
 * suite can silently lose is in the source text, exactly as the PACS
 * picker's props are (pacsPickerWiring.contract.test.ts).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ERP_SRC = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(resolve(ERP_SRC, rel), "utf8");

describe("FrozenKeyImagesRail write doors (source contract)", () => {
  const rail = read("components/radiology/FrozenKeyImagesRail.tsx");

  /** One mutation's declaration, from its `const NAME` to the next anchor. */
  function mutationBlock(name: string, nextAnchor: string): string {
    const start = rail.indexOf(`const ${name} = useMutation({`);
    expect(start, `mutation ${name} must exist`).toBeGreaterThanOrEqual(0);
    const end = rail.indexOf(nextAnchor, start);
    expect(end, `anchor ${nextAnchor} must follow ${name}`).toBeGreaterThan(start);
    return rail.slice(start, end);
  }

  it("a failed caption / include / detach patch is reported, not silent", () => {
    const block = mutationBlock("patchMut", "const delMut");
    expect(block).toMatch(/onError/);
    expect(block).toMatch(/toast\(/);
  });

  it("a failed delete is reported, not silent", () => {
    const block = mutationBlock("delMut", "// Reorder sends");
    expect(block).toMatch(/onError/);
    expect(block).toMatch(/toast\(/);
  });

  it("a failed reorder is reported, not silent", () => {
    const block = mutationBlock("orderMut", "const move");
    expect(block).toMatch(/onError/);
    expect(block).toMatch(/toast\(/);
  });

  it("the error toast carries the server's own reason (409 finalize message included)", () => {
    // HttpError.message is the sanitized server body — "Report finalized —
    // its images can no longer be modified" — so the door names itself.
    expect(rail).toMatch(/err instanceof Error \? err\.message : String\(err\)/);
  });

  it("the rail carries the toast door", () => {
    expect(rail).toMatch(/useToast/);
  });

  it("mutating controls are disabled while a write is in flight — no double-submit race", () => {
    expect(rail).toContain("orderMut.isPending");
    expect(rail).toContain("patchMut.isPending");
    expect(rail).toContain("delMut.isPending");
  });
});
