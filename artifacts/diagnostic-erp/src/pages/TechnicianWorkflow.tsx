import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, CheckCircle2, Clock, AlertTriangle, ArrowLeft, Save,
  Scan, UserCheck, ShieldCheck, RotateCcw,
} from "lucide-react";

type Workflow = {
  id: number;
  studyId: number;
  technicianId: string | null;
  technicianName: string | null;
  scanStartedAt: string | null;
  scanCompletedAt: string | null;
  imageQuality: "good" | "acceptable" | "repeat_needed" | null;
  repeatReason: string | null;
  patientCooperation: "good" | "poor" | "sedated" | "emergency" | null;
  contrastUsed: boolean;
  contrastName: string | null;
  contrastDose: string | null;
  adverseReaction: boolean;
  reactionNotes: string | null;
  technicianNotes: string | null;
  createdAt: string;
  updatedAt: string;
};

type Study = {
  id: number;
  patientName: string | null;
  patientId: string | null;
  modality: string | null;
  studyDescription: string | null;
  studyDate: string | null;
};

export default function TechnicianWorkflow({ studyId }: { studyId?: number }) {
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const [searchId, setSearchId] = useState(studyId ? String(studyId) : "");
  const activeId = studyId ?? (searchId ? Number(searchId) : null);

  const { data: study } = useQuery({
    queryKey: ["study", activeId],
    queryFn: () => activeId ? api.get<Study>(`/api/dicom-studies/${activeId}`) : null,
    enabled: !!activeId,
  });

  const { data: workflow, isLoading } = useQuery({
    queryKey: ["technician-workflow", activeId],
    queryFn: () => activeId ? api.get<Workflow>(`/api/dicom-workflow/technician/${activeId}`) : null,
    enabled: !!activeId,
  });

  const [form, setForm] = useState<Partial<Workflow>>({});

  const submitMut = useMutation({
    mutationFn: () => activeId ? api.post<Workflow>(`/api/dicom-workflow/technician/${activeId}`, form) : Promise.reject("No study"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["technician-workflow"] }),
  });

  const completeMut = useMutation({
    mutationFn: () => activeId ? api.post<Workflow>(`/api/dicom-workflow/technician/${activeId}/complete`, {}) : Promise.reject("No study"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["technician-workflow"] }),
  });

  if (!activeId) {
    return (
      <div>
        <PageHeader title="Technician Workflow" subtitle="Select a study to record scan metadata" />
        <div className="px-6 py-8 max-w-md">
          <Label>Study ID</Label>
          <div className="flex gap-2 mt-1">
            <input className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm" placeholder="Enter study ID or go from worklist" value={searchId} onChange={(e) => setSearchId(e.target.value)} />
            <Button onClick={() => setLocation(`/radiology/technician-workflow/${searchId}`)}>Open</Button>
          </div>
          <p className="text-sm text-muted-foreground mt-3">Or navigate from the <button className="underline text-primary" onClick={() => setLocation("/radiology/dicom-study-worklist")}>DICOM Study Worklist</button>.</p>
        </div>
      </div>
    );
  }

  const isComplete = !!workflow?.scanCompletedAt;

  return (
    <div>
      <PageHeader
        title="Technician Workflow"
        subtitle={study ? `${study.patientName || "Unknown"} • ${study.modality || ""} • ${study.studyDescription || ""}` : ""}
        actions={
          <Button variant="outline" size="sm" onClick={() => setLocation("/radiology/dicom-study-worklist")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to Worklist
          </Button>
        }
      />

      <div className="px-4 sm:px-6 py-4 max-w-2xl">
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-8"><Loader2 className="animate-spin h-5 w-5" /> Loading...</div>
        ) : (
          <div className="space-y-6">
            {/* Status bar */}
            <div className="flex items-center gap-3">
              {isComplete ? (
                <Badge variant="default" className="gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Scan Complete</Badge>
              ) : (
                <Badge variant="outline" className="gap-1"><Clock className="h-3.5 w-3.5" /> Scan In Progress</Badge>
              )}
              {workflow?.scanStartedAt && (
                <span className="text-xs text-muted-foreground">Started: {new Date(workflow.scanStartedAt).toLocaleString()}</span>
              )}
              {workflow?.scanCompletedAt && (
                <span className="text-xs text-muted-foreground">Completed: {new Date(workflow.scanCompletedAt).toLocaleString()}</span>
              )}
            </div>

            {/* Quality */}
            <div className="space-y-2">
              <Label>Image Quality</Label>
              <Select value={form.imageQuality || workflow?.imageQuality || ""} onValueChange={(v) => setForm((p) => ({ ...p, imageQuality: v as any }))}>
                <SelectTrigger><SelectValue placeholder="Select quality" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Not rated</SelectItem>
                  <SelectItem value="good">Good</SelectItem>
                  <SelectItem value="acceptable">Acceptable</SelectItem>
                  <SelectItem value="repeat_needed">Repeat Needed</SelectItem>
                </SelectContent>
              </Select>
              {(form.imageQuality === "repeat_needed" || workflow?.imageQuality === "repeat_needed") && (
                <Textarea placeholder="Reason for repeat scan" value={form.repeatReason || workflow?.repeatReason || ""} onChange={(e) => setForm((p) => ({ ...p, repeatReason: e.target.value }))} />
              )}
            </div>

            {/* Cooperation */}
            <div className="space-y-2">
              <Label>Patient Cooperation</Label>
              <Select value={form.patientCooperation || workflow?.patientCooperation || ""} onValueChange={(v) => setForm((p) => ({ ...p, patientCooperation: v as any }))}>
                <SelectTrigger><SelectValue placeholder="Select cooperation level" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Not recorded</SelectItem>
                  <SelectItem value="good">Good</SelectItem>
                  <SelectItem value="poor">Poor</SelectItem>
                  <SelectItem value="sedated">Sedated</SelectItem>
                  <SelectItem value="emergency">Emergency</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Contrast */}
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Switch id="contrast" checked={form.contrastUsed ?? workflow?.contrastUsed ?? false} onCheckedChange={(v) => setForm((p) => ({ ...p, contrastUsed: v }))} />
                <Label htmlFor="contrast">Contrast Used</Label>
              </div>
              {(form.contrastUsed || workflow?.contrastUsed) && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Contrast Name</Label>
                    <input className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm mt-1" placeholder="e.g. Omnipaque 350" value={form.contrastName || workflow?.contrastName || ""} onChange={(e) => setForm((p) => ({ ...p, contrastName: e.target.value }))} />
                  </div>
                  <div>
                    <Label className="text-xs">Dose (mL)</Label>
                    <input className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm mt-1" placeholder="e.g. 100" value={form.contrastDose || workflow?.contrastDose || ""} onChange={(e) => setForm((p) => ({ ...p, contrastDose: e.target.value }))} />
                  </div>
                </div>
              )}
            </div>

            {/* Adverse reaction */}
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Switch id="reaction" checked={form.adverseReaction ?? workflow?.adverseReaction ?? false} onCheckedChange={(v) => setForm((p) => ({ ...p, adverseReaction: v }))} />
                <Label htmlFor="reaction">Adverse Reaction</Label>
              </div>
              {(form.adverseReaction || workflow?.adverseReaction) && (
                <Textarea placeholder="Describe the reaction and management" value={form.reactionNotes || workflow?.reactionNotes || ""} onChange={(e) => setForm((p) => ({ ...p, reactionNotes: e.target.value }))} />
              )}
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label>Technician Notes</Label>
              <Textarea placeholder="Additional notes about the scan" value={form.technicianNotes || workflow?.technicianNotes || ""} onChange={(e) => setForm((p) => ({ ...p, technicianNotes: e.target.value }))} />
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <Button onClick={() => submitMut.mutate()} disabled={submitMut.isPending}>
                <Save className="h-4 w-4 mr-1" /> {submitMut.isPending ? "Saving..." : "Save Workflow"}
              </Button>
              <Button variant="default" onClick={() => completeMut.mutate()} disabled={completeMut.isPending || isComplete}>
                <CheckCircle2 className="h-4 w-4 mr-1" />
                {completeMut.isPending ? "Completing..." : isComplete ? "Scan Complete" : "Complete Scan"}
              </Button>
              {isComplete && (
                <Button variant="outline" onClick={() => { setForm({}); completeMut.mutate(); }}>
                  <RotateCcw className="h-4 w-4 mr-1" /> Re-open Scan
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
