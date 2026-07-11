// PHASE C (Radiology V2): PRESERVED, route redirects to the unified /radiology/worklist.
// Do not delete — kept for rollback and reference. See RadiologyWorklist.tsx (winner).
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Search, RefreshCw, Eye, Link, Link2Off, AlertCircle, ExternalLink,
  Filter, Loader2, Monitor, Clock, UserCheck,
} from "lucide-react";

type Study = {
  id: number;
  studyInstanceUID: string;
  accessionNumber: string | null;
  patientName: string | null;
  patientId: string | null;
  modality: string | null;
  studyDescription: string | null;
  bodyPartExamined: string | null;
  studyDate: string | null;
  numberOfImages: number | null;
  numberOfSeries: number | null;
  linkStatus: "unlinked" | "suggested" | "conflict" | "linked";
  reportStatus: string;
  assignedRadiologistId: string | null;
  assignedRadiologistName: string | null;
  technicianName: string | null;
  priority: string | null;
  isCritical: boolean;
  pacsSyncStatus: string;
  pacsSyncedAt: string | null;
};

const priorityColors: Record<string, string> = {
  emergency: "destructive",
  stat: "destructive",
  icu: "destructive",
  inpatient: "default",
  outpatient: "secondary",
  corporate: "outline",
  routine: "outline",
} as const;

const linkBadge: Record<string, { label: string; color: any }> = {
  linked: { label: "Linked", color: "default" },
  suggested: { label: "Suggested", color: "secondary" },
  conflict: { label: "Conflict", color: "destructive" },
  unlinked: { label: "Unlinked", color: "outline" },
};

export default function DicomStudyWorklist() {
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [modality, setModality] = useState<string>("");
  const [linkFilter, setLinkFilter] = useState<string>("");
  const [priorityFilter, setPriorityFilter] = useState<string>("");
  const [dialogStudy, setDialogStudy] = useState<Study | null>(null);
  const [assignDialog, setAssignDialog] = useState<Study | null>(null);
  const [assignNote, setAssignNote] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["dicom-studies", search, modality, linkFilter, priorityFilter],
    queryFn: () => api.get<{ studies: Study[]; total: number }>(
      `/api/dicom-studies?search=${encodeURIComponent(search)}&modality=${encodeURIComponent(modality)}&linkStatus=${encodeURIComponent(linkFilter)}&priority=${encodeURIComponent(priorityFilter)}&limit=100`
    ),
  });

  const linkMut = useMutation({
    mutationFn: (s: Study) => api.patch(`/api/dicom-studies/${s.id}/link`, { billId: null, reportId: null, force: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dicom-studies"] }),
  });

  const assignMut = useMutation({
    mutationFn: ({ id, note }: { id: number; note: string }) =>
      api.patch(`/api/dicom-studies/${id}/assign-radiologist`, { note }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["dicom-studies"] }); setAssignDialog(null); setAssignNote(""); },
  });

  const viewerUrl = (s: Study) => `/api/dicom-studies/${s.id}/viewer?type=ohif`;

  const studies = data?.studies ?? [];

  return (
    <div>
      <PageHeader
        title="DICOM Study Worklist"
        subtitle="Ingested studies — link, assign, and launch viewers"
        actions={
          <Button variant="outline" onClick={() => qc.invalidateQueries({ queryKey: ["dicom-studies"] })}>
            <RefreshCw className="w-4 h-4 mr-1" /> Refresh
          </Button>
        }
      />

      {/* Filters */}
      <div className="px-4 sm:px-6 py-4 flex flex-wrap gap-3 items-center border-b">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search patient, accession, UID..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={modality} onValueChange={setModality}>
          <SelectTrigger className="w-[130px]"><SelectValue placeholder="Modality" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="">All</SelectItem>
            <SelectItem value="CT">CT</SelectItem>
            <SelectItem value="MR">MRI</SelectItem>
            <SelectItem value="US">USG</SelectItem>
            <SelectItem value="XR">X-Ray</SelectItem>
            <SelectItem value="DX">Digital X-Ray</SelectItem>
            <SelectItem value="CR">Computed Radiography</SelectItem>
            <SelectItem value="MG">Mammography</SelectItem>
            <SelectItem value="PT">PET</SelectItem>
            <SelectItem value="NM">Nuclear Med</SelectItem>
            <SelectItem value="RF">Fluoroscopy</SelectItem>
            <SelectItem value="XA">Angiography</SelectItem>
          </SelectContent>
        </Select>
        <Select value={linkFilter} onValueChange={setLinkFilter}>
          <SelectTrigger className="w-[130px]"><SelectValue placeholder="Link Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="">All</SelectItem>
            <SelectItem value="unlinked">Unlinked</SelectItem>
            <SelectItem value="suggested">Suggested</SelectItem>
            <SelectItem value="linked">Linked</SelectItem>
            <SelectItem value="conflict">Conflict</SelectItem>
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-[130px]"><SelectValue placeholder="Priority" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="">All</SelectItem>
            <SelectItem value="emergency">Emergency</SelectItem>
            <SelectItem value="stat">STAT</SelectItem>
            <SelectItem value="icu">ICU</SelectItem>
            <SelectItem value="inpatient">Inpatient</SelectItem>
            <SelectItem value="outpatient">Outpatient</SelectItem>
            <SelectItem value="routine">Routine</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="px-4 sm:px-6 py-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-8"><Loader2 className="animate-spin h-5 w-5" /> Loading studies...</div>
        ) : studies.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">No studies found matching filters.</div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Patient</TableHead>
                  <TableHead>Accession</TableHead>
                  <TableHead>Modality</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Images</TableHead>
                  <TableHead>Link</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Sync</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {studies.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <div className="font-medium">{s.patientName || "Unknown"}</div>
                      <div className="text-xs text-muted-foreground">{s.patientId || "No ID"}</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{s.accessionNumber || "—"}</TableCell>
                    <TableCell>{s.modality || "—"}</TableCell>
                    <TableCell className="max-w-[200px] truncate">{s.studyDescription || "—"}</TableCell>
                    <TableCell className="text-xs">{s.studyDate ? new Date(s.studyDate).toLocaleDateString() : "—"}</TableCell>
                    <TableCell>{s.numberOfImages ?? 0}</TableCell>
                    <TableCell>
                      <Badge variant={linkBadge[s.linkStatus]?.color || "outline"}>{linkBadge[s.linkStatus]?.label || s.linkStatus}</Badge>
                    </TableCell>
                    <TableCell>
                      {s.priority && (
                        <Badge variant={(priorityColors[s.priority] || "outline") as any}>{s.priority.toUpperCase()}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {s.pacsSyncStatus === "synced" ? (
                        <Badge variant="outline" className="text-green-600 border-green-200">Synced</Badge>
                      ) : s.pacsSyncStatus === "failed" ? (
                        <Badge variant="outline" className="text-red-600 border-red-200">Failed</Badge>
                      ) : (
                        <Badge variant="outline">Pending</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setDialogStudy(s)}><Eye className="h-4 w-4" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => window.open(viewerUrl(s), "_blank")}><Monitor className="h-4 w-4" /></Button>
                        {s.linkStatus === "unlinked" && (
                          <Button size="sm" variant="ghost" onClick={() => linkMut.mutate(s)} disabled={linkMut.isPending}><Link className="h-4 w-4" /></Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => setAssignDialog(s)}><UserCheck className="h-4 w-4" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => setLocation(`/radiology/technician-workflow/${s.id}`)}><Clock className="h-4 w-4" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Detail dialog */}
      <Dialog open={!!dialogStudy} onOpenChange={(o) => !o && setDialogStudy(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Study Detail</DialogTitle></DialogHeader>
          {dialogStudy && (
            <div className="space-y-2 text-sm">
              <div className="grid grid-cols-3 gap-2"><span className="text-muted-foreground">Patient</span><span className="col-span-2 font-medium">{dialogStudy.patientName}</span></div>
              <div className="grid grid-cols-3 gap-2"><span className="text-muted-foreground">Accession</span><span className="col-span-2 font-mono">{dialogStudy.accessionNumber}</span></div>
              <div className="grid grid-cols-3 gap-2"><span className="text-muted-foreground">Modality</span><span className="col-span-2">{dialogStudy.modality}</span></div>
              <div className="grid grid-cols-3 gap-2"><span className="text-muted-foreground">Description</span><span className="col-span-2">{dialogStudy.studyDescription}</span></div>
              <div className="grid grid-cols-3 gap-2"><span className="text-muted-foreground">Body Part</span><span className="col-span-2">{dialogStudy.bodyPartExamined}</span></div>
              <div className="grid grid-cols-3 gap-2"><span className="text-muted-foreground">Study UID</span><span className="col-span-2 font-mono break-all">{dialogStudy.studyInstanceUID}</span></div>
              <div className="grid grid-cols-3 gap-2"><span className="text-muted-foreground">Radiologist</span><span className="col-span-2">{dialogStudy.assignedRadiologistName || "Unassigned"}</span></div>
              <div className="grid grid-cols-3 gap-2"><span className="text-muted-foreground">Technician</span><span className="col-span-2">{dialogStudy.technicianName || "—"}</span></div>
              <div className="grid grid-cols-3 gap-2"><span className="text-muted-foreground">Last Sync</span><span className="col-span-2">{dialogStudy.pacsSyncedAt ? new Date(dialogStudy.pacsSyncedAt).toLocaleString() : "Never"}</span></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogStudy(null)}>Close</Button>
            <Button onClick={() => { window.open(viewerUrl(dialogStudy!), "_blank"); }}><ExternalLink className="h-4 w-4 mr-1" /> Open Viewer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign dialog */}
      <Dialog open={!!assignDialog} onOpenChange={(o) => !o && setAssignDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Assign Radiologist</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Textarea placeholder="Assignment note (optional)" value={assignNote} onChange={(e) => setAssignNote(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignDialog(null)}>Cancel</Button>
            <Button onClick={() => assignDialog && assignMut.mutate({ id: assignDialog.id, note: assignNote })} disabled={assignMut.isPending}>
              {assignMut.isPending ? <Loader2 className="animate-spin h-4 w-4 mr-1" /> : <UserCheck className="h-4 w-4 mr-1" />} Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
