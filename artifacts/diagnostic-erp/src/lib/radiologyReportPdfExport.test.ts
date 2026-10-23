import { describe, expect, it, vi } from "vitest";
import {
  buildFindingsText, buildKeyImagesRailHtml, countInlinedDicomImages, fetchKeyImageDataUrls,
  hydratePrintPreviewKeyImages, replaceSideImagePanel,
} from "./radiologyReportPdfExport";
import type { ReportImageRef } from "./reportImageRefs";

describe("buildFindingsText", () => {
  // A section heading goes on its own line and its body on the next. That is
  // the convention findingsDocument.ts reads, and it is what makes the letter
  // pad draw the heading as a heading instead of bolding a label at the start
  // of a sentence — the complaint that a spine report arrived as one long line.

  it("returns the raw freeform text, trimmed, when not structured", () => {
    expect(
      buildFindingsText({ useStructured: false, findingsMap: {}, rawFindings: "  Lungs clear.  \n" }),
    ).toBe("Lungs clear.");
  });

  it("renders a normal region with 'Normal.' when it has no text", () => {
    const text = buildFindingsText({
      useStructured: true,
      findingsMap: { "lung fields": { normal: true, text: "" } },
      rawFindings: "",
    });
    expect(text).toBe("LUNG FIELDS:\nNormal.");
  });

  it("renders an abnormal region's own text instead of 'Normal.'", () => {
    const text = buildFindingsText({
      useStructured: true,
      findingsMap: { "lung fields": { normal: false, text: "Right lower lobe consolidation." } },
      rawFindings: "",
    });
    expect(text).toBe("LUNG FIELDS:\nRight lower lobe consolidation.");
  });

  it("uses an em-dash placeholder for an abnormal region with no text yet", () => {
    const text = buildFindingsText({
      useStructured: true,
      findingsMap: { "lung fields": { normal: false, text: "" } },
      rawFindings: "",
    });
    expect(text).toBe("LUNG FIELDS:\n—");
  });

  it("joins multiple regions with a blank line between them, in map insertion order", () => {
    // Blank-line separation between anatomical sections (letter-pad
    // readability) was made intentional in fe271c84 (#399), which changed
    // the join separator from "\n" to "\n\n" but left this assertion on the
    // old single-newline behavior — updated here to match current intent.
    const text = buildFindingsText({
      useStructured: true,
      findingsMap: {
        "lung fields": { normal: true, text: "" },
        heart: { normal: false, text: "Cardiomegaly." },
      },
      rawFindings: "",
    });
    expect(text).toBe("LUNG FIELDS:\nNormal.\n\nHEART:\nCardiomegaly.");
  });

  it("respects title_case heading formatting", () => {
    const text = buildFindingsText({
      useStructured: true,
      findingsMap: { "lung fields": { normal: true, text: "" } },
      rawFindings: "",
      headingCase: "title_case",
    });
    expect(text).toBe("Lung Fields:\nNormal.");
  });

  it("a stale map never wins over non-empty live text — the PDF mirrors the screen and the signed body", () => {
    // The map→text sync is one-way: a tile click, dictation or direct typing
    // updates findingsText while the map stands still. The SIGNED body already
    // refuses a stale map; the PDF must apply the same rule or the exported
    // document omits the newest findings the radiologist just entered.
    const text = buildFindingsText({
      useStructured: true,
      findingsMap: { "lung fields": { normal: true, text: "" } },
      rawFindings: "Right lower lobe consolidation with air bronchograms.",
    });
    expect(text).toBe("Right lower lobe consolidation with air bronchograms.");
  });

  it("an in-sync map still renders the structured scaffold", () => {
    const text = buildFindingsText({
      useStructured: true,
      findingsMap: { "lung fields": { normal: false, text: "Right lower lobe consolidation." } },
      rawFindings: "lung fields:\nRight lower lobe consolidation.",
    });
    expect(text).toBe("LUNG FIELDS:\nRight lower lobe consolidation.");
  });
});

function makeRef(overrides: Partial<ReportImageRef>): ReportImageRef {
  return {
    id: 1,
    draftId: 1,
    description: "Image",
    studyInstanceUid: "1.2.3",
    seriesInstanceUid: "1.2.3.4",
    sopInstanceUid: "1.2.3.4.5",
    frameNumber: null,
    displayOrder: 0,
    ...overrides,
  };
}

describe("fetchKeyImageDataUrls", () => {
  it("returns [] when there is no DICOMweb base configured", async () => {
    const result = await fetchKeyImageDataUrls(null, [makeRef({ id: 1 })]);
    expect(result).toEqual([]);
  });

  it("returns [] when there are no selected images", async () => {
    const result = await fetchKeyImageDataUrls("https://pacs.example/dicomweb", []);
    expect(result).toEqual([]);
  });

  // These three used to assert that an unreadable image was SKIPPED. That is the
  // defect, not the contract: a study with 14 selected images exported 5 of them
  // and the page said nothing about the other 9. A reference that cannot be read
  // must still arrive — with empty pixels and its own identity — so the PDF can
  // draw a placeholder and name the attachment.
  it("keeps a ref with no usable UIDs, unreadable and identified, without calling fetch", async () => {
    const fetchImpl = vi.fn();
    const result = await fetchKeyImageDataUrls(
      "https://pacs.example/dicomweb",
      [makeRef({ id: 1, studyInstanceUid: null })],
      { fetchImpl },
    );
    expect(result).toHaveLength(1);
    expect(result[0].src).toBe("");
    expect(result[0].attachmentId).toBe(1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps an image whose fetch response is not ok, marked unreadable", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false });
    const result = await fetchKeyImageDataUrls(
      "https://pacs.example/dicomweb",
      [makeRef({ id: 7, sopInstanceUid: "1.2.3.7" })],
      { fetchImpl },
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ src: "", attachmentId: 7, sopInstanceUid: "1.2.3.7" });
  });

  it("keeps an image whose fetch throws, without failing the whole batch", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    const result = await fetchKeyImageDataUrls(
      "https://pacs.example/dicomweb",
      [makeRef({ id: 1 }), makeRef({ id: 2 })],
      { fetchImpl },
    );
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.src === "")).toBe(true);
  });

  it("fetches every selected image — no default cap", async () => {
    // The limit that used to live here (12) is why a 14-image study came back
    // short. `limit` is still honoured when a caller asks for one.
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false });
    const refs = Array.from({ length: 20 }, (_, i) => makeRef({ id: i + 1, displayOrder: i }));
    const result = await fetchKeyImageDataUrls("https://pacs.example/dicomweb", refs, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(20);
    expect(result).toHaveLength(20);
  });

  it("caps the number of images fetched at the given limit", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false });
    const refs = [1, 2, 3].map((id) => makeRef({ id, displayOrder: id }));
    await fetchKeyImageDataUrls("https://pacs.example/dicomweb", refs, { fetchImpl, limit: 2 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fetches in displayOrder, not input order", async () => {
    const calledUrls: string[] = [];
    const fetchImpl = vi.fn().mockImplementation((url: string) => {
      calledUrls.push(url);
      return Promise.resolve({ ok: false });
    });
    const refs = [
      makeRef({ id: 1, sopInstanceUid: "1.1.1.1", displayOrder: 2 }),
      makeRef({ id: 2, sopInstanceUid: "2.2.2.2", displayOrder: 0 }),
      makeRef({ id: 3, sopInstanceUid: "3.3.3.3", displayOrder: 1 }),
    ];
    await fetchKeyImageDataUrls("https://pacs.example/dicomweb", refs, { fetchImpl });
    expect(calledUrls[0]).toContain("2.2.2.2");
    expect(calledUrls[1]).toContain("3.3.3.3");
    expect(calledUrls[2]).toContain("1.1.1.1");
  });
});

describe("hydratePrintPreviewKeyImages", () => {
  it("re-hydrates the whole selection when the server only inlined part of it", async () => {
    // The skip test above is the danger: a budget that declared the rail "done"
    // at six images is how a fourteen-image study printed six. Inlining seven of
    // fourteen must still fetch and place all fourteen.
    const longJpeg = "data:image/jpeg;base64," + "A".repeat(80);
    const inlined = Array.from({ length: 7 }, () =>
      `<div class="image-cell"><img class="dicom-img" src="${longJpeg}"/></div>`).join("");
    const html = `<div class="image-panel image-panel-side"><div class="image-panel-heading">KEY IMAGES</div>` +
      `<div class="image-grid">${inlined}</div></div>`;
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false });
    const refs = Array.from({ length: 14 }, (_, i) => makeRef({ id: i + 1, displayOrder: i }));
    const out = await hydratePrintPreviewKeyImages(html, "https://pacs.example/dicomweb", refs, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(14);
    expect(out).toContain('data-image-count="14"');
  });

  it("leaves HTML alone when enough usable data URLs are already inlined", async () => {
    const longJpeg =
      "data:image/jpeg;base64," + "A".repeat(80);
    const html = `<div class="image-panel image-panel-side"><div class="image-panel-heading">KEY IMAGES</div><div class="image-grid"><div class="image-cell"><img class="dicom-img" src="${longJpeg}"/></div></div></div>`;
    const fetchImpl = vi.fn();
    const out = await hydratePrintPreviewKeyImages(html, "https://pacs.example/dicomweb", [makeRef()], { fetchImpl });
    expect(out).toBe(html);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("replaces a nested side-panel rail (not just the heading close)", () => {
    const emptyRail =
      `<div class="image-panel image-panel-side image-panel-keyrail" data-image-count="2">` +
      `<div class="image-panel-heading">KEY IMAGES</div>` +
      `<div class="image-grid"><div class="image-cell"><img class="dicom-img" src=""/></div>` +
      `<div class="image-cell"><img class="dicom-img" src=""/></div></div></div>`;
    const html = `<div class="content-area has-side-images"><div class="report-column"><p>Body</p></div>${emptyRail}</div><div class="sigs"></div>`;
    const filled = "data:image/jpeg;base64," + "B".repeat(80);
    const rail = `<div class="image-panel image-panel-side image-panel-keyrail" data-image-count="1"><div class="image-panel-heading">KEY IMAGES</div><div class="image-grid"><div class="image-cell"><img class="dicom-img" src="${filled}"/></div></div></div>`;
    const out = replaceSideImagePanel(html, rail);
    expect(out).toContain(filled);
    expect(out).not.toContain('src=""');
    expect(countInlinedDicomImages(out!)).toBe(1);
  });

  it("injects a square key-images rail when the server returned no pixels", async () => {
    const tinyJpeg =
      "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//Z";
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob([Uint8Array.from([0xff, 0xd8, 0xff])], { type: "image/jpeg" }),
    });
    // Override blob→dataURL path by mocking FileReader is hard; instead stub fetchKeyImage
    // via returning a real-looking response — FileReader may not exist in Node.
    // Use a pre-resolved path: pass refs and a fetch that fails, then manually test rail builder.
    const empty = `<div class="content-area"><div class="report-column"><p>Body</p></div></div><div class="sigs"></div>`;
    // An attachment that could not be read used to leave the page exactly as it
    // was, which is how a selected image disappeared without a trace. It now
    // prints a placeholder that says so — and never a broken <img src="">.
    const withNotice = await hydratePrintPreviewKeyImages(empty, "https://pacs.example/dicomweb", [makeRef()], {
      fetchImpl: vi.fn().mockResolvedValue({ ok: false }),
    });
    expect(withNotice).not.toBe(empty);
    expect(withNotice).toContain("image-unreadable");
    expect(withNotice).toContain("IMAGE COULD NOT BE READ");
    expect(withNotice).toContain('data-image-count="1"');
    expect(withNotice).not.toMatch(/<img[^>]*src=""/);

    // Pending empty rail + failed fetch → the placeholder replaces the pending
    // cell, so the rail still reports one image and says it could not be read.
    const pendingRail =
      `<div class="content-area has-side-images"><div class="report-column"><p>Body</p></div>` +
      `<div class="image-panel image-panel-side image-panel-keyrail" data-image-count="1">` +
      `<div class="image-panel-heading">KEY IMAGES</div>` +
      `<div class="image-grid"><div class="image-cell image-cell-pending"><img class="dicom-img dicom-img-pending" src=""/></div></div></div></div>`;
    const replaced = await hydratePrintPreviewKeyImages(pendingRail, "https://pacs.example/dicomweb", [makeRef()], {
      fetchImpl: vi.fn().mockResolvedValue({ ok: false }),
    });
    expect(replaced).toContain("image-unreadable");
    expect(replaced).not.toContain("dicom-img-pending");
    expect(replaced).not.toMatch(/<img[^>]*src=""/);

    // Simulate successful hydration by injecting with a custom fetch that returns a blob
    // and a polyfilled FileReader if needed.
    const OriginalFR = (globalThis as { FileReader?: typeof FileReader }).FileReader;
    class FakeFileReader {
      result: string | null = null;
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      readAsDataURL(_blob: Blob) {
        this.result = tinyJpeg;
        queueMicrotask(() => this.onload?.());
      }
    }
    (globalThis as { FileReader: unknown }).FileReader = FakeFileReader;
    try {
      const hydrated = await hydratePrintPreviewKeyImages(empty, "https://pacs.example/dicomweb", [makeRef()], {
        fetchImpl,
      });
      expect(hydrated).toContain("image-panel-keyrail");
      expect(hydrated).toContain("has-side-images");
      expect(hydrated).toContain("dicom-img");
      expect(hydrated).toContain(tinyJpeg);
    } finally {
      if (OriginalFR) (globalThis as { FileReader: unknown }).FileReader = OriginalFR;
    }
  });
});

const TINY_JPEG =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//Z";

/** blob → data URL needs FileReader, which the node environment does not have. */
async function withPixels<T>(run: () => Promise<T>): Promise<T> {
  const OriginalFR = (globalThis as { FileReader?: typeof FileReader }).FileReader;
  class FakeFileReader {
    result: string | null = null;
    onload: null | (() => void) = null;
    onerror: null | (() => void) = null;
    readAsDataURL(_blob: Blob) {
      this.result = TINY_JPEG;
      queueMicrotask(() => this.onload?.());
    }
  }
  (globalThis as { FileReader: unknown }).FileReader = FakeFileReader;
  try {
    return await run();
  } finally {
    if (OriginalFR) (globalThis as { FileReader: unknown }).FileReader = OriginalFR;
    else delete (globalThis as { FileReader?: typeof FileReader }).FileReader;
  }
}

const jpegResponse = () => ({
  ok: true,
  blob: async () => new Blob([Uint8Array.from([0xff, 0xd8, 0xff])], { type: "image/jpeg" }),
});

describe("Download PDF carries each image's own label, and nobody else's", () => {
  // Every earlier case here failed the fetch, so nothing ever asserted the shape
  // of a successful item — the caption could have been dropped silently.
  it("keeps the stored caption with the pixels it belongs to, in display order", async () => {
    const refs = [
      makeRef({ id: 1, sopInstanceUid: "1.1.1.1", description: "FLAIR", displayOrder: 1 }),
      makeRef({ id: 2, sopInstanceUid: "2.2.2.2", description: "T2 AXIAL", displayOrder: 0 }),
    ];
    const got = await withPixels(() =>
      fetchKeyImageDataUrls("https://pacs.example/dicomweb", refs, {
        fetchImpl: vi.fn().mockResolvedValue(jpegResponse()),
      }),
    );
    expect(got.map((k) => k.caption)).toEqual(["T2 AXIAL", "FLAIR"]);
    expect(got.every((k) => k.src.startsWith("data:image/jpeg;base64,"))).toBe(true);
  });

  it("a label nobody wrote stays absent — no caption, no invented words", async () => {
    const refs = [makeRef({ id: 1, description: "" }), makeRef({ id: 2, description: "   \t " })];
    const got = await withPixels(() =>
      fetchKeyImageDataUrls("https://pacs.example/dicomweb", refs, {
        fetchImpl: vi.fn().mockResolvedValue(jpegResponse()),
      }),
    );
    expect(got.map((k) => k.caption)).toEqual(["", ""]);
  });

  it("the rail puts a caption only under the image that has one", () => {
    const rail = buildKeyImagesRailHtml([
      { src: "data:image/jpeg;base64,AAA", caption: "T2 SAG" },
      { src: "data:image/jpeg;base64,BBB", caption: "   " },
      { src: "data:image/jpeg;base64,CCC", caption: "ADC b=1000" },
    ]);
    expect(rail.match(/<figcaption/g) ?? []).toHaveLength(2);
    expect(rail).toContain('<figcaption class="image-caption">T2 SAG</figcaption>');
    expect(rail).toContain('<figcaption class="image-caption">ADC b=1000</figcaption>');
    // The uncaptioned image gets no number either.
    expect(rail).not.toMatch(/Image \d/);
    expect(rail.match(/alt="([^"]*)"/g)).toEqual(['alt="T2 SAG"', 'alt=""', 'alt="ADC b=1000"']);
  });

  it("escapes the caption, because it is the radiologist's text inside innerHTML", () => {
    const rail = buildKeyImagesRailHtml([{ src: "data:image/jpeg;base64,AAA", caption: `<b>x</b>"y` }]);
    expect(rail).not.toContain("<b>x</b>");
    expect(rail).toContain("&lt;b&gt;x&lt;/b&gt;&quot;y");
  });
});
