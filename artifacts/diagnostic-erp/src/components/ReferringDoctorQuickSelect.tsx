/**
 * One-tap referring-doctor chips for Radiology Reporting Workspace.
 * Degrees come from Settings → Doctors (doctors.degree).
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, X, Pencil } from "lucide-react";
import {
  formatDoctorWithDegree,
  enrichReferringDoctorFromDoctors,
  type DoctorCatalogRow,
} from "@/lib/reportDemography";

type Doctor = { id: number; name: string; degree?: string | null };
type Frequent = { name: string; count: number };

function matchKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^dr\.?\s*/i, "")
    .replace(/\b(md|mbbs|ms|mch|m\.ch|dnb|dm|frcr|frcs|frcp|mrcp|dmrd|fcps)\b/gi, "")
    .trim();
}

/** Keep degree on chip labels — Settings → Doctors is the source of truth. */
function chipLabel(name: string): string {
  return name.replace(/^dr\.?\s*/i, "").trim() || name;
}

function catalogLabel(doc: Doctor): string {
  return formatDoctorWithDegree(doc.name, doc.degree);
}

function findCatalogDoctor(doctors: Doctor[], name: string): Doctor | undefined {
  const key = matchKey(name);
  if (!key) return undefined;
  const exact = doctors.filter((d) => matchKey(catalogLabel(d)) === key || matchKey(d.name) === key);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return exact[0];
  return doctors.find((d) => {
    const k = matchKey(d.name);
    return k === key || (key.length >= 3 && (k.includes(key) || key.includes(k)));
  });
}

export default function ReferringDoctorQuickSelect({
  worklistId,
  currentName,
  disabled,
  doctorsCatalog,
}: {
  worklistId: number;
  currentName: string | null | undefined;
  disabled?: boolean;
  /** Optional prefetched Settings → Doctors rows from the parent workspace. */
  doctorsCatalog?: DoctorCatalogRow[];
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [addValue, setAddValue] = useState("");
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editDegree, setEditDegree] = useState("");

  const { data: myQuick } = useQuery<{ quickDoctorIds?: string }>({
    queryKey: ["my-quick-doctors"],
    queryFn: () => api.get("/api/my/quick-doctors"),
    staleTime: 5 * 60_000,
  });

  const { data: doctorsFetched = [] } = useQuery<Doctor[]>({
    queryKey: ["doctors-list"],
    queryFn: () => api.get<{ doctors: Doctor[] }>("/api/doctors").then((d) => d.doctors ?? []),
    staleTime: 5 * 60_000,
  });

  const doctors: Doctor[] = doctorsFetched.length
    ? doctorsFetched
    : (doctorsCatalog ?? []).map((d, i) => ({ id: -(i + 1), name: d.name, degree: d.degree }));

  const { data: frequent } = useQuery<{ doctors: Frequent[] }>({
    queryKey: ["frequent-referring-doctors"],
    queryFn: () => api.get("/api/radiology/frequent-referring-doctors?limit=12"),
    staleTime: 5 * 60_000,
  });

  const displayCurrent = useMemo(
    () => enrichReferringDoctorFromDoctors(currentName || "", doctors),
    [currentName, doctors],
  );

  const chips = useMemo(() => {
    const out: { name: string; source: "quick" | "frequent"; doctorId?: number }[] = [];
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
      const label = catalogLabel(doc);
      const key = matchKey(label);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name: label, source: "quick", doctorId: doc.id });
    }

    for (const f of frequent?.doctors ?? []) {
      const key = matchKey(f.name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const match = findCatalogDoctor(doctors, f.name);
      out.push({
        name: match ? catalogLabel(match) : formatDoctorWithDegree(f.name),
        source: "frequent",
        doctorId: match?.id,
      });
      if (out.length >= 8) break;
    }

    return out;
  }, [myQuick?.quickDoctorIds, doctors, frequent?.doctors]);

  const filteredDoctors = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return doctors.slice(0, 12);
    return doctors
      .filter((d) => {
        const label = catalogLabel(d).toLowerCase();
        return d.name.toLowerCase().includes(q) || (d.degree ?? "").toLowerCase().includes(q) || label.includes(q);
      })
      .slice(0, 12);
  }, [doctors, search]);

  const invalidateWorklist = () => {
    qc.invalidateQueries({ queryKey: ["workspace-entry", worklistId] });
    qc.invalidateQueries({ queryKey: ["radiology-pacs-worklist"] });
  };

  const setMut = useMutation({
    mutationFn: (referringDoctor: string) =>
      api.patch<{ ok: boolean; referringDoctor: string | null }>(
        `/api/radiology/pacs-worklist/${worklistId}/referring-doctor`,
        { referringDoctor },
      ),
    onSuccess: (data) => {
      invalidateWorklist();
      toast({
        title: data.referringDoctor ? "Referring doctor set" : "Referring doctor cleared",
        description: data.referringDoctor || "Cleared",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Could not set referring doctor", description: err.message, variant: "destructive" });
    },
  });

  const pinQuickDoctor = useMutation({
    mutationFn: async (doctorId: number) => {
      let slotIds: (number | null)[] = [null, null, null, null, null, null, null, null];
      try {
        const parsed = JSON.parse(myQuick?.quickDoctorIds || "[]");
        if (Array.isArray(parsed) && parsed.length === 8) slotIds = parsed;
      } catch { /* keep default */ }
      if (slotIds.includes(doctorId)) return;
      const idx = slotIds.findIndex((id) => id == null);
      if (idx < 0) return;
      slotIds[idx] = doctorId;
      await api.put("/api/my/quick-doctors", { quickDoctorIds: JSON.stringify(slotIds) });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["my-quick-doctors"] });
    },
  });

  const updateDoctorMut = useMutation({
    mutationFn: ({ id, degree, name }: { id: number; degree?: string; name?: string }) =>
      api.patch(`/api/doctors/${id}`, {
        ...(degree !== undefined ? { degree: degree.trim() || null } : {}),
        ...(name !== undefined ? { name: name.trim() } : {}),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["doctors-list"] });
      toast({ title: "Doctor updated in catalog" });
    },
    onError: (err: Error) => {
      toast({ title: "Could not update doctor", description: err.message, variant: "destructive" });
    },
  });

  const applyDoctor = (raw: string, pinIfCatalog = false) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const match = findCatalogDoctor(doctors, trimmed);
    const label = match ? catalogLabel(match) : enrichReferringDoctorFromDoctors(trimmed, doctors) || trimmed;
    setMut.mutate(label);
    if (pinIfCatalog && match && match.id > 0) pinQuickDoctor.mutate(match.id);
  };

  const openEditor = (name: string) => {
    setEditingName(name);
    setEditValue(name);
    const match = findCatalogDoctor(doctors, name);
    setEditDegree(match?.degree ?? "");
  };

  const saveEditor = async () => {
    const trimmed = editValue.trim();
    if (!trimmed) return;
    const match = findCatalogDoctor(doctors, editingName ?? trimmed);
    if (match && match.id > 0) {
      const plainName = trimmed.replace(/,\s*[A-Z.]+(?:\s*,\s*[A-Z.]+)*\s*$/i, "").replace(/^dr\.?\s*/i, "").trim() || match.name;
      await updateDoctorMut.mutateAsync({ id: match.id, name: plainName, degree: editDegree });
      setMut.mutate(formatDoctorWithDegree(plainName, editDegree.trim() || null));
    } else {
      setMut.mutate(enrichReferringDoctorFromDoctors(trimmed, doctors) || trimmed);
    }
    setEditingName(null);
  };

  const currentKey = matchKey(displayCurrent || currentName || "");
  const busy = disabled || setMut.isPending;

  return (
    <div className="col-span-2 mt-0.5 space-y-1.5" data-testid="ref-doctor-quick-select">
      {displayCurrent ? (
        <div className="text-[11px] font-medium text-foreground" data-testid="ref-doctor-current-with-degree">
          <span className="text-muted-foreground font-normal">Ref. by:</span>{" "}
          <span className="uppercase">{displayCurrent}</span>
        </div>
      ) : (
        <div className="text-[11px] text-muted-foreground" data-testid="ref-doctor-current-empty">
          Ref. by: not set — pick a doctor (degree from Settings → Doctors)
        </div>
      )}
      <div className="flex flex-wrap gap-1 items-center">
        {chips.map((c) => {
          const selected = currentKey !== "" && matchKey(c.name) === currentKey;
          return (
            <span key={`${c.source}:${c.name}`} className="inline-flex items-center max-w-[14rem]">
              <button
                type="button"
                disabled={busy}
                title={c.name}
                onClick={() => {
                  if (!selected) setMut.mutate(c.name);
                }}
                className={[
                  "max-w-[12rem] truncate rounded-l border px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                  selected ? "border-sky-600 bg-sky-600 text-white" : "border-sky-200 bg-sky-50 text-sky-900 hover:border-sky-400 hover:bg-sky-100",
                  busy ? "opacity-60" : "",
                ].join(" ")}
              >
                {chipLabel(c.name)}
              </button>
              <button
                type="button"
                disabled={busy}
                title="Edit name / degrees (Settings → Doctors)"
                data-testid="ref-doctor-edit-degrees"
                className={[
                  "rounded-r border border-l-0 px-1 py-0.5",
                  selected ? "border-sky-600 bg-sky-600 text-white" : "border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100",
                ].join(" ")}
                onClick={() => openEditor(c.name)}
              >
                <Pencil size={9} />
              </button>
            </span>
          );
        })}

        <span
          className="inline-flex items-center gap-0.5 rounded-xl border-2 border-dashed border-sky-300/80 bg-sky-50/50 px-2 py-0.5"
          data-testid="ref-doctor-add-box"
        >
          <Plus size={10} className="text-sky-700 shrink-0" />
          <input
            className="h-[18px] w-28 border-0 bg-transparent p-0 text-[10px] font-semibold text-sky-900 placeholder:text-sky-700/60 outline-none"
            placeholder="Add doctor…"
            value={addValue}
            disabled={busy}
            onChange={(e) => setAddValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                applyDoctor(addValue, true);
                setAddValue("");
              }
            }}
          />
        </span>

        <button
          type="button"
          disabled={busy}
          onClick={() => setSearchOpen((v) => !v)}
          className="inline-flex items-center gap-0.5 rounded border border-dashed border-muted-foreground/40 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:border-sky-400 hover:text-sky-800"
        >
          <Search size={10} />
          More
        </button>
        {displayCurrent || currentName ? (
          <button type="button" disabled={busy} onClick={() => setMut.mutate("")} className="inline-flex items-center gap-0.5 px-1 py-0.5 text-[10px] text-muted-foreground hover:text-foreground">
            <X size={10} /> Clear
          </button>
        ) : null}
      </div>

      {editingName && (
        <div className="rounded border bg-background p-1.5 shadow-sm space-y-1.5" data-testid="ref-doctor-edit-panel">
          <input className="h-7 w-full rounded border px-2 text-xs" value={editValue} onChange={(e) => setEditValue(e.target.value)} autoFocus />
          {findCatalogDoctor(doctors, editingName) ? (
            <input className="h-7 w-full rounded border px-2 text-xs" placeholder="Degree (MD, MBBS, DNB…)" value={editDegree} onChange={(e) => setEditDegree(e.target.value)} data-testid="ref-doctor-degree-input" />
          ) : null}
          <div className="flex justify-end gap-1">
            <button type="button" className="text-[10px] px-1.5 py-0.5" onClick={() => setEditingName(null)}>Cancel</button>
            <button type="button" className="text-[10px] px-1.5 py-0.5 rounded bg-sky-600 text-white" disabled={updateDoctorMut.isPending} onClick={() => void saveEditor()}>Save</button>
          </div>
        </div>
      )}

      {searchOpen && (
        <div className="rounded border bg-background p-1.5 shadow-sm">
          <input className="mb-1 h-7 w-full rounded border px-2 text-xs" placeholder="Search referring doctor…" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
          <div className="max-h-32 overflow-y-auto">
            {filteredDoctors.map((d) => {
              const label = catalogLabel(d);
              return (
                <button
                  key={d.id}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setMut.mutate(label);
                    if (d.id > 0) pinQuickDoctor.mutate(d.id);
                    setSearchOpen(false);
                    setSearch("");
                  }}
                  className="block w-full truncate rounded px-1.5 py-1 text-left text-[11px] hover:bg-sky-50"
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
