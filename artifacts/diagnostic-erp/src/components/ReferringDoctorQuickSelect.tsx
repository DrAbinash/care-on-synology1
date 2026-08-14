/**
 * One-tap referring-doctor chips for Radiology Reporting Workspace.
 *
 * Sources (merged, de-duped):
 *   1. Staff Billing Desk quick-doctor slots (/api/my/quick-doctors) — the
 *      same few doctors reception already pinned.
 *   2. Frequent names from recent worklist rows (last 120 days).
 *   3. Optional full doctor search for everyone else.
 *
 * Clicking a chip PATCHes the worklist (+ linked study) referring doctor.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { useToast } from "@/hooks/use-toast";
import { Search, X, Pencil } from "lucide-react";

type Doctor = { id: number; name: string };
type Frequent = { name: string; count: number };

function normalizeKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function shortLabel(name: string): string {
  // "Dr. Abinash Singh, MD" → keep readable but chip-friendly
  return name.replace(/^dr\.?\s*/i, "").replace(/,\s*[A-Z.]+(?:\s*,\s*[A-Z.]+)*\s*$/i, "").trim() || name;
}

export default function ReferringDoctorQuickSelect({
  worklistId,
  currentName,
  disabled,
}: {
  worklistId: number;
  currentName: string | null | undefined;
  disabled?: boolean;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [addValue, setAddValue] = useState("");

  const { data: myQuick } = useQuery<{ quickDoctorIds?: string }>({
    queryKey: ["my-quick-doctors"],
    queryFn: () => api.get("/api/my/quick-doctors"),
    staleTime: 5 * 60_000,
  });

  const { data: doctors = [] } = useQuery<Doctor[]>({
    queryKey: ["doctors-list"],
    queryFn: () => api.get<{ doctors: Doctor[] }>("/api/doctors").then((d) => d.doctors ?? []),
    staleTime: 5 * 60_000,
  });

  const { data: frequent } = useQuery<{ doctors: Frequent[] }>({
    queryKey: ["frequent-referring-doctors"],
    queryFn: () => api.get("/api/radiology/frequent-referring-doctors?limit=12"),
    staleTime: 5 * 60_000,
  });

  const chips = useMemo(() => {
    const out: { name: string; source: "quick" | "frequent" }[] = [];
    const seen = new Set<string>();

    let slotIds: (number | null)[] = [];
    try {
      const parsed = JSON.parse(myQuick?.quickDoctorIds || "[]");
      if (Array.isArray(parsed)) slotIds = parsed;
    } catch { /* ignore */ }

    for (const id of slotIds) {
      if (id == null) continue;
      const doc = doctors.find((d) => d.id === id);
      if (!doc?.name) continue;
      const key = normalizeKey(doc.name);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name: doc.name, source: "quick" });
    }

    for (const f of frequent?.doctors ?? []) {
      const key = normalizeKey(f.name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ name: f.name, source: "frequent" });
      if (out.length >= 8) break;
    }

    return out;
  }, [myQuick?.quickDoctorIds, doctors, frequent?.doctors]);

  const filteredDoctors = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return doctors.slice(0, 12);
    return doctors.filter((d) => d.name.toLowerCase().includes(q)).slice(0, 12);
  }, [doctors, search]);

  const setMut = useMutation({
    mutationFn: (referringDoctor: string) =>
      api.patch<{ ok: boolean; referringDoctor: string | null }>(
        `/api/radiology/pacs-worklist/${worklistId}/referring-doctor`,
        { referringDoctor },
      ),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["workspace-entry", worklistId] });
      toast({
        title: data.referringDoctor ? "Referring doctor set" : "Referring doctor cleared",
        description: data.referringDoctor || "Cleared",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Could not set referring doctor", description: err.message, variant: "destructive" });
    },
  });

  const currentKey = normalizeKey(currentName || "");
  const busy = disabled || setMut.isPending;

  return (
    <div className="col-span-2 mt-0.5 space-y-1.5" data-testid="ref-doctor-quick-select">
      <div className="flex flex-wrap gap-1">
        {chips.map((c) => {
          const selected = currentKey !== "" && normalizeKey(c.name) === currentKey;
          return (
            <span key={`${c.source}:${c.name}`} className="inline-flex items-center max-w-[11rem]">
              <button
                type="button"
                disabled={busy}
                title={c.name}
                onClick={() => {
                  if (selected) return;
                  setMut.mutate(c.name);
                }}
                className={[
                  "max-w-[9.5rem] truncate rounded-l border px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                  selected
                    ? "border-sky-600 bg-sky-600 text-white"
                    : "border-sky-200 bg-sky-50 text-sky-900 hover:border-sky-400 hover:bg-sky-100",
                  busy ? "opacity-60" : "",
                ].join(" ")}
              >
                {shortLabel(c.name)}
              </button>
              <button
                type="button"
                disabled={busy}
                title="Edit degrees / name"
                className={[
                  "rounded-r border border-l-0 px-1 py-0.5 text-sky-800",
                  selected ? "border-sky-600 bg-sky-600 text-white" : "border-sky-200 bg-sky-50 hover:bg-sky-100",
                ].join(" ")}
                onClick={() => {
                  setEditingName(c.name);
                  setEditValue(c.name);
                }}
              >
                <Pencil size={9} />
              </button>
            </span>
          );
        })}
        <input
          className="h-[22px] w-28 rounded border border-dashed border-muted-foreground/40 bg-background px-1.5 text-[10px]"
          placeholder="Add doctor…"
          value={addValue}
          disabled={busy}
          data-testid="ref-doctor-add-box"
          onChange={(e) => setAddValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const name = addValue.trim();
              if (name) {
                setMut.mutate(name);
                setAddValue("");
              }
            }
          }}
          title="Type a new referring doctor and press Enter"
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => setSearchOpen((v) => !v)}
          className="inline-flex items-center gap-0.5 rounded border border-dashed border-muted-foreground/40 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:border-sky-400 hover:text-sky-800"
          title="Search all doctors"
        >
          <Search size={10} />
          More
        </button>
        {currentName ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => setMut.mutate("")}
            className="inline-flex items-center gap-0.5 rounded border border-transparent px-1 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
            title="Clear referring doctor"
          >
            <X size={10} />
            Clear
          </button>
        ) : null}
      </div>

      {editingName && (
        <div className="rounded border bg-background p-1.5 shadow-sm" data-testid="ref-doctor-edit-degrees">
          <p className="text-[10px] text-muted-foreground mb-1">Add degrees (MD, MBBS, DNB…)</p>
          <input
            className="mb-1 h-7 w-full rounded border px-2 text-xs"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && editValue.trim()) {
                setMut.mutate(editValue.trim());
                setEditingName(null);
              }
              if (e.key === "Escape") setEditingName(null);
            }}
          />
          <div className="flex justify-end gap-1">
            <button type="button" className="text-[10px] px-1.5 py-0.5" onClick={() => setEditingName(null)}>Cancel</button>
            <button
              type="button"
              className="text-[10px] px-1.5 py-0.5 rounded bg-sky-600 text-white"
              onClick={() => {
                if (editValue.trim()) setMut.mutate(editValue.trim());
                setEditingName(null);
              }}
            >
              Save
            </button>
          </div>
        </div>
      )}

      {searchOpen && (
        <div className="rounded border bg-background p-1.5 shadow-sm">
          <input
            className="mb-1 h-7 w-full rounded border px-2 text-xs"
            placeholder="Search referring doctor…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          <div className="max-h-32 overflow-y-auto">
            {filteredDoctors.length === 0 ? (
              <div className="px-1 py-2 text-[10px] text-muted-foreground">No doctors found</div>
            ) : (
              filteredDoctors.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setMut.mutate(d.name);
                    setSearchOpen(false);
                    setSearch("");
                  }}
                  className="block w-full truncate rounded px-1.5 py-1 text-left text-[11px] hover:bg-sky-50"
                >
                  {d.name}
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {chips.length === 0 && !searchOpen && (
        <p className="text-[10px] text-muted-foreground">
          Pin doctors on Billing Desk quick slots, or use More to search.
        </p>
      )}
    </div>
  );
}
