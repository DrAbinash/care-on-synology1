import { describe, expect, it, vi } from "vitest";
import { buildFindingsText, fetchKeyImageDataUrls, hydratePrintPreviewKeyImages, replaceSideImagePanel, countInlinedDicomImages } from "./radiologyReportPdfExport";
import type { ReportImageRef } from "./reportImageRefs";

describe("buildFindingsText", () => {
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
    expect(text).toBe("LUNG FIELDS: Normal.");
  });

  it("renders an abnormal region's own text instead of 'Normal.'", () => {
    const text = buildFindingsText({
      useStructured: true,
      findingsMap: { "lung fields": { normal: false, text: "Right lower lobe consolidation." } },
      rawFindings: "",
    });
    expect(text).toBe("LUNG FIELDS: Right lower lobe consolidation.");
  });

  it("uses an em-dash placeholder for an abnormal region with no text yet", () => {
    const text = buildFindingsText({
      useStructured: true,
      findingsMap: { "lung fields": { normal: false, text: "" } },
      rawFindings: "",
    });
    expect(text).toBe("LUNG FIELDS: —");
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
    expect(text).toBe("LUNG FIELDS: Normal.\n\nHEART: Cardiomegaly.");
  });

  it("respects title_case heading formatting", () => {
    const text = buildFindingsText({
      useStructured: true,
      findingsMap: { "lung fields": { normal: true, text: "" } },
      rawFindings: "",
      headingCase: "title_case",
    });
    expect(text).toBe("Lung Fields: Normal.");
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

  it("skips a ref with no usable UIDs without calling fetch for it", async () => {
    const fetchImpl = vi.fn();
    const result = await fetchKeyImageDataUrls(
      "https://pacs.example/dicomweb",
      [makeRef({ id: 1, studyInstanceUid: null })],
      { fetchImpl },
    );
    expect(result).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("skips an image whose fetch response is not ok, keeping the rest", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false });
    const result = await fetchKeyImageDataUrls(
      "https://pacs.example/dicomweb",
      [makeRef({ id: 1 })],
      { fetchImpl },
    );
    expect(result).toEqual([]);
  });

  it("skips an image whose fetch throws, without failing the whole batch", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    const result = await fetchKeyImageDataUrls(
      "https://pacs.example/dicomweb",
      [makeRef({ id: 1 })],
      { fetchImpl },
    );
    expect(result).toEqual([]);
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
    // When fetch fails, HTML unchanged
    const unchanged = await hydratePrintPreviewKeyImages(empty, "https://pacs.example/dicomweb", [makeRef()], {
      fetchImpl: vi.fn().mockResolvedValue({ ok: false }),
    });
    expect(unchanged).toBe(empty);

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
