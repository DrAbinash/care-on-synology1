/**
 * FrozenKeyImagesRail — compact Reporting Canvas R2 rail for frozen viewport captures.
 * Print inclusion (`includeInReport`) is independent of AI selection.
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, ChevronDown, ChevronRight, Trash2, Unlink, Check, X, Sparkles, ScanLine, ArrowUp, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/fetchApi";
import { fetchKeyImageAccessUrls } from "@/lib/keyImageAccess";
import { KeyImageWithAccess } from "@/components/radiology/KeyImageWithAccess";
import { readStaffSession } from "@/lib/staffSession";
import { COMPOSER_MAX_SELECTED_KEY_IMAGES } from "@/lib/reportComposer/types";

export type FrozenKeyImage = {
  id: number;
  draftId: number | null;
  imageUrl: string;
  thumbnailUrl: string | null;
  caption: string;
  captionManual: boolean;
  sortOrder: number;
  includeInReport: boolean;
  sourceType: string;
  observationId: string | null;
  seriesInstanceUid?: string | null;
  sopInstanceUid?: string | null;
  seriesDescription: string | null;
  frameNumber: number | null;
  modality: string | null;
  viewer: string | null;
  capturedAt: string | null;
};

/** Eligible frozen key images for AI selection (stored raster captures only). */
export function isEligibleForAiSelection(img: FrozenKeyImage): boolean {
  const url = (img.imageUrl || "").toLowerCase();
  return (
    url.includes("/uploads/radiology-key-images/") &&
    (url.endsWith(".jpg") ||
      url.endsWith(".jpeg") ||
      url.endsWith(".png") ||
      url.endsWith(".webp") ||
      /\.(jpe?g|png|webp)(\?|$)/i.test(url))
  );
}

export function frozenKeyImagesQueryKey(draftId: number | null | undefined) {
  return ["frozen-key-images", draftId ?? null] as const;
}

export function useFrozenKeyImages(draftId: number | null | undefined) {
  return useQuery<{ success: boolean; items: FrozenKeyImage[] }>({
    queryKey: frozenKeyImagesQueryKey(draftId),
    queryFn: () =>
      api.get(`/api/radiology/report-generator/key-images?draftId=${draftId}`),
    enabled: !!draftId,
    staleTime: 5_000,
  });
}

export default function FrozenKeyImagesRail({
  draftId,
  disabled,
  filterObservationId,
  observationLabels,
  onFocusObservation,
  aiSelectedIds,
  onAiSelectedIdsChange,
  onCaptureRequest,
  captureBusy,
  captureBlockedTitle,
  onPickFromPacs,
  pacsBlockedTitle,
}: {
  draftId: number | null;
  disabled?: boolean;
  filterObservationId?: string | null;
  observationLabels?: Record<string, string>;
  onFocusObservation?: (observationId: string) => void;
  /** Session AI selection — independent of includeInReport. */
  aiSelectedIds?: number[];
  onAiSelectedIdsChange?: (ids: number[]) => void;
  /** Capture frozen viewport from the active viewer (Frames or OHIF Annotate). */
  onCaptureRequest?: () => void;
  captureBusy?: boolean;
  /** When set, the camera stays visible but cannot start an OHIF annotated capture. */
  captureBlockedTitle?: string;
  /**
   * Opens the Orthanc series/instance picker. This is the path that must work
   * with no viewer at all, so it is deliberately independent of `ohifUnavailable`
   * and of whether a draft exists yet — the host creates one silently.
   */
  onPickFromPacs?: () => void;
  pacsBlockedTitle?: string;
}) {
  const [open, setOpen] = useState(true);
  const [preview, setPreview] = useState<FrozenKeyImage | null>(null);
  const qc = useQueryClient();
  const q = useFrozenKeyImages(draftId);

  const items = useMemo(() => {
    const all = q.data?.items ?? [];
    if (!filterObservationId) return all;
    return all.filter((i) => i.observationId === filterObservationId);
  }, [q.data?.items, filterObservationId]);

  // One grant request for the whole rail instead of one per thumbnail; the
  // images then read the shared cache. See components/radiology/KeyImageWithAccess.tsx.
  useEffect(() => {
    const ids = items.map((i) => i.id);
    if (ids.length === 0) return;
    void fetchKeyImageAccessUrls(ids);
  }, [items]);

  const aiSelected = useMemo(() => new Set(aiSelectedIds ?? []), [aiSelectedIds]);
  const eligibleItems = useMemo(() => items.filter(isEligibleForAiSelection), [items]);
  const aiSelectionEnabled = typeof onAiSelectedIdsChange === "function";
  const canCapture = typeof onCaptureRequest === "function" && !disabled;
  const captureBlocked = Boolean(captureBlockedTitle);
  const canPickFromPacs = typeof onPickFromPacs === "function" && !disabled && !pacsBlockedTitle;

  const toggleAi = (id: number) => {
    if (!onAiSelectedIdsChange || disabled) return;
    const next = new Set(aiSelected);
    if (next.has(id)) next.delete(id);
    else {
      if (next.size >= COMPOSER_MAX_SELECTED_KEY_IMAGES) return;
      next.add(id);
    }
    onAiSelectedIdsChange([...next]);
  };

  const selectAllEligible = () => {
    if (!onAiSelectedIdsChange || disabled) return;
    onAiSelectedIdsChange(
      eligibleItems.slice(0, COMPOSER_MAX_SELECTED_KEY_IMAGES).map((i) => i.id),
    );
  };

  const clearAiSelection = () => {
    if (!onAiSelectedIdsChange || disabled) return;
    onAiSelectedIdsChange([]);
  };

  const patchMut = useMutation({
    mutationFn: (opts: { id: number; body: Record<string, unknown> }) =>
      api.put(`/api/radiology/report-generator/key-images/${opts.id}`, opts.body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: frozenKeyImagesQueryKey(draftId) }),
  });

  const delMut = useMutation({
    mutationFn: (id: number) =>
      api.delete(`/api/radiology/report-generator/key-images/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: frozenKeyImagesQueryKey(draftId) }),
  });

  // Reorder sends the draft's whole id list so every row gets a distinct
  // sortOrder — a partial list would renumber only the ids it names and leave
  // the rest colliding on the same positions.
  const orderMut = useMutation({
    mutationFn: (orderedIds: number[]) =>
      api.post("/api/radiology/report-generator/key-images/reorder", { draftId, orderedIds }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: frozenKeyImagesQueryKey(draftId) }),
  });

  const move = (id: number, dir: -1 | 1) => {
    const all = q.data?.items ?? [];
    const i = all.findIndex((r) => r.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= all.length) return;
    const next = all.map((r) => r.id);
    [next[i], next[j]] = [next[j], next[i]];
    orderMut.mutate(next);
  };

  if (!draftId) {
    return (
      <div className="border-t border-border px-2 py-1.5" data-testid="frozen-key-images-rail-empty">
        {canPickFromPacs && !disabled ? (
          <Button
            type="button"
            size="sm"
            className="h-7 w-full justify-center gap-1.5 bg-indigo-600 text-[11px] font-bold uppercase tracking-wide text-white hover:bg-indigo-700"
            onClick={onPickFromPacs}
            data-testid="select-images-from-pacs"
          >
            <ScanLine className="h-3.5 w-3.5" />
            Select images from PACS
          </Button>
        ) : (
          <p className="text-[10px] text-muted-foreground">Save a draft to capture key images.</p>
        )}
      </div>
    );
  }

  return (
    <div className="border-t border-border shrink-0" data-testid="frozen-key-images-rail">
      <div className="flex items-center gap-1 px-2 py-1.5">
        <button
          type="button"
          className="flex flex-1 items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-700 hover:bg-muted/40 rounded"
          onClick={() => setOpen((v) => !v)}
          data-testid="frozen-key-images-rail-toggle"
        >
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          Key Images ({items.length})
          {aiSelectionEnabled && aiSelected.size > 0 ? (
            <Badge variant="outline" className="text-[9px] h-4 border-violet-300 text-violet-800" data-testid="frozen-key-images-ai-count">
              AI {aiSelected.size}/{COMPOSER_MAX_SELECTED_KEY_IMAGES}
            </Badge>
          ) : null}
          {filterObservationId ? <Badge variant="outline" className="text-[9px] h-4">filtered</Badge> : null}
        </button>
        {typeof onPickFromPacs === "function" && !disabled ? (
          <Button
            type="button"
            size="sm"
            variant={canPickFromPacs ? "default" : "outline"}
            className="h-6 shrink-0 gap-1 bg-indigo-600 px-1.5 text-[9px] font-bold uppercase tracking-wide hover:bg-indigo-700"
            title={pacsBlockedTitle ?? "Browse this study's sequences in PACS and attach chosen images to the report"}
            data-testid="select-images-from-pacs"
            onClick={(e) => {
              e.stopPropagation();
              if (!canPickFromPacs) return;
              onPickFromPacs();
            }}
            disabled={!canPickFromPacs}
          >
            <ScanLine className="h-3 w-3" />
            Select images from PACS
          </Button>
        ) : null}
        {canCapture || captureBlocked ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0 shrink-0 text-sky-700 hover:text-sky-900 hover:bg-sky-50"
            title={captureBlocked ? captureBlockedTitle : captureBusy ? "Capturing…" : "Capture key image from active viewer"}
            data-testid="frozen-key-images-capture"
            disabled={!!captureBusy || captureBlocked}
            onClick={(e) => {
              e.stopPropagation();
              if (captureBlocked) return;
              onCaptureRequest?.();
            }}
          >
            <Camera className={`h-3.5 w-3.5 ${captureBusy ? "animate-pulse" : ""}`} />
            <span className="sr-only">{captureBusy ? "Capturing" : "Capture key image"}</span>
          </Button>
        ) : (
          <span className="inline-flex h-6 w-6 items-center justify-center text-slate-400" aria-hidden>
            <Camera className="h-3.5 w-3.5" />
          </span>
        )}
        {aiSelectionEnabled && !disabled && eligibleItems.length > 0 ? (
          <div className="flex gap-0.5 shrink-0">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-5 px-1 text-[9px]"
              title="Select all eligible for AI"
              data-testid="frozen-key-images-ai-select-all"
              onClick={selectAllEligible}
            >
              AI all
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-5 px-1 text-[9px]"
              title="Clear AI selection"
              data-testid="frozen-key-images-ai-clear"
              onClick={clearAiSelection}
              disabled={aiSelected.size === 0}
            >
              Clear AI
            </Button>
          </div>
        ) : null}
      </div>
      {open && (
        <div className="flex gap-2 overflow-x-auto px-2 pb-2">
          {items.length === 0 ? (
            <p className="text-[10px] text-muted-foreground py-2" data-testid="frozen-key-images-empty-hint">
              {canCapture
                ? "No frozen captures yet. Click the camera to capture the active viewer, or use Capture key image in Frames mode."
                : "No frozen captures yet. Use Capture key image in Frames mode."}
            </p>
          ) : (
            items.map((img) => {
              const label = img.observationId
                ? (observationLabels?.[img.observationId] || "Linked")
                : "Report";
              const eligible = isEligibleForAiSelection(img);
              const forAi = aiSelected.has(img.id);
              return (
                <div
                  key={img.id}
                  className={`w-[112px] shrink-0 rounded border bg-white overflow-hidden ${forAi ? "ring-2 ring-violet-400 border-violet-300" : ""}`}
                  data-testid={`frozen-key-image-${img.id}`}
                  data-ai-selected={forAi ? "1" : "0"}
                >
                  <button
                    type="button"
                    className="block w-full aspect-square bg-black"
                    onClick={() => setPreview(img)}
                    title="Preview"
                  >
                    <KeyImageWithAccess
                      id={img.id}
                      src={img.thumbnailUrl || img.imageUrl}
                      variant="thumbnail"
                      alt={img.caption || "Key image"}
                      className="h-full w-full object-contain"
                      loading="lazy"
                    />
                  </button>
                  <div className="px-1.5 py-1 space-y-0.5">
                    <p className="text-[9px] font-medium text-slate-800 line-clamp-2" title={img.caption}>
                      {img.caption || "Untitled"}
                    </p>
                    <div className="flex flex-wrap items-center gap-1 text-[8px] text-slate-500">
                      <span className="truncate">{label}</span>
                      {img.sourceType === "DICOM" && img.sopInstanceUid ? (
                        <span
                          className="shrink-0 font-semibold text-indigo-700"
                          title="Attached from PACS by the image picker"
                          data-testid={`frozen-key-image-pacs-badge-${img.id}`}
                        >
                          PACS
                        </span>
                      ) : null}
                      {img.includeInReport ? (
                        <span className="text-emerald-700 shrink-0">✓ report</span>
                      ) : (
                        <span className="text-slate-400 shrink-0">excluded</span>
                      )}
                      {forAi ? (
                        <span className="text-violet-700 shrink-0 font-semibold" data-testid={`frozen-key-image-ai-badge-${img.id}`}>
                          AI selected
                        </span>
                      ) : null}
                    </div>
                    {!disabled && (
                      <div className="flex flex-wrap gap-0.5 pt-0.5">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-5 px-1 text-[9px] text-slate-500"
                          title="Move earlier in the report"
                          data-testid={`frozen-key-image-up-${img.id}`}
                          onClick={() => move(img.id, -1)}
                        >
                          <ArrowUp className="h-3 w-3" />
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-5 px-1 text-[9px] text-slate-500"
                          title="Move later in the report"
                          data-testid={`frozen-key-image-down-${img.id}`}
                          onClick={() => move(img.id, 1)}
                        >
                          <ArrowDown className="h-3 w-3" />
                        </Button>
                        {aiSelectionEnabled && eligible ? (
                          <Button
                            type="button"
                            size="sm"
                            variant={forAi ? "default" : "ghost"}
                            className={`h-5 px-1 text-[9px] ${forAi ? "bg-violet-600 hover:bg-violet-700" : ""}`}
                            title={forAi ? "Deselect for AI" : "Select for AI draft"}
                            data-testid={`frozen-key-image-ai-toggle-${img.id}`}
                            onClick={() => toggleAi(img.id)}
                          >
                            <Sparkles className="h-3 w-3" />
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-5 px-1 text-[9px]"
                          title={img.includeInReport ? "Exclude from report" : "Include in report"}
                          onClick={() =>
                            patchMut.mutate({
                              id: img.id,
                              body: { includeInReport: !img.includeInReport },
                            })
                          }
                        >
                          {img.includeInReport ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                        </Button>
                        {img.observationId && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-5 px-1 text-[9px]"
                            title="Detach to report-level"
                            onClick={() =>
                              patchMut.mutate({ id: img.id, body: { observationId: null } })
                            }
                          >
                            <Unlink className="h-3 w-3" />
                          </Button>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-5 px-1 text-[9px] text-destructive"
                          title="Delete"
                          onClick={() => {
                            if (window.confirm("Delete this key image?")) {
                              if (aiSelected.has(img.id) && onAiSelectedIdsChange) {
                                onAiSelectedIdsChange(aiSelectedIds!.filter((x) => x !== img.id));
                              }
                              delMut.mutate(img.id);
                            }
                          }}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                    {img.observationId && onFocusObservation && (
                      <button
                        type="button"
                        className="text-[8px] text-sky-700 underline"
                        onClick={() => onFocusObservation(img.observationId!)}
                      >
                        Show observation
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {preview && (
        <div
          className="fixed inset-0 z-[80] bg-black/70 flex items-center justify-center p-4"
          onClick={() => setPreview(null)}
          data-testid="frozen-key-image-preview"
        >
          <div
            className="max-w-3xl w-full bg-white rounded-lg overflow-hidden shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <KeyImageWithAccess
              id={preview.id}
              src={preview.imageUrl}
              alt={preview.caption}
              className="w-full max-h-[70vh] object-contain bg-black"
              loading="eager"
            />
            <div className="p-3 space-y-2">
              {disabled ? (
                <p className="text-sm">{preview.caption}</p>
              ) : (
                <input
                  className="w-full border rounded px-2 py-1 text-sm"
                  defaultValue={preview.caption}
                  onBlur={(e) => {
                    const caption = e.target.value.slice(0, 500);
                    if (caption !== preview.caption) {
                      patchMut.mutate({ id: preview.id, body: { caption, captionManual: true } });
                    }
                  }}
                />
              )}
              <div className="flex justify-end">
                <Button type="button" size="sm" variant="outline" onClick={() => setPreview(null)}>
                  Close
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Multipart upload helper for viewport capture / file upload. */
export async function uploadFrozenKeyImage(form: FormData): Promise<FrozenKeyImage> {
  const session = readStaffSession();
  const res = await fetch("/api/radiology/report-generator/key-images", {
    method: "POST",
    headers: session?.token ? { Authorization: `Bearer ${session.token}` } : {},
    body: form,
  });
  const data = (await res.json()) as { success?: boolean; item?: FrozenKeyImage; error?: string };
  if (!res.ok || !data.item) {
    throw new Error(data.error || `Upload failed (${res.status})`);
  }
  return data.item;
}
