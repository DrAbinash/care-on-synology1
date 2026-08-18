/**
 * ImageFramingEditor — report-presentation crop/zoom for a fixed 4:3 viewport.
 * Photograph-in-a-frame: the viewport never resizes; the image moves/scales
 * inside it. Apply writes framing JSON to the image-reference row. DICOM is
 * never modified.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
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
  suggestFramingFromBox,
  type ImageFraming,
} from "@/lib/imageFraming";

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
  onApply: (framing: ImageFraming) => void;
}) {
  const [draft, setDraft] = useState<ImageFraming>(DEFAULT_IMAGE_FRAMING);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) setDraft(parseImageFraming(initial));
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
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const max = 160;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      canvas.width = Math.max(8, Math.round(img.width * scale));
      canvas.height = Math.max(8, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const box = detectContentBoundingBox(
        ctx.getImageData(0, 0, canvas.width, canvas.height).data,
        canvas.width,
        canvas.height,
      );
      if (box) setDraft(suggestFramingFromBox(box, canvas.width, canvas.height));
    };
    img.src = imageSrc;
  }

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
          {imageSrc
            ? (
              <img
                src={imageSrc}
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
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={() => onApply(draft)} data-testid="framing-apply">Apply</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
