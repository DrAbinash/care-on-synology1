import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type { QueryObserverOptions } from "@tanstack/react-query";
import type { FrozenKeyImage } from "./FrozenKeyImagesRail";

const mocks = vi.hoisted(() => ({ get: vi.fn(), finalize: vi.fn(), query: vi.fn() }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (value: unknown) => [typeof value === "function" ? value() : value, vi.fn()],
  useRef: (current: unknown) => ({ current }),
  useMemo: (factory: () => unknown) => factory(),
  useCallback: (callback: unknown) => callback,
  useEffect: vi.fn(),
}));
vi.mock("@tanstack/react-query", async (original) => ({
  ...await original<typeof import("@tanstack/react-query")>(),
  useQuery: mocks.query,
}));
vi.mock("@/lib/fetchApi", () => ({ api: { get: mocks.get } }));
vi.mock("@/lib/radiologyReportPrintLiveMerge", () => ({ finalizePrintPreviewHtml: mocks.finalize }));
import ReportExportPanel, { type ReportExportPanelProps } from "./ReportExportPanel";

const image = (id: number): FrozenKeyImage => ({
  id, draftId: 77, caption: `Frame ${id}`, captionManual: true,
  imageUrl: `/synthetic/${id}.png`, thumbnailUrl: null, includeInReport: true, sourceType: "ohif",
  sortOrder: id, observationId: null, sopInstanceUid: "1.2.3", frameNumber: id,
  seriesDescription: null, modality: "MR", viewer: "ohif", capturedAt: null,
});
const noop = () => {};
const props = (): ReportExportPanelProps => ({
  draftId: 77, previewHtml: "<p>Loading</p>", reportLayout: "care-premium",
  onLayoutChange: noop, headingCase: "all_caps", onHeadingCaseChange: noop,
  sectionSpacing: "spaced", onSectionSpacingChange: noop,
  impressionStyle: "numbered", onImpressionStyleChange: noop,
  onExportWord: noop, onExportPdf: noop, frozenKeyImages: [image(1), image(2)],
});
function iframeHtml(node: unknown): string | undefined {
  if (Array.isArray(node)) return node.map(iframeHtml).find(v => v !== undefined);
  if (!node || typeof node !== "object") return undefined;
  const el = node as { type?: string; props?: { srcDoc?: string; children?: unknown } };
  return el.type === "iframe" ? el.props?.srcDoc : iframeHtml(el.props?.children);
}

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe("premium preview image changes", () => {
  it("refreshes the mounted query and iframe for caption, addition, inclusion, order and deletion", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let options: QueryObserverOptions<string>;
    let observer: QueryObserver<string> | undefined;
    let current = props();
    mocks.query.mockImplementation((next) => {
      options = next;
      return observer?.getCurrentResult() ?? { data: undefined, isFetching: false, refetch: noop };
    });
    mocks.get.mockImplementation(async () => `<p>${current.frozenKeyImages!.filter(i => i.includeInReport).map(i => i.caption).join(" | ")}</p>`);
    mocks.finalize.mockImplementation(async (html: string) => html);
    ReportExportPanel(current);
    observer = new QueryObserver(client, options!);
    const unsubscribe = observer.subscribe(noop);
    try {
      await vi.waitFor(() => expect(observer!.getCurrentResult().data).toBe("<p>Frame 1 | Frame 2</p>"));
      expect(iframeHtml(ReportExportPanel(current))).toBe("<p>Frame 1 | Frame 2</p>");
      const change = async (items: FrozenKeyImage[], expected: string) => {
        const before = mocks.get.mock.calls.length;
        current = { ...current, frozenKeyImages: items };
        ReportExportPanel(current);
        observer!.setOptions(options!);
        await vi.waitFor(() => expect(mocks.get.mock.calls.length).toBeGreaterThan(before));
        await vi.waitFor(() => expect(observer!.getCurrentResult().data).toBe(`<p>${expected}</p>`));
        expect(iframeHtml(ReportExportPanel(current))).toBe(`<p>${expected}</p>`);
      };
      await change([{ ...image(1), caption: "Corrected" }, image(2)], "Corrected | Frame 2");
      await change([...current.frozenKeyImages!, image(3)], "Corrected | Frame 2 | Frame 3");
      await change(current.frozenKeyImages!.map(i => i.id === 1 ? { ...i, includeInReport: false } : i), "Frame 2 | Frame 3");
      expect(mocks.finalize.mock.lastCall?.[1].frozenKeyImageIdentities).toEqual([
        { sopInstanceUid: "1.2.3", frameNumber: 2 }, { sopInstanceUid: "1.2.3", frameNumber: 3 },
      ]);
      await change(current.frozenKeyImages!.map(i => ({ ...i, includeInReport: true, caption: `${i.caption} included` })), "Corrected included | Frame 2 included | Frame 3 included");
      await change([...current.frozenKeyImages!].reverse().map((i, sortOrder) => ({ ...i, sortOrder })), "Frame 3 included | Frame 2 included | Corrected included");
      await change(current.frozenKeyImages!.filter(i => i.id !== 2), "Frame 3 included | Corrected included");
    } finally {
      unsubscribe(); client.clear();
    }
  });

  it("keys live picker captions but ignores mutable frozen rows for signed artifacts", () => {
    let options: QueryObserverOptions<string>;
    mocks.query.mockImplementation((next) => { options = next; return { data: "", isFetching: false, refetch: noop }; });
    const current = { ...props(), linkedReportId: 99 };
    ReportExportPanel(current);
    const signedKey = options!.queryKey;
    ReportExportPanel({ ...current, frozenKeyImages: [] });
    expect(options!.queryKey).toEqual(signedKey);
    const ref = { id: "r1", sopInstanceUid: "1.2.3", frameNumber: 1, caption: "Original" };
    ReportExportPanel({ ...props(), imageRefs: [ref as any] });
    const originalKey = options!.queryKey;
    ReportExportPanel({ ...props(), imageRefs: [{ ...ref, caption: "Corrected" } as any] });
    expect(options!.queryKey).not.toEqual(originalKey);
  });
});
