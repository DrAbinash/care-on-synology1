/**
 * ImageFramingEditor — report-presentation crop/zoom for a fixed 4:3 viewport.
 * Photograph-in-a-frame: the viewport never resizes; the image moves/scales
 * inside it. Apply writes framing JSON to the image-reference row. DICOM is
 * never modified.
 *
 * E-2 — the editor also carries the VOI (window width/center) the image was
 * VIEWED under: the CT an image was picked at the wrong window in can be
 * re-windowed here instead of re-picked from PACS. The window lives in the
 * same presentationJson slot as the framing (P2-4's one-slot rule), rides the
 * same PATCH, and its parameters are appended to the preview/thumbnail URLs
 * (applyVoiToRenderedUrl) so the panel, print hydrate and this preview show
 * the same window. "Use PACS window" restores the no-claim state — the frozen
 * render then keeps the PACS's own windowing.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DEFAULT_IMAGE_FRAMING,
  detectContentBoundingBox,
  framingImgStyle,
  parseImageFraming,
  parseImageVoi,
  suggestFramingFromBox,
  type ImageFraming,
  type ImageVoi,
} from "@/lib/imageFraming";
import { applyVoiToRenderedUrl } from "@/lib/reportImageRefs";

/** E-2 — common CT windows. Well-known display conventions, editable after
 *  selection; the numbers are a starting point, never a clinical decision. */
const VOI_PRESETS: Array<{ label: string; voi: ImageVoi }> = [
  { label: "Brain", voi: { windowWidth: 80, windowCenter: 40 } },
  { label: "Soft tissue", voi: { windowWidth: 400, windowCenter: 40 } },
  { label: "Lung", voi: { windowWidth: 1500, windowCenter: -600 } },
  { label: "Bone", voi: { windowWidth: 2500, windowCenter: 480 } },
];

export default function ImageFramingEditor({
  open,
  imageSrc,
  caption,
  initial,
  onClose,
  onApply,
}: {
  open: boolean;
  imageSrc: string | null;
  caption: string;
  initial: unknown;
  onClose: () => void;
  /** E-2 — the window travels with the framing on Apply. Null means "no VOI
   *  claim" (the PACS's own window); it is sent explicitly so "Use PACS
   *  window" can clear a stored claim. */
  onApply: (framing: ImageFraming, voi: ImageVoi | null) => void;
}) {
  const [draft, setDraft] = useState<ImageFraming>(DEFAULT_IMAGE_FRAMING);
  const [voi, setVoi] = useState<ImageVoi | null>(null);
  const [autoHint, setAutoHint] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(parseImageFraming(initial));
      setVoi(parseImageVoi(initial));
      setAutoHint(null);
    }
  }, [open, initial]);

  function bumpZoom(delta: number) {
    setDraft((d) => parseImageFraming({ ...d, zoom: d.zoom + delta }));
  }

  useEffect(() => {
    if (!open) return;
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      bumpZoom(e.deltaY < 0 ? 0.08 : -0.08);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [open]);

  function onPointerDown(e: React.PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: draft.offsetX, oy: draft.offsetY };
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current || !viewportRef.current) return;
    const rect = viewportRef.current.getBoundingClientRect();
    const dx = ((e.clientX - drag.current.x) / rect.width) * 100;
    const dy = ((e.clientY - drag.current.y) / rect.height) * 100;
    setDraft(parseImageFraming({
      ...draft,
      offsetX: drag.current.ox + dx,
      offsetY: drag.current.oy + dy,
    }));
  }

  function onPointerUp() {
    drag.current = null;
  }

  function suggestFromImage() {
    if (!imageSrc) return;
    setAutoHint(null);
    const img = new Image();
    // A-12 — the load and the pixel read can both fail without throwing at
    // the call site (a CORS-tainted canvas throws inside getImageData; a
    // crossOrigin-rejected image never fires onload). Both paths now say so
    // instead of leaving the button looking dead.
    img.onerror = () => {
      setAutoHint("Auto needs the image to be readable from this page (cross-origin). Zoom and pan still work.");
    };
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const max = 160;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      canvas.width = Math.max(8, Math.round(img.width * scale));
      canvas.height = Math.max(8, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      try {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const box = detectContentBoundingBox(
          ctx.getImageData(0, 0, canvas.width, canvas.height).data,
          canvas.width,
          canvas.height,
        );
        if (box) setDraft(suggestFramingFromBox(box, canvas.width, canvas.height));
        else setAutoHint("Auto found no content box to crop to — zoom and pan still work.");
      } catch {
        setAutoHint("Auto could not read this image's pixels (cross-origin). Zoom and pan still work.");
      }
    };
    img.crossOrigin = "anonymous";
    img.src = imageSrc;
  }

  // E-2 — the preview re-windows live with the draft VOI (when the PACS
  // supports rendered window parameters; a server that does not keeps its
  // default window, which is what the printed render would have shown before
  // this change too).
  const previewSrc = applyVoiToRenderedUrl(imageSrc, voi);

  const setWw = (raw: string) => {
    const n = Number(raw);
    setVoi((v) => ({
      windowWidth: Number.isFinite(n) && n > 0 ? n : (v?.windowWidth ?? 400),
      windowCenter: v?.windowCenter ?? 40,
    }));
  };
  const setWc = (raw: string) => {
    const n = Number(raw);
    setVoi((v) => ({
      windowWidth: v?.windowWidth ?? 400,
      windowCenter: Number.isFinite(n) ? n : (v?.windowCenter ?? 40),
    }));
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-w-md p-4 gap-3" data-testid="image-framing-editor">
        <DialogHeader>
          <DialogTitle className="text-sm">Edit Framing — {caption || "Key image"}</DialogTitle>
        </DialogHeader>
        <p className="text-[11px] text-muted-foreground">
          Drag to pan. Scroll or +/− to zoom. The frame matches the Premium Report viewport.
        </p>
        <div
          ref={viewportRef}
          className="image-viewport relative mx-auto cursor-grab active:cursor-grabbing rounded-sm ring-2 ring-sky-400"
          style={{ width: 238, aspectRatio: "4 / 3", overflow: "hidden", background: "#000", touchAction: "none" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          data-testid="image-framing-viewport"
        >
          {previewSrc
            ? (
              <img
                src={previewSrc}
                alt={caption}
                draggable={false}
                className="absolute inset-0 h-full w-full"
                style={framingImgStyle(draft)}
              />
            )
            : <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">No preview</div>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => bumpZoom(-0.12)} data-testid="framing-zoom-out">−</Button>
          <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => bumpZoom(0.12)} data-testid="framing-zoom-plus">+</Button>
          <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => setDraft({ ...DEFAULT_IMAGE_FRAMING, fitMode: "contain" })} data-testid="framing-fit">Fit</Button>
          <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => setDraft({ ...DEFAULT_IMAGE_FRAMING, fitMode: "cover" })} data-testid="framing-fill">Fill</Button>
          <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => setDraft(DEFAULT_IMAGE_FRAMING)} data-testid="framing-reset">Reset</Button>
          <Button size="sm" variant="outline" className="h-7 px-2" onClick={suggestFromImage} data-testid="framing-auto">Auto</Button>
          <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">{draft.fitMode} · {draft.zoom.toFixed(2)}×</span>
        </div>
        {autoHint ? (
          <p className="text-[10px] text-amber-600 dark:text-amber-400" data-testid="framing-auto-hint">{autoHint}</p>
        ) : null}
        <div className="rounded-md border p-2 space-y-1.5" data-testid="framing-voi-section">
          <p className="text-[11px] font-medium">Window (W / C)</p>
          <p className="text-[10px] text-muted-foreground">
            The window the printed render uses. “Use PACS window” clears the claim — the report keeps the PACS’s own windowing.
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <Input
              type="number"
              value={voi?.windowWidth ?? ""}
              onChange={(e) => setWw(e.target.value)}
              placeholder="W"
              className="h-7 w-20 text-xs tabular-nums"
              data-testid="framing-voi-width"
              aria-label="Window width"
            />
            <Input
              type="number"
              value={voi?.windowCenter ?? ""}
              onChange={(e) => setWc(e.target.value)}
              placeholder="C"
              className="h-7 w-20 text-xs tabular-nums"
              data-testid="framing-voi-center"
              aria-label="Window center"
            />
            {VOI_PRESETS.map((p) => (
              <Button
                key={p.label}
                size="sm"
                variant="outline"
                className="h-7 px-2 text-[10px]"
                onClick={() => setVoi(p.voi)}
                data-testid={`framing-voi-preset-${p.label.toLowerCase().replace(/\s+/g, "-")}`}
                title={`W ${p.voi.windowWidth} / C ${p.voi.windowCenter}`}
              >
                {p.label}
              </Button>
            ))}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[10px]"
              onClick={() => setVoi(null)}
              data-testid="framing-voi-pacs"
              title="Clear the stored window claim — the report prints with the PACS's own windowing"
            >
              Use PACS window
            </Button>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={() => onApply(draft, voi)} data-testid="framing-apply">Apply</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
