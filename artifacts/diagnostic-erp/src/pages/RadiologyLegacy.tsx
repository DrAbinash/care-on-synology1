// PHASE D (Radiology V2): PRESERVED. RadiologistCockpit is the single Reading Room.
// This page is redirected or owner-only. Do not delete — kept for rollback/reference.
//
// B-10 (authoritative reporting surface): the report AUTHORING that used to live
// here is gone. The page keeps its operational job — same-day modality worklist,
// technician assignment, claim/unclaim, MWL fields, PACS launch, and the
// film/CD/print issuance that exists nowhere else — and its Reports dialog is now
// a read-only view of the historical `radiology_studies.prelim_report` /
// `final_report` text plus a handoff to the Reporting Workspace. The server
// closes the write path independently (lib/legacyReportAuthority.ts on
// POST /api/radiology/:id/report), so this dialog being read-only is a property
// of the page, not the invariant.
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { readStaffSession } from "@/lib/staffSession";
import { reportingWorkspacePath } from "@/lib/reportingWorkspaceRoute";
import DeprecatedSurfaceBanner from "@/components/radiology/DeprecatedSurfaceBanner";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Search, RefreshCw, UserCircle2, Disc, Printer, Image,
  CheckCircle2, PlayCircle, Hourglass, Camera, Link2, Hand, X, Eye,
  ArrowUpRight, GraduationCap, BarChart3, Microscope,
} from "lucide-react";

type Study = {
  id: number;
  accessionNumber: string;
  modality: string;
  department: string;
  roomNumber: string;
  status: string;
  scheduledAt: string;
  startedAt: string | null;
  acquiredAt: string | null;
  deliveredAt: string | null;
  numImages: number;
  technicianId: number | null;
  technicianName: string | null;
  assignedRadiologistId: number | null;
  assignedRadiologistName: string | null;
  claimedAt: string | null;
  studyDate: string;
  prelimReportedAt: string | null;
  finalReportedAt: string | null;
  hasPrelim: boolean;
  hasFinal: boolean;
  patientId: number;
  patientCode: string | null;
  patientName: string;
  patientPhone: string | null;
  patientGender: string | null;
  testId: number;
  testCode: string | null;
  testName: string | null;
  billId: number | null;
  billNumber: string | null;
};

type StudyDetail = Study & {
  prelimReport: string | null;
  finalReport: string | null;
  prelimReportedBy: string | null;
  finalReportedBy: string | null;
  notes: string | null;
  studyInstanceUid: string | null;
  clinicalHistory: string | null;
  // DICOM MWL fields — required before in_progress
  bodyPart: string | null;
  studyDescription: string | null;
  scheduledStationAETitle: string | null;
  referringDoctor: string | null;
};

type Technician = { id: number; name: string; role: string | null; department: string | null; isRadiology: boolean };
type FilmIssue = { id: number; studyId: number; issueType: string; quantity: number; issuedBy: string | null; receivedBy: string | null; notes: string | null; issuedAt: string };
type RadOptions = { modalities: Array<{ department: string; code: string }>; statuses: string[] };

const STATUS_META: Record<string, { label: string; color: string }> = {
  scheduled:            { label: "Scheduled",   color: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-700" },
  in_progress:          { label: "In Progress", color: "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/40 dark:text-blue-200 dark:border-blue-700" },
  acquired:             { label: "Acquired",    color: "bg-indigo-100 text-indigo-800 border-indigo-300 dark:bg-indigo-900/40 dark:text-indigo-200 dark:border-indigo-700" },
  reported_preliminary: { label: "Prelim",      color: "bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-900/40 dark:text-purple-200 dark:border-purple-700" },
  reported_final:       { label: "Final",       color: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-200 dark:border-emerald-700" },
  delivered:            { label: "Delivered",   color: "bg-teal-100 text-teal-800 border-teal-300 dark:bg-teal-900/40 dark:text-teal-200 dark:border-teal-700" },
  cancelled:            { label: "Cancelled",   color: "bg-zinc-100 text-zinc-700 border-zinc-300 dark:bg-zinc-800/60 dark:text-zinc-300 dark:border-zinc-700" },
};

function StatusPill({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? STATUS_META.scheduled;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${meta.color}`}>
      {meta.label}
    </span>
  );
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * @deprecated M1.1 consolidation — RadiologyReportingWorkspace
 * (/radiology/report/:studyId) is the canonical radiology reporting page and
 * RadiologyWorklist (/radiology/worklist) the canonical worklist. This page
 * stays routed at /radiology/legacy (nothing regresses) because it is still
 * the only page-level UI for film/CD issuance tracking.
 *
 * B-10 removed the rest of the reason it was kept: its report modal used to
 * write `radiology_studies.prelim_report` / `final_report` through
 * POST /api/radiology/:id/report, which made it a second place a radiology
 * report could be authored — with no #877 placeholder guard, no #880
 * acceptance target, no #882 proposal fingerprint and no signed-refusal, and
 * with AI findings/impression appended straight into the text that became the
 * report. The modal is now read-only over the historical columns and hands off
 * to the workspace. The write is closed server-side, not by this page.
 */
export default function RadiologyLegacy() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [modality, setModality] = useState("all");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  // assignment filter chip — drives ?assigned= on the worklist call.
  // "all"=no filter, "unclaimed"=studies with no radiologist yet, "mine"=studies
  // claimed by the current staff member (via /api/users/me).
  const [assigned, setAssigned] = useState<"all" | "unclaimed" | "mine">("all");
  const [tab, setTab] = useState<"worklist" | "reporting" | "films">("worklist");

  const [studyModalId, setStudyModalId] = useState<number | null>(null);
  const [reportModalId, setReportModalId] = useState<number | null>(null);
  const [filmModalId, setFilmModalId] = useState<number | null>(null);
  const [pacsBusyId, setPacsBusyId] = useState<number | null>(null);

  const { data: options } = useQuery<RadOptions>({
    queryKey: ["radiology-options"],
    queryFn: () => api.get("/api/radiology/options"),
  });

  const { data: technicians = [] } = useQuery<Technician[]>({
    queryKey: ["radiology-technicians"],
    queryFn: () => api.get("/api/radiology/technicians"),
  });

  // Current signed-in staff (from the staff session in localStorage). Used to
  // drive the "Mine" filter and to attribute claim/unclaim actions.
  const me = useMemo(() => {
    const s = readStaffSession();
    return s?.user ? { id: s.user.id, name: s.user.name } : null;
  }, []);

  const { data: studies = [], isFetching, refetch } = useQuery<Study[]>({
    queryKey: ["radiology-worklist", date, modality, status, search, assigned, me?.id ?? 0],
    queryFn: () => {
      const p = new URLSearchParams();
      p.set("date", date);
      if (modality !== "all") p.set("modality", modality);
      if (status !== "all") p.set("status", status);
      if (search.trim()) p.set("search", search.trim());
      if (assigned === "unclaimed") p.set("assigned", "unclaimed");
      else if (assigned === "mine" && me?.id) {
        p.set("assigned", "mine"); p.set("staffId", String(me.id));
      }
      return api.get(`/api/radiology/worklist?${p.toString()}`);
    },
    refetchInterval: 8_000,
  });

  // Claim/unclaim use the authenticated staff identity on the server — no need
  // to send staffId from the client.
  const claim = useMutation({
    mutationFn: ({ id }: { id: number }) => api.post(`/api/radiology/${id}/claim`, {}),
    onSuccess: () => {
      toast({ title: "Study claimed" });
      qc.invalidateQueries({ queryKey: ["radiology-worklist"] });
    },
    onError: (e: Error) => toast({ title: "Could not claim", description: e.message, variant: "destructive" }),
  });
  const unclaim = useMutation({
    mutationFn: ({ id }: { id: number }) => api.post(`/api/radiology/${id}/unclaim`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["radiology-worklist"] }),
    onError: (e: Error) => toast({ title: "Could not release", description: e.message, variant: "destructive" }),
  });

  const openPacsViewer = async (studyId: number) => {
    setPacsBusyId(studyId);
    const w = window.open("", "_blank");
    try {
      const data = await api.get<{ weasisUrl: string; orthancViewerUrl: string; ohifUrl: string | null }>(`/api/radiology/studies/${studyId}/pacs-url`);
      const url = data.ohifUrl ?? data.weasisUrl ?? data.orthancViewerUrl;
      if (!url) { w?.close(); toast({ title: "No viewer URL", variant: "destructive" }); return; }
      if (w) w.location.href = url;
    } catch {
      w?.close();
      toast({ title: "Failed to open viewer", variant: "destructive" });
    } finally {
      setPacsBusyId(null);
    }
  };

  const reportingQueue = useMemo(
    () => studies.filter((s) => ["acquired", "reported_preliminary"].includes(s.status)),
    [studies],
  );
  const allFilmEligible = useMemo(
    () => studies.filter((s) => ["reported_final", "delivered"].includes(s.status)),
    [studies],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { scheduled: 0, in_progress: 0, acquired: 0, reported_preliminary: 0, reported_final: 0, delivered: 0 };
    for (const s of studies) c[s.status] = (c[s.status] ?? 0) + 1;
    return c;
  }, [studies]);

  const setStudyStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      api.patch(`/api/radiology/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["radiology-worklist"] }),
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const assignTech = useMutation({
    mutationFn: ({ id, technicianId }: { id: number; technicianId: number | null }) =>
      api.patch(`/api/radiology/${id}`, { technicianId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["radiology-worklist"] }),
    onError: (e: Error) => toast({ title: "Could not assign technician", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <DeprecatedSurfaceBanner
        surface="Radiology Legacy Hub"
        note="film/CD issuance remains unique to this page for now"
      />
      <PageHeader
        title="Radiology"
        subtitle="Modality worklist, technician assignment, historical reports & film/CD tracking"
      />

      {/* Today's snapshot */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        {(["scheduled","in_progress","acquired","reported_preliminary","reported_final","delivered"] as const).map((s) => (
          <div key={s} className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">{STATUS_META[s].label}</div>
            <div className="text-2xl font-semibold">{counts[s] ?? 0}</div>
          </div>
        ))}
      </div>

      {/* Phase 8 teaching & productivity nav */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => window.location.href = "./teaching-cases"}>
          <GraduationCap size={14} className="mr-1.5" /> Teaching Files
        </Button>
        <Button variant="outline" size="sm" onClick={() => window.location.href = "./teaching-analytics"}>
          <BarChart3 size={14} className="mr-1.5" /> Analytics
        </Button>
        <Button variant="outline" size="sm" onClick={() => window.location.href = "./radiology/productivity"}>
          <Microscope size={14} className="mr-1.5" /> Productivity
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Patient, accession, test…" className="pl-8 w-64" />
        </div>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />
        <Select value={modality} onValueChange={setModality}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Modality" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Modalities</SelectItem>
            {(options?.modalities ?? []).map((m) => (
              <SelectItem key={m.code} value={m.code}>{m.department} ({m.code})</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {(options?.statuses ?? []).map((s) => (
              <SelectItem key={s} value={s}>{STATUS_META[s]?.label ?? s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} />
          <span className="ml-1">Refresh</span>
        </Button>
        {/* Assignment chips — tele-radiology workflow */}
        <div className="ml-auto inline-flex rounded-md border bg-background overflow-hidden">
          {(["all","unclaimed","mine"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setAssigned(k)}
              disabled={k === "mine" && !me?.id}
              className={`px-3 py-1 text-xs ${assigned === k ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            >
              {k === "all" ? "All" : k === "unclaimed" ? "Unclaimed" : "Mine"}
            </button>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="worklist">Worklist <span className="ml-1 text-xs opacity-70">({studies.length})</span></TabsTrigger>
          <TabsTrigger value="reporting">Reporting Queue <span className="ml-1 text-xs opacity-70">({reportingQueue.length})</span></TabsTrigger>
          <TabsTrigger value="films">Films & CDs <span className="ml-1 text-xs opacity-70">({allFilmEligible.length})</span></TabsTrigger>
        </TabsList>

        <TabsContent value="worklist" className="mt-3">
          <WorklistTable
            rows={studies}
            technicians={technicians}
            meId={me?.id ?? null}
            onOpen={(id) => setStudyModalId(id)}
            onPacs={openPacsViewer}
            pacsBusyId={pacsBusyId}
            onReports={(id) => setReportModalId(id)}
            onFilm={(id) => setFilmModalId(id)}
            onStatus={(id, s) => setStudyStatus.mutate({ id, status: s })}
            onAssign={(id, techId) => assignTech.mutate({ id, technicianId: techId })}
            onClaim={(id) => claim.mutate({ id })}
            onUnclaim={(id) => unclaim.mutate({ id })}
          />
        </TabsContent>

        <TabsContent value="reporting" className="mt-3">
          <WorklistTable
            rows={reportingQueue}
            technicians={technicians}
            meId={me?.id ?? null}
            onOpen={(id) => setStudyModalId(id)}
            onPacs={openPacsViewer}
            pacsBusyId={pacsBusyId}
            onReports={(id) => setReportModalId(id)}
            onFilm={(id) => setFilmModalId(id)}
            onStatus={(id, s) => setStudyStatus.mutate({ id, status: s })}
            onAssign={(id, techId) => assignTech.mutate({ id, technicianId: techId })}
            onClaim={(id) => claim.mutate({ id })}
            onUnclaim={(id) => unclaim.mutate({ id })}
            emptyMsg="No acquired studies waiting for a report. Mark a study as Acquired from the Worklist tab to queue it here."
          />
        </TabsContent>

        <TabsContent value="films" className="mt-3">
          <WorklistTable
            rows={allFilmEligible}
            technicians={technicians}
            meId={me?.id ?? null}
            onOpen={(id) => setStudyModalId(id)}
            onPacs={openPacsViewer}
            pacsBusyId={pacsBusyId}
            onReports={(id) => setReportModalId(id)}
            onFilm={(id) => setFilmModalId(id)}
            onStatus={(id, s) => setStudyStatus.mutate({ id, status: s })}
            onAssign={(id, techId) => assignTech.mutate({ id, technicianId: techId })}
            onClaim={(id) => claim.mutate({ id })}
            onUnclaim={(id) => unclaim.mutate({ id })}
            emptyMsg="No final reports ready for film/CD/print issuance yet."
          />
        </TabsContent>
      </Tabs>

      {studyModalId !== null && (
        <StudyDetailModal id={studyModalId} onClose={() => setStudyModalId(null)} />
      )}
      {reportModalId !== null && (
        <LegacyReportsView id={reportModalId} onClose={() => setReportModalId(null)} />
      )}
      {filmModalId !== null && (
        <FilmIssueModal id={filmModalId} onClose={() => setFilmModalId(null)} />
      )}
    </div>
  );
}

function WorklistTable(props: {
  rows: Study[];
  technicians: Technician[];
  meId: number | null;
  onOpen: (id: number) => void;
  onPacs: (id: number) => void;
  pacsBusyId: number | null;
  onReports: (id: number) => void;
  onFilm: (id: number) => void;
  onStatus: (id: number, status: string) => void;
  onAssign: (id: number, techId: number | null) => void;
  onClaim: (id: number) => void;
  onUnclaim: (id: number) => void;
  emptyMsg?: string;
}) {
  const { rows, technicians, meId, onOpen, onPacs, pacsBusyId, onReports, onFilm, onStatus, onAssign, onClaim, onUnclaim, emptyMsg } = props;
  if (rows.length === 0) {
    return (
      <div className="border rounded-lg p-8 text-center text-sm text-muted-foreground">
        {emptyMsg ?? "No studies match your filters."}
      </div>
    );
  }
  return (
    <div className="border rounded-lg overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs uppercase">
          <tr>
            <th className="text-left p-2">Accession</th>
            <th className="text-left p-2">Patient</th>
            <th className="text-left p-2">Test</th>
            <th className="text-left p-2">Modality</th>
            <th className="text-left p-2">Room</th>
            <th className="text-left p-2">Tech</th>
            <th className="text-left p-2">Status</th>
            <th className="text-left p-2">Radiologist</th>
            <th className="text-left p-2">Images</th>
            <th className="text-left p-2">Reported</th>
            <th className="text-right p-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id} className="border-t hover:bg-muted/30">
              <td className="p-2 font-mono text-xs">
                <button className="underline-offset-2 hover:underline text-left" onClick={() => onOpen(s.id)}>
                  {s.accessionNumber}
                </button>
                <div className="text-[10px] text-muted-foreground">{fmtTime(s.scheduledAt)}</div>
              </td>
              <td className="p-2">
                <div className="font-medium">{s.patientName}</div>
                <div className="text-xs text-muted-foreground">{s.patientCode ?? "—"} · {s.patientGender ?? "?"}</div>
              </td>
              <td className="p-2">
                <div className="font-medium">{s.testName ?? "—"}</div>
                <div className="text-xs text-muted-foreground">{s.testCode ?? ""}{s.billNumber ? ` · ${s.billNumber}` : ""}</div>
              </td>
              <td className="p-2">
                <span className="px-2 py-0.5 text-xs rounded border bg-background">{s.modality}</span>
                <div className="text-[10px] text-muted-foreground">{s.department}</div>
              </td>
              <td className="p-2">{s.roomNumber || "—"}</td>
              <td className="p-2 min-w-[140px]">
                <Select
                  value={s.technicianId ? String(s.technicianId) : "none"}
                  onValueChange={(v) => onAssign(s.id, v === "none" ? null : Number(v))}
                >
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Assign…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Unassigned —</SelectItem>
                    {technicians.map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>
                        {t.isRadiology ? "★ " : ""}{t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </td>
              <td className="p-2"><StatusPill status={s.status} /></td>
              <td className="p-2 text-xs">
                {s.assignedRadiologistName ? (
                  <div className="inline-flex items-center gap-1">
                    <span className="font-medium">{s.assignedRadiologistName}</span>
                    {s.assignedRadiologistId === meId && (
                      <button
                        title="Release claim"
                        onClick={() => onUnclaim(s.id)}
                        className="text-muted-foreground hover:text-destructive"
                      ><X size={11} /></button>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => onClaim(s.id)}
                    disabled={!meId}
                    className="inline-flex items-center gap-1 text-primary hover:underline disabled:text-muted-foreground"
                  >
                    <Hand size={11} /> Claim
                  </button>
                )}
              </td>
              <td className="p-2 text-center">
                <div className="inline-flex items-center gap-1">
                  <Image size={12} className="text-muted-foreground" />
                  <span className="font-mono">{s.numImages}</span>
                </div>
              </td>
              <td className="p-2 text-xs">
                {s.hasFinal ? (
                  <span className="text-emerald-700 dark:text-emerald-400">Final {fmtTime(s.finalReportedAt)}</span>
                ) : s.hasPrelim ? (
                  <span className="text-purple-700 dark:text-purple-400">Prelim {fmtTime(s.prelimReportedAt)}</span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="p-2 text-right whitespace-nowrap">
                <Button size="sm" variant="outline" className="h-7 px-2 mr-1" onClick={() => onPacs(s.id)} disabled={pacsBusyId === s.id}>
                  <Link2 size={12} className="mr-1" />PACS
                </Button>
                {s.status === "scheduled" && (
                  <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => onStatus(s.id, "in_progress")}>
                    <PlayCircle size={12} className="mr-1" />Start
                  </Button>
                )}
                {s.status === "in_progress" && (
                  <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => onStatus(s.id, "acquired")}>
                    <Camera size={12} className="mr-1" />Acquired
                  </Button>
                )}
                {(s.status === "acquired" || s.status === "reported_preliminary" || s.status === "reported_final") && (
                  <Button size="sm" variant="outline" className="h-7 px-2 ml-1" onClick={() => onReports(s.id)}>
                    <Eye size={12} className="mr-1" />Reports
                  </Button>
                )}
                {(s.status === "reported_final" || s.status === "delivered") && (
                  <Button size="sm" variant="outline" className="h-7 px-2 ml-1" onClick={() => onFilm(s.id)}>
                    <Disc size={12} className="mr-1" />Issue
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Study Detail / quick edit ──────────────────────────────────────────────
function StudyDetailModal({ id, onClose }: { id: number; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: study, isLoading } = useQuery<StudyDetail>({
    queryKey: ["radiology-study", id],
    queryFn: () => api.get(`/api/radiology/studies/${id}`),
  });

  const [numImages, setNumImages] = useState<number>(0);
  const [notes, setNotes] = useState("");
  const [studyInstanceUid, setStudyInstanceUid] = useState("");
  // DICOM MWL fields — required before the study can move to in_progress
  const [studyDescription, setStudyDescription] = useState("");
  const [bodyPart, setBodyPart] = useState("");
  const [scheduledStationAETitle, setScheduledStationAETitle] = useState("");
  const [referringDoctor, setReferringDoctor] = useState("");

  useEffect(() => {
    if (study) {
      setNumImages(study.numImages ?? 0);
      setNotes(study.notes ?? "");
      setStudyInstanceUid(study.studyInstanceUid ?? "");
      setStudyDescription(study.studyDescription ?? "");
      setBodyPart(study.bodyPart ?? "");
      setScheduledStationAETitle(study.scheduledStationAETitle ?? "");
      setReferringDoctor(study.referringDoctor ?? "");
    }
  }, [study]);

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/api/radiology/${id}`, {
        numImages,
        notes,
        studyInstanceUid,
        studyDescription: studyDescription || null,
        bodyPart: bodyPart || null,
        scheduledStationAETitle: scheduledStationAETitle || null,
        referringDoctor: referringDoctor || null,
      }),
    onSuccess: () => {
      toast({ title: "Study updated" });
      qc.invalidateQueries({ queryKey: ["radiology-worklist"] });
      qc.invalidateQueries({ queryKey: ["radiology-study", id] });
      onClose();
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  // A study requires all MWL fields before it can move to in_progress.
  const mwlFieldsMissing = !studyDescription.trim() || !bodyPart.trim() ||
    !scheduledStationAETitle.trim() || !referringDoctor.trim();

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Study Details</DialogTitle>
          <DialogDescription>{study?.accessionNumber ?? "Loading…"}</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : study ? (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <div><div className="text-xs text-muted-foreground">Modality</div><div className="font-mono">{study.modality}</div></div>
              <div><div className="text-xs text-muted-foreground">Status</div><StatusPill status={study.status} /></div>
              <div><div className="text-xs text-muted-foreground">Technician</div><div>{study.technicianName ?? "—"}</div></div>
              <div><div className="text-xs text-muted-foreground">Room</div><div>{study.roomNumber || "—"}</div></div>
            </div>

            {/* DICOM MWL mandatory fields */}
            <div className="rounded-lg border border-dashed p-3 space-y-3">
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold">DICOM Worklist Fields</p>
                {mwlFieldsMissing ? (
                  <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">
                    Required before scanning
                  </span>
                ) : (
                  <span className="text-[10px] bg-green-100 text-green-800 px-1.5 py-0.5 rounded">
                    Complete
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Study Description *</label>
                  <Input
                    value={studyDescription}
                    onChange={(e) => setStudyDescription(e.target.value)}
                    placeholder="e.g. MRI Brain Plain"
                    className="h-8 text-xs mt-0.5"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Body Part Examined *</label>
                  <Input
                    value={bodyPart}
                    onChange={(e) => setBodyPart(e.target.value)}
                    placeholder="e.g. BRAIN, CHEST, ABDOMEN"
                    className="h-8 text-xs mt-0.5"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Station AE Title *</label>
                  <Input
                    value={scheduledStationAETitle}
                    onChange={(e) => setScheduledStationAETitle(e.target.value)}
                    placeholder="e.g. MRI01, CT_ROOM2"
                    className="h-8 text-xs mt-0.5"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Referring Doctor *</label>
                  <Input
                    value={referringDoctor}
                    onChange={(e) => setReferringDoctor(e.target.value)}
                    placeholder="Dr. Name"
                    className="h-8 text-xs mt-0.5"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="text-xs text-muted-foreground">Number of images acquired</label>
              <Input type="number" min={0} value={numImages} onChange={(e) => setNumImages(Number(e.target.value))} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">DICOM Study Instance UID (optional)</label>
              <Input value={studyInstanceUid} onChange={(e) => setStudyInstanceUid(e.target.value)} placeholder="1.2.840.113619…" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Notes</label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Patient prep, contrast, clinical notes…" />
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Historical reports — read-only + handoff ───────────────────────────────
// B-10: this dialog used to be a second radiology authoring surface. It held its
// own free-text report body, a Preliminary/Final stage selector, a client-typed
// "Reported by" name, voice dictation, an "AI Suggest Findings / Impression"
// pair that appended model prose straight into that body, its own print
// renderer, and a Save that POSTed radiology_studies.prelim_report /
// final_report — the columns that lib/priorStudies.ts reads BEFORE the signed
// patient report (s.finalReport ?? s.prelimReport ?? report?.body). None of the
// protections that live at the authoritative boundary applied here: no #877
// placeholder guard, no #880 acceptance target, no #882 proposal fingerprint, no
// #859/#862 refusal once a report is signed, no Observation Ledger.
//
// What stays is the part only this page can do, and the part the clinic needs
// for studies that were authored here before: read the historical text. Writing
// is closed at the route (lib/legacyReportAuthority.ts), not by hiding this
// button — an HTTP client that posts here gets 409 with a code and a direction.
function LegacyReportsView({ id, onClose }: { id: number; onClose: () => void }) {
  const [, navigate] = useLocation();
  const { data: study, isLoading } = useQuery<StudyDetail & { worklistId?: number | null }>({
    queryKey: ["radiology-study", id],
    queryFn: () => api.get(`/api/radiology/studies/${id}`),
  });

  // radiology_studies.id is NOT the Reporting Workspace's route key — that one
  // takes a radiology_worklist.id. The detail endpoint resolves it; null means
  // this study is not in the modern pipeline, which is stated rather than
  // papered over with a URL that would 404.
  const worklistId = study?.worklistId ?? null;
  const prelim = study?.prelimReport?.trim() ?? "";
  const final = study?.finalReport?.trim() ?? "";

  const section = (
    key: string,
    label: string,
    text: string,
    by: string | null,
    at: string | null,
  ) => (
    <div key={key} className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-baseline gap-2 border-b px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide">{label}</span>
        <span className="text-[11px] text-muted-foreground">
          {by ? "by " + by : "author not recorded"}
          {at ? " · " + new Date(at).toLocaleString() : ""}
        </span>
      </div>
      <pre className="whitespace-pre-wrap break-words px-3 py-2 font-mono text-xs">{text}</pre>
    </div>
  );

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Reports — {study?.accessionNumber ?? "Loading…"}</DialogTitle>
          <DialogDescription>
            {study?.testName ?? ""} · {study?.patientName ?? ""} · {study?.modality ?? ""}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : (
          <div className="space-y-4 text-sm">
            <div
              data-testid="legacy-reports-readonly-notice"
              className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs dark:border-amber-800 dark:bg-amber-950/40"
            >
              <p className="font-semibold">Reporting is done in the Reporting Workspace.</p>
              <p className="mt-1">
                This legacy page reads the historical report text below but can no longer write
                it; the API refuses new or competing radiology report text here.
              </p>
            </div>

            {worklistId != null ? (
              <Button
                data-testid="legacy-report-handoff"
                onClick={() => navigate(reportingWorkspacePath(worklistId))}
              >
                <ArrowUpRight size={14} className="mr-1.5" />
                Open in Reporting Workspace
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">
                This study has no worklist row, so the Reporting Workspace cannot open it yet.
                It first needs a radiology_worklist row (PACS/MWL intake, or the worklist&rsquo;s
                billing link). New report text cannot be created on this page either — the
                historical record stays exactly as it is.
              </p>
            )}

            {final ? section("final", "Final (legacy)", final, study?.finalReportedBy ?? null, study?.finalReportedAt ?? null) : null}
            {prelim ? section("prelim", "Preliminary (legacy)", prelim, study?.prelimReportedBy ?? null, study?.prelimReportedAt ?? null) : null}
            {!final && !prelim && (
              <p className="text-xs text-muted-foreground">
                No legacy report text is on file for this study.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}



// ── Film / CD / Print issuance ─────────────────────────────────────────────
function FilmIssueModal({ id, onClose }: { id: number; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: study } = useQuery<StudyDetail>({
    queryKey: ["radiology-study", id],
    queryFn: () => api.get(`/api/radiology/studies/${id}`),
  });
  const { data: issues = [], refetch } = useQuery<FilmIssue[]>({
    queryKey: ["radiology-issues", id],
    queryFn: () => api.get(`/api/radiology/${id}/issues`),
  });

  const [issueType, setIssueType] = useState<"film" | "cd" | "print">("film");
  const [quantity, setQuantity] = useState(1);
  const [issuedBy, setIssuedBy] = useState("");
  const [receivedBy, setReceivedBy] = useState("");
  const [notes, setNotes] = useState("");

  const create = useMutation({
    mutationFn: () => api.post(`/api/radiology/${id}/issues`, { issueType, quantity, issuedBy: issuedBy || undefined, receivedBy: receivedBy || undefined, notes: notes || undefined }),
    onSuccess: () => {
      toast({ title: `${issueType.toUpperCase()} issued` });
      setQuantity(1); setIssuedBy(""); setReceivedBy(""); setNotes("");
      refetch();
      qc.invalidateQueries({ queryKey: ["radiology-worklist"] });
    },
    onError: (e: Error) => toast({ title: "Could not record issuance", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Disc size={16} />
            Film / CD / Print Issue — {study?.accessionNumber ?? ""}
          </DialogTitle>
          <DialogDescription>
            {study?.testName ?? ""} · {study?.patientName ?? ""}
          </DialogDescription>
        </DialogHeader>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Type</label>
              <Select value={issueType} onValueChange={(v) => setIssueType(v as typeof issueType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="film"><span className="inline-flex items-center gap-2"><Image size={12} />Film sheet</span></SelectItem>
                  <SelectItem value="cd"><span className="inline-flex items-center gap-2"><Disc size={12} />CD / DVD</span></SelectItem>
                  <SelectItem value="print"><span className="inline-flex items-center gap-2"><Printer size={12} />Paper print</span></SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Quantity</label>
              <Input type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Issued by (staff)</label>
              <Input value={issuedBy} onChange={(e) => setIssuedBy(e.target.value)} placeholder="Reception / Tech" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Received by</label>
              <Input value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} placeholder="Patient / attendant name" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Notes</label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
            <Button onClick={() => create.mutate()} disabled={create.isPending} className="w-full">
              Record Issue
            </Button>
          </div>

          <div className="border rounded-md p-2 text-sm overflow-y-auto max-h-80">
            <div className="text-xs uppercase text-muted-foreground mb-2">History ({issues.length})</div>
            {issues.length === 0 ? (
              <div className="text-xs text-muted-foreground">Nothing issued yet.</div>
            ) : (
              <ul className="space-y-2">
                {issues.map((i) => (
                  <li key={i.id} className="border-b last:border-0 pb-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium uppercase text-xs">{i.issueType}</span>
                      <span className="text-xs text-muted-foreground">{new Date(i.issuedAt).toLocaleString()}</span>
                    </div>
                    <div className="text-xs">Qty: {i.quantity}</div>
                    {(i.issuedBy || i.receivedBy) && (
                      <div className="text-xs text-muted-foreground">
                        {i.issuedBy ? `By ${i.issuedBy}` : ""}{i.issuedBy && i.receivedBy ? " → " : ""}{i.receivedBy ? `to ${i.receivedBy}` : ""}
                      </div>
                    )}
                    {i.notes && <div className="text-xs italic">{i.notes}</div>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// keep tree-shake friendly imports happy
void UserCircle2; void Hourglass; void CheckCircle2;
