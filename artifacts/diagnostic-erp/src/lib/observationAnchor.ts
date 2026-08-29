/**
 * ObservationAnchor — creation-time image provenance snapshot.
 * FRAMES-first; OHIF secondary; Weasis may be unavailable.
 * Anchor ≠ proof of diagnostic review.
 */

export type ObservationViewerKind = "frames" | "ohif" | "weasis";

export type ObservationAnchor = {
  studyInstanceUID: string;
  seriesInstanceUID?: string;
  sopInstanceUID?: string;
  frameNumber?: number;
  instanceNumber?: number;
  seriesDescription?: string;
  totalFrames?: number;
  viewer?: ObservationViewerKind;
  capturedAt: string;
};

/** Ephemeral FRAMES/OHIF viewport context (becomes an ObservationAnchor when stamped). */
export type ViewportContext = {
  studyInstanceUID: string;
  seriesInstanceUID?: string;
  sopInstanceUID?: string;
  frameNumber?: number;
  instanceNumber?: number;
  seriesDescription?: string;
  totalFrames?: number;
  viewer: ObservationViewerKind;
};

export function viewportToAnchor(ctx: ViewportContext): ObservationAnchor {
  return {
    studyInstanceUID: ctx.studyInstanceUID,
    seriesInstanceUID: ctx.seriesInstanceUID,
    sopInstanceUID: ctx.sopInstanceUID,
    frameNumber: ctx.frameNumber,
    instanceNumber: ctx.instanceNumber,
    seriesDescription: ctx.seriesDescription,
    totalFrames: ctx.totalFrames,
    viewer: ctx.viewer,
    capturedAt: new Date().toISOString(),
  };
}

export function anchorsEqual(a: ObservationAnchor | null | undefined, b: ObservationAnchor | null | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    a.studyInstanceUID === b.studyInstanceUID
    && (a.seriesInstanceUID ?? "") === (b.seriesInstanceUID ?? "")
    && (a.sopInstanceUID ?? "") === (b.sopInstanceUID ?? "")
    && (a.frameNumber ?? 0) === (b.frameNumber ?? 0)
    && (a.instanceNumber ?? 0) === (b.instanceNumber ?? 0)
    && (a.seriesDescription ?? "") === (b.seriesDescription ?? "")
    && (a.viewer ?? "") === (b.viewer ?? "")
  );
}

export function viewportContextsEqual(a: ViewportContext | null | undefined, b: ViewportContext | null | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    a.studyInstanceUID === b.studyInstanceUID
    && (a.seriesInstanceUID ?? "") === (b.seriesInstanceUID ?? "")
    && (a.sopInstanceUID ?? "") === (b.sopInstanceUID ?? "")
    && (a.frameNumber ?? 0) === (b.frameNumber ?? 0)
    && (a.instanceNumber ?? 0) === (b.instanceNumber ?? 0)
    && (a.seriesDescription ?? "") === (b.seriesDescription ?? "")
    && a.viewer === b.viewer
    && (a.totalFrames ?? 0) === (b.totalFrames ?? 0)
  );
}

/** Compact chip label from available metadata — never invent anatomy. */
export function formatAnchorChip(anchor: ObservationAnchor | null | undefined): string {
  if (!anchor?.studyInstanceUID) return "VIEWER CONTEXT UNAVAILABLE";
  const parts: string[] = [];
  const desc = (anchor.seriesDescription ?? "").trim();
  if (desc) parts.push(desc);
  if (anchor.frameNumber != null && anchor.totalFrames != null && anchor.totalFrames > 0) {
    parts.push(`Image ${anchor.frameNumber} / ${anchor.totalFrames}`);
  } else if (anchor.frameNumber != null) {
    parts.push(`Image ${anchor.frameNumber}`);
  } else if (anchor.instanceNumber != null) {
    parts.push(`Inst ${anchor.instanceNumber}`);
  }
  if (parts.length === 0) {
    if (anchor.seriesInstanceUID) parts.push(`Series …${anchor.seriesInstanceUID.slice(-8)}`);
    else parts.push(anchor.viewer ? `Viewer: ${anchor.viewer}` : "Image context");
  }
  return parts.join(" · ");
}

export function isValidObservationAnchor(raw: unknown): raw is ObservationAnchor {
  if (!raw || typeof raw !== "object") return false;
  const o = raw as Record<string, unknown>;
  return typeof o.studyInstanceUID === "string" && o.studyInstanceUID.trim().length > 0;
}

export function coerceObservationAnchor(raw: unknown): ObservationAnchor | undefined {
  if (!isValidObservationAnchor(raw)) return undefined;
  const o = raw as ObservationAnchor;
  return {
    studyInstanceUID: o.studyInstanceUID,
    seriesInstanceUID: o.seriesInstanceUID,
    sopInstanceUID: o.sopInstanceUID,
    frameNumber: typeof o.frameNumber === "number" ? o.frameNumber : undefined,
    instanceNumber: typeof o.instanceNumber === "number" ? o.instanceNumber : undefined,
    seriesDescription: o.seriesDescription,
    totalFrames: typeof o.totalFrames === "number" ? o.totalFrames : undefined,
    viewer: o.viewer === "frames" || o.viewer === "ohif" || o.viewer === "weasis" ? o.viewer : undefined,
    capturedAt: typeof o.capturedAt === "string" ? o.capturedAt : new Date().toISOString(),
  };
}
