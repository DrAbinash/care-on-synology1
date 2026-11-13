/**
 * Audit item 14 — a viewer capture answers what actually happened.
 *
 * Three ways this went wrong at `ba207aa62`, all in the same three lines a
 * radiologist looks at:
 *
 *   · `EmbeddedWadoViewer.tsx:620-657` answered a capture click with a bare
 *     `boolean`, `false` for six different reasons, and the button that owns it
 *     ran `void captureFramesKeyImage()` (`:1086`) — so a click that captured
 *     nothing and a click that was never wired looked identical on screen.
 *   · `workspace/ViewerColumn.tsx:595` printed `String(e)` for a failed upload:
 *     `Error: <the server's sentence>` or `TypeError: Failed to fetch`.
 *   · `uploadFrozenKeyImage` (`FrozenKeyImagesRail.tsx:695-705`) returned
 *     `data.item` alone, dropping the `warningCode` the route sends WITH a 201
 *     (`radiology-report-generator.ts:3125-3130`) when it could not tie the
 *     pixels to the study they claim. Both capture doors then toasted success.
 *
 * The wording is pure and tested as behaviour; the doors that must carry it are
 * pinned at source, because there is no DOM harness here (`environment: "node"`
 * repo-wide) and the precedent for that is `frozenKeyImagesRailCapture.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  describeFramesCaptureBlocked,
  describeKeyImageUploadFailure,
  keyImageUploadWarning,
} from "./keyImageCaptureOutcome";
import { keyImageAttachWarning } from "./pacsImagePicker";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(HERE, rel), "utf8").replace(/\r\n/g, "\n");
const ERP_SRC = resolve(HERE, "..");
const src = (rel: string) => readFileSync(resolve(ERP_SRC, rel), "utf8").replace(/\r\n/g, "\n");

describe("a refused Frames capture answers the click", () => {
  it("names an empty viewport as such, and says nothing was saved", () => {
    const notice = describeFramesCaptureBlocked("no-image");
    expect(notice.title).toBe("Nothing to capture");
    expect(notice.description).toContain("no image displayed");
    expect(notice.description).toContain("Nothing was saved");
  });

  it("passes the browser's own cause through when the pixels could not be read", () => {
    // The two real causes need different recoveries and only this sentence tells
    // them apart: a canvas tainted by the cross-origin image is worked around in
    // OHIF, a half-loaded frame is worked around by reloading it.
    const notice = describeFramesCaptureBlocked(
      "encode-failed",
      "Failed to execute 'toBlob' on 'HTMLCanvasElement': Tainted canvases may not be exported.",
    );
    expect(notice.title).toBe("Could not read the image pixels");
    expect(notice.description).toContain("Tainted canvases may not be exported");
    expect(notice.description).toContain("capture from OHIF");
    expect(notice.description).toContain("Nothing was saved");
  });

  it("still answers when the failure carried no message", () => {
    const notice = describeFramesCaptureBlocked("encode-failed", "   ");
    expect(notice.description).toContain("Nothing was saved");
    expect(notice.description).not.toMatch(/\s—\s*\./);
  });

  it("covers every reason the union declares", () => {
    // Read from the source so adding a third reason cannot ship unworded.
    const lib = read("keyImageCaptureOutcome.ts");
    const declared = /export type FramesCaptureBlock =[\s\S]*?;/.exec(lib);
    expect(declared, "the refusal reasons must stay a declared union").not.toBeNull();
    const reasons = [...declared![0].matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
    expect(reasons.length).toBeGreaterThan(1);
    for (const reason of reasons) {
      const notice = describeFramesCaptureBlocked(reason as never, "cause");
      expect(notice.title.trim().length, `${reason} must have a title`).toBeGreaterThan(0);
      expect(notice.description).toContain("Nothing was saved");
    }
    // "idle" is deliberately NOT one of them: nothing was attempted, and a
    // notice for it would answer a question nobody asked.
    expect(lib).toMatch(/export type FramesCaptureOutcome = "captured" \| "idle" \| FramesCaptureBlock/);
  });
});

describe("a failed upload speaks ERP, not transport", () => {
  it("keeps the server's own sentence and adds that nothing was saved", () => {
    const said = describeKeyImageUploadFailure(
      new Error("Report finalized — its images can no longer be modified"),
    );
    expect(said).toContain("Report finalized — its images can no longer be modified");
    expect(said).toContain("nothing was saved");
    // The `Error: ` prefix `String(e)` printed is gone: it is the transport's
    // vocabulary, and it was the whole of what the old toast said.
    expect(said).not.toMatch(/^Error:/);
  });

  it("calls an unanswered request what it is", () => {
    const said = describeKeyImageUploadFailure(new TypeError("Failed to fetch"));
    expect(said).toContain("never reached the server");
    expect(said).toContain("Nothing was saved");
    expect(said).not.toContain("Failed to fetch");
  });

  it("calls an unreadable answer what it is", () => {
    // nginx answers a recreate with an HTML 502, and `res.json()` throws before
    // the helper ever sees a status.
    const said = describeKeyImageUploadFailure(new SyntaxError("<!DOCTYPE html> is not valid JSON"));
    expect(said).toContain("may be restarting");
    expect(said).toContain("Nothing was saved");
  });

  it("survives a throw that is not an Error", () => {
    expect(describeKeyImageUploadFailure("disk full")).toContain("disk full");
    // `String(undefined)` is the word "undefined", which is not a cause.
    const unknown = describeKeyImageUploadFailure(undefined);
    expect(unknown).toContain("could not name");
    expect(unknown).toContain("Nothing was saved");
    expect(unknown).not.toContain("undefined");
    expect(describeKeyImageUploadFailure({})).not.toContain("[object Object]");
  });
});

describe("the server's caution about an image it accepted", () => {
  it("is the sentence the picker doors already show", () => {
    const envelope = { warningCode: "study-uid-mismatch", warning: "claims 1.2.3, study is 1.2.9" };
    expect(keyImageUploadWarning(envelope)).toBe(keyImageAttachWarning(envelope));
    expect(keyImageUploadWarning(envelope)).toContain("study-uid-mismatch");
    expect(keyImageUploadWarning(envelope)).toContain("could not be verified");
  });

  it("is silent when there is nothing to caution about", () => {
    expect(keyImageUploadWarning({})).toBeNull();
    expect(keyImageUploadWarning(null)).toBeNull();
    expect(keyImageUploadWarning(undefined)).toBeNull();
  });
});

describe("the doors carry the verdict (source contract)", () => {
  const viewer = src("components/EmbeddedWadoViewer.tsx");
  const column = src("components/radiology/workspace/ViewerColumn.tsx");
  const rail = src("components/radiology/FrozenKeyImagesRail.tsx");
  const bridge = src("hooks/radiology-workspace/useOhifViewerBridge.ts");

  function captureBody(): string {
    const start = viewer.indexOf("const captureFramesKeyImage = useCallback(");
    expect(start, "the viewer must still own the Frames capture").toBeGreaterThan(-1);
    const end = viewer.indexOf("\n  ]);", start);
    expect(end, "the capture callback must still be closed").toBeGreaterThan(start);
    return viewer.slice(start, end);
  }

  it("every refusal route out of the Frames capture is announced", () => {
    const body = captureBody();
    // Six bare `return false`s became two announced refusals and one quiet idle.
    expect(body).not.toMatch(/return false/);
    expect(body.match(/return refuse\("no-image"\)/g)).toHaveLength(2);
    expect(body).toMatch(/return refuse\("encode-failed", e instanceof Error \? e\.message : undefined\)/);
    expect(body).toMatch(/if \(!onCaptureViewport \|\| captureBusy\) return "idle"/);
    expect(body).toMatch(/onCaptureBlocked\?\.\(describeFramesCaptureBlocked\(reason, detail\)\)/);
  });

  it("the workspace wires the notice to a toast", () => {
    expect(viewer).toMatch(/onCaptureBlocked\?: \(notice: CaptureNotice\) => void/);
    expect(column).toMatch(/onCaptureBlocked=\{\(notice\) => toast\(\{ \.\.\.notice, variant: "destructive" \}\)\}/);
  });

  it("the Frames upload door no longer prints the transport", () => {
    expect(column).not.toMatch(/title: "Capture failed", description: String\(e\)/);
    expect(column).toMatch(/title: "Capture failed", description: describeKeyImageUploadFailure\(e\)/);
    expect(bridge).toMatch(/title: "Annotated capture was NOT saved",\s*\n\s*description: describeKeyImageUploadFailure\(e\)/);
    // …and it does not discard the cause the way `catch {` did.
    expect(bridge).not.toMatch(/\} catch \{\s*\n\s*toast\(\{\s*\n\s*title: "Annotated capture was NOT saved"/);
  });

  it("the 201-with-warning envelope reaches the radiologist at both doors", () => {
    expect(rail).toMatch(/const data = \(await res\.json\(\)\) as \{[\s\S]*?warningCode\?: string \| null;[\s\S]*?warning\?: string \| null;/);
    expect(rail).toMatch(/return \{ image: data\.item, warning: keyImageUploadWarning\(data\) \}/);
    expect(column).toMatch(/const upload = await uploadFrozenKeyImage\(fd\)/);
    expect(column).toMatch(/if \(upload\.warning\)/);
    expect(column).toMatch(/title: "Image needs a check"/);
    expect(bridge).toMatch(/const upload = await uploadFrozenKeyImage\(fd\)/);
    expect(bridge).toMatch(/upload\.warning/);
    expect(bridge).toMatch(/title: "Image needs a check"/);
  });

  it("refreshes the rail for every saved image, warned or not, and for no refused one", () => {
    // The warning branch must not cost the radiologist the image in the rail:
    // the row IS saved when the server is merely unsure of its study identity.
    // The invalidation therefore runs before either toast, and the refusal path
    // still returns from the catch without touching the cache.
    const at = bridge.indexOf("const upload = await uploadFrozenKeyImage(fd)");
    expect(at).toBeGreaterThan(-1);
    const block = bridge.slice(at, at + 900);
    expect(block.indexOf("invalidateQueries")).toBeLessThan(block.indexOf("upload.warning"));
    expect(block).toMatch(/return;\s*\n\s*\}/);
  });
});
