/**
 * FrozenKeyImagesRail — compact Reporting Canvas R2 rail for frozen viewport captures.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, ChevronDown, ChevronRight, Trash2, Unlink, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/fetchApi";
import { readStaffSession } from "@/lib/staffSession";

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
  seriesDescription: string | null;
  frameNumber: number | null;
  modality: string | null;
  viewer: string | null;
  capturedAt: string | null;
};

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
}: {
  draftId: number | null;
  disabled?: boolean;
  filterObservationId?: string | null;
  observationLabels?: Record<string, string>;
  onFocusObservation?: (observationId: string) => void;
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

  if (!draftId) {
    return (
      <div className="border-t border-border px-2 py-1.5 text-[10px] text-muted-foreground" data-testid="frozen-key-images-rail-empty">
        Save a draft to capture key images.
      </div>
    );
  }

  return (
    <div className="border-t border-border shrink-0" data-testid="frozen-key-images-rail">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-700 hover:bg-muted/40"
        onClick={() => setOpen((v) => !v)}
        data-testid="frozen-key-images-rail-toggle"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <Camera className="h-3 w-3" />
        Key Images ({items.length})
        {filterObservationId ? <Badge variant="outline" className="text-[9px] h-4">filtered</Badge> : null}
      </button>
      {open && (
        <div className="flex gap-2 overflow-x-auto px-2 pb-2">
          {items.length === 0 ? (
            <p className="text-[10px] text-muted-foreground py-2">
              No frozen captures yet. Use Capture key image in Frames mode.
            </p>
          ) : (
            items.map((img) => {
              const label = img.observationId
                ? (observationLabels?.[img.observationId] || "Linked")
                : "Report";
              return (
                <div
                  key={img.id}
                  className="w-[112px] shrink-0 rounded border bg-white overflow-hidden"
                  data-testid={`frozen-key-image-${img.id}`}
                >
                  <button
                    type="button"
                    className="block w-full aspect-square bg-black"
                    onClick={() => setPreview(img)}
                    title="Preview"
                  >
                    <img
                      src={img.thumbnailUrl || img.imageUrl}
                      alt={img.caption || "Key image"}
                      className="h-full w-full object-contain"
                      loading="lazy"
                    />
                  </button>
                  <div className="px-1.5 py-1 space-y-0.5">
                    <p className="text-[9px] font-medium text-slate-800 line-clamp-2" title={img.caption}>
                      {img.caption || "Untitled"}
                    </p>
                    <div className="flex items-center gap-1 text-[8px] text-slate-500">
                      <span className="truncate">{label}</span>
                      {img.includeInReport ? (
                        <span className="text-emerald-700 shrink-0">✓ report</span>
                      ) : (
                        <span className="text-slate-400 shrink-0">excluded</span>
                      )}
                    </div>
                    {!disabled && (
                      <div className="flex flex-wrap gap-0.5 pt-0.5">
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
                            if (window.confirm("Delete this key image?")) delMut.mutate(img.id);
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
            <img src={preview.imageUrl} alt={preview.caption} className="w-full max-h-[70vh] object-contain bg-black" />
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
