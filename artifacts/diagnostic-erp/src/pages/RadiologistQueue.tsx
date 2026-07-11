// PHASE C (Radiology V2): PRESERVED, route redirects to the unified /radiology/worklist.
// Do not delete — kept for rollback and reference. See RadiologyWorklist.tsx (winner).
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2, Eye, FilePen, UserCheck, AlertTriangle, Zap,
  Clock, Activity, Users, ShieldCheck, Timer,
} from "lucide-react";

const QUEUE_TABS = [
  { key: "pending", label: "Pending", icon: Clock },
  { key: "verified_not_finalized", label: "Verified", icon: ShieldCheck },
  { key: "critical", label: "Critical", icon: AlertTriangle },
  { key: "stat", label: "STAT", icon: Zap },
  { key: "oldest_first", label: "Oldest First", icon: Timer },
  { key: "assigned_to_me", label: "My Cases", icon: Users },
  { key: "unassigned", label: "Unassigned", icon: Activity },
] as const;

type Study = {
  id: number;
  studyInstanceUID: string;
  patientName: string | null;
  patientId: string | null;
  modality: string | null;
  studyDescription: string | null;
  studyDate: string | null;
  priority: string | null;
  reportStatus: string;
  assignedRadiologistId: string | null;
  assignedRadiologistName: string | null;
  isCritical: boolean;
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

export default function RadiologistQueue() {
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<string>("pending");
  const [assignDialog, setAssignDialog] = useState<Study | null>(null);
  const [assignNote, setAssignNote] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["radiologist-queue", activeTab],
    queryFn: () => api.get<{ studies: Study[]; total: number }>(
      `/api/dicom-workflow/radiologist-queue?filter=${activeTab}&limit=100`
    ),
  });

  const assignMut = useMutation({
    mutationFn: ({ id, note }: { id: number; note: string }) =>
      api.patch(`/api/dicom-studies/${id}/assign-radiologist`, { note }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["radiologist-queue"] }); setAssignDialog(null); setAssignNote(""); },
  });

  const createReportMut = useMutation({
    mutationFn: (id: number) => api.post(`/api/dicom-workflow/${id}/create-report`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["radiologist-queue"] }),
  });

  const studies = data?.studies ?? [];

  return (
    <div>
      <PageHeader
        title="Radiologist Queue"
        subtitle="Prioritized worklist for reporting and verification"
      />

      <div className="px-4 sm:px-6 py-4">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="flex-wrap h-auto gap-1">
            {QUEUE_TABS.map((t) => (
              <TabsTrigger key={t.key} value={t.key} className="flex items-center gap-1.5">
                <t.icon className="h-4 w-4" /> {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="px-4 sm:px-6 py-2">
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-8"><Loader2 className="animate-spin h-5 w-5" /> Loading queue...</div>
        ) : studies.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            No cases in this queue filter.
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Patient</TableHead>
                  <TableHead>Modality</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Assigned</TableHead>
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
                    <TableCell>{s.modality || "—"}</TableCell>
                    <TableCell className="max-w-[200px] truncate">{s.studyDescription || "—"}</TableCell>
                    <TableCell className="text-xs">{s.studyDate ? new Date(s.studyDate).toLocaleDateString() : "—"}</TableCell>
                    <TableCell>
                      {s.priority && (
                        <Badge variant={(priorityColors[s.priority] || "outline") as any}>{s.priority.toUpperCase()}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{s.reportStatus.replace(/_/g, " ")}</Badge>
                    </TableCell>
                    <TableCell>{s.assignedRadiologistName || "—"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setLocation(`/radiology/viewer/${encodeURIComponent(s.studyInstanceUID)}`)}><Eye className="h-4 w-4" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => createReportMut.mutate(s.id)} disabled={createReportMut.isPending}>
                          <FilePen className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setAssignDialog(s)}><UserCheck className="h-4 w-4" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <Dialog open={!!assignDialog} onOpenChange={(o) => !o && setAssignDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Assign to Radiologist</DialogTitle></DialogHeader>
          <Textarea placeholder="Assignment note (optional)" value={assignNote} onChange={(e) => setAssignNote(e.target.value)} />
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
