import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  ShieldAlert, ShieldCheck, HelpCircle, Eye, AlertTriangle, Check, X,
  Search, RefreshCw, ExternalLink, Link2, BookOpen, Calendar, User, UserCheck
} from "lucide-react";

type PacsWorklistItem = {
  id: number;
  studyId: number | null;
  patientId: number | null;
  dicomPatientId: string | null;
  patientMatchStatus: string;
  patientName: string;
  age: string | null;
  sex: string | null;
  modality: string;
  studyDescription: string | null;
  studyDate: string | null;
  accessionNumber: string;
  studyInstanceUID: string | null;
  aeTitle: string | null;
  referringDoctor: string | null;
  weasisUrl: string | null;
  sourcePacs: string | null;
  status: string;
  matchScore: "GREEN" | "YELLOW" | "RED";
  matchPoints: number;
  matchReasons: string | null; // JSON array
  matchWarnings: string | null; // JSON array
  matchDecision: "PENDING" | "APPROVED" | "REJECTED";
  matchApprovedBy: string | null;
  matchApprovedAt: string | null;
  matchOverrideReason: string | null;
  // Billed fields joined
  billedTestName?: string;
  billedPatientName?: string;
  billedPatientUHID?: string;
  billedAccessionNumber?: string;
  billedModality?: string;
  billedStudyDate?: string;
  billNumber?: string;
};

type CandidateStudy = {
  study: {
    id: number;
    accessionNumber: string;
    status: string;
    modality: string;
    studyDescription: string | null;
    studyDate: string;
    patientId: number;
    patientName: string;
    patientUHID: string;
    age: string;
    sex: string;
    testName: string;
    billNumber: string | null;
  };
  matchScore: "GREEN" | "YELLOW" | "RED";
  matchPoints: number;
  matchReasons: string[];
  matchWarnings: string[];
};

export default function MyCollection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [isLinkDialogOpen, setIsLinkDialogOpen] = useState(false);
  const [isOverrideDialogOpen, setIsOverrideDialogOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const { data: worklist = [], isLoading, refetch } = useQuery<PacsWorklistItem[]>({
    queryKey: ["/api/radiology/pacs-worklist"],
    queryFn: () => api.get("/api/radiology/pacs-worklist"),
  });

  const selectedItem = worklist.find((item) => item.id === selectedId) || worklist[0];

  const { data: candidatesData } = useQuery<{ candidates: CandidateStudy[] }>({
    queryKey: ["/api/radiology/pacs-worklist", selectedItem?.id, "matching-candidates"],
    queryFn: () => api.get(`/api/radiology/pacs-worklist/${selectedItem.id}/matching-candidates`),
    enabled: !!selectedItem?.id,
  });

  const linkMutation = useMutation({
    mutationFn: ({ worklistId, studyId }: { worklistId: number; studyId: number }) =>
      api.post(`/api/radiology/pacs-worklist/${worklistId}/link-study`, { studyId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/radiology/pacs-worklist"] });
      toast({ title: "Study Linked Successfully", description: "DICOM matching scores have been recalculated." });
      setIsLinkDialogOpen(false);
    },
    onError: (err: any) => {
      toast({ variant: "destructive", title: "Linking Failed", description: err.message });
    },
  });

  const decisionMutation = useMutation({
    mutationFn: ({ worklistId, decision, overrideReason }: { worklistId: number; decision: string; overrideReason?: string }) =>
      api.post(`/api/radiology/pacs-worklist/${worklistId}/match-decision`, { decision, overrideReason }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/radiology/pacs-worklist"] });
      toast({
        title: `Match ${variables.decision === "APPROVED" ? "Approved" : "Rejected"}`,
        description: `The study matching decision has been updated.`,
      });
      setIsOverrideDialogOpen(false);
      setOverrideReason("");
    },
    onError: (err: any) => {
      toast({ variant: "destructive", title: "Action Failed", description: err.message });
    },
  });

  const reasons: string[] = selectedItem?.matchReasons ? JSON.parse(selectedItem.matchReasons) : [];
  const warnings: string[] = selectedItem?.matchWarnings ? JSON.parse(selectedItem.matchWarnings) : [];

  const getScoreBadgeColor = (score: string) => {
    switch (score) {
      case "GREEN":
        return "bg-emerald-500 hover:bg-emerald-600 text-white font-semibold";
      case "YELLOW":
        return "bg-amber-500 hover:bg-amber-600 text-black font-semibold";
      default:
        return "bg-rose-500 hover:bg-rose-600 text-white font-semibold";
    }
  };

  const filteredCandidates = candidatesData?.candidates.filter(c => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      c.study.patientName.toLowerCase().includes(q) ||
      c.study.patientUHID.toLowerCase().includes(q) ||
      c.study.accessionNumber.toLowerCase().includes(q) ||
      c.study.testName.toLowerCase().includes(q)
    );
  }) || [];

  return (
    <div className="flex flex-col gap-6 p-6 min-h-screen bg-slate-50 dark:bg-slate-900">
      <div className="flex justify-between items-center">
        <PageHeader
          title="DICOM Match Center"
          subtitle="Verify auto-pulled PACS studies match billed test orders to prevent mismatch errors and report delivery forgery."
        />
        <Button onClick={() => refetch()} variant="outline" className="gap-2">
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Side: Worklist List */}
        <Card className="lg:col-span-5 h-[calc(100vh-200px)] overflow-y-auto border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-950/80 backdrop-blur-md">
          <CardHeader className="sticky top-0 bg-white dark:bg-slate-950 border-b border-slate-100 dark:border-slate-900 z-10 py-4">
            <CardTitle className="text-lg">PACS Intake Worklist</CardTitle>
            <CardDescription>Pushed DICOM studies and matching status</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex justify-center items-center py-10">
                <RefreshCw className="h-8 w-8 animate-spin text-slate-400" />
              </div>
            ) : worklist.length === 0 ? (
              <div className="text-center py-10 text-slate-500">No PACS studies in worklist</div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-900">
                {worklist.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => {
                      setSelectedId(item.id);
                      // Clear search query on selection change
                      setSearchQuery("");
                    }}
                    className={`flex flex-col gap-2 p-4 cursor-pointer transition-all hover:bg-slate-50 dark:hover:bg-slate-900 ${
                      (selectedItem?.id === item.id) ? "bg-slate-100/80 dark:bg-slate-900/80 border-l-4 border-indigo-500" : ""
                    }`}
                  >
                    <div className="flex justify-between items-start gap-2">
                      <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {item.patientName}
                      </span>
                      <Badge className={getScoreBadgeColor(item.matchScore)}>
                        {item.matchScore} ({item.matchPoints} pts)
                      </Badge>
                    </div>
                    <div className="flex justify-between items-center text-xs text-slate-500 dark:text-slate-400">
                      <span>Modality: {item.modality}</span>
                      <span>Acc: {item.accessionNumber}</span>
                    </div>
                    {item.matchDecision !== "PENDING" && (
                      <div className="flex items-center gap-1.5 text-[11px] font-medium mt-1">
                        {item.matchDecision === "APPROVED" ? (
                          <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                            <ShieldCheck className="h-3 w-3" /> Manually Approved
                          </span>
                        ) : (
                          <span className="text-rose-600 dark:text-rose-400 flex items-center gap-1">
                            <X className="h-3 w-3" /> Rejected
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right Side: Double Panel Side-by-Side Comparison */}
        <div className="lg:col-span-7 flex flex-col gap-6">
          {selectedItem ? (
            <>
              {/* Status Alert Banner */}
              <Card className={`border-l-4 ${
                selectedItem.matchScore === "GREEN" ? "border-l-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20" :
                selectedItem.matchScore === "YELLOW" ? "border-l-amber-500 bg-amber-50/50 dark:bg-amber-950/20" :
                "border-l-rose-500 bg-rose-50/50 dark:bg-rose-950/20"
              }`}>
                <CardContent className="flex items-start gap-4 p-5">
                  <div className={`p-2.5 rounded-full ${
                    selectedItem.matchScore === "GREEN" ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30" :
                    selectedItem.matchScore === "YELLOW" ? "bg-amber-100 text-amber-600 dark:bg-amber-900/30" :
                    "bg-rose-100 text-rose-600 dark:bg-rose-900/30"
                  }`}>
                    {selectedItem.matchScore === "GREEN" ? <ShieldCheck className="h-6 w-6" /> : <ShieldAlert className="h-6 w-6" />}
                  </div>
                  <div className="flex-1 flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-base text-slate-800 dark:text-slate-200">
                        {selectedItem.matchScore === "GREEN" ? "Confident DICOM & Order Match" :
                         selectedItem.matchScore === "YELLOW" ? "Needs Review & Verification" :
                         "Critical Mismatch Flagged"}
                      </span>
                      <Badge variant="outline" className="text-xs">Score: {selectedItem.matchPoints} / 100</Badge>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400">
                      {selectedItem.matchScore === "GREEN" ? "Study has matching patient identifiers. Safe to proceed with reporting and automated delivery." :
                       selectedItem.matchScore === "YELLOW" ? "Minor mismatches or fuzzy spelling detected. Review the details below before signing." :
                       "Warning: The pushed DICOM files do not match the billing order! Action is required to prevent wrong-study diagnostics."}
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* Detail Comparison */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* DICOM Study Detail */}
                <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 shadow-sm">
                  <CardHeader className="py-4 border-b border-slate-100 dark:border-slate-900">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
                      <BookOpen className="h-4 w-4" /> Received DICOM Metadata
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 flex flex-col gap-3.5 text-xs">
                    <div>
                      <Label className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider">Patient Name</Label>
                      <p className="font-bold text-sm text-slate-900 dark:text-slate-100">{selectedItem.patientName}</p>
                    </div>
                    <div>
                      <Label className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider">Patient ID / PatientID Tag</Label>
                      <p className="font-medium text-slate-800 dark:text-slate-200">{selectedItem.dicomPatientId || "—"}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider">Age</Label>
                        <p className="font-medium text-slate-800 dark:text-slate-200">{selectedItem.age || "—"}</p>
                      </div>
                      <div>
                        <Label className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider">Sex</Label>
                        <p className="font-medium text-slate-800 dark:text-slate-200">{selectedItem.sex || "—"}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider">Modality</Label>
                        <p className="font-bold text-slate-800 dark:text-slate-200">{selectedItem.modality}</p>
                      </div>
                      <div>
                        <Label className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider">Study Date</Label>
                        <p className="font-medium text-slate-800 dark:text-slate-200">{selectedItem.studyDate || "—"}</p>
                      </div>
                    </div>
                    <div>
                      <Label className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider">Accession Number</Label>
                      <p className="font-mono font-semibold text-slate-800 dark:text-slate-200 text-xs">{selectedItem.accessionNumber}</p>
                    </div>
                    <div>
                      <Label className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider">Study Description</Label>
                      <p className="font-medium text-slate-800 dark:text-slate-200">{selectedItem.studyDescription || "—"}</p>
                    </div>
                    <div>
                      <Label className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider">StudyInstanceUID</Label>
                      <p className="font-mono text-[10px] text-slate-500 dark:text-slate-400 select-all truncate" title={selectedItem.studyInstanceUID || ""}>
                        {selectedItem.studyInstanceUID || "—"}
                      </p>
                    </div>
                  </CardContent>
                </Card>

                {/* Billed Test Detail */}
                <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 shadow-sm">
                  <CardHeader className="py-4 border-b border-slate-100 dark:border-slate-900">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
                      <Calendar className="h-4 w-4" /> Billed Test Order
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 flex flex-col gap-3.5 text-xs">
                    {selectedItem.studyId ? (
                      <>
                        <div>
                          <Label className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider">Billed Patient Name</Label>
                          <p className="font-bold text-sm text-slate-900 dark:text-slate-100">{selectedItem.billedPatientName}</p>
                        </div>
                        <div>
                          <Label className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider">Patient ID / UHID</Label>
                          <p className="font-medium text-slate-800 dark:text-slate-200">{selectedItem.billedPatientUHID || "—"}</p>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Label className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider">Billed Age / Sex</Label>
                            <p className="font-medium text-slate-800 dark:text-slate-200">
                              {selectedItem.age || "—"} / {selectedItem.sex || "—"}
                            </p>
                          </div>
                          <div>
                            <Label className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider">Bill Number</Label>
                            <p className="font-mono text-slate-800 dark:text-slate-200 font-semibold">{selectedItem.billNumber || "—"}</p>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Label className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider">Billed Modality</Label>
                            <p className="font-bold text-slate-800 dark:text-slate-200">{selectedItem.billedModality || "—"}</p>
                          </div>
                          <div>
                            <Label className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider">Bill Date</Label>
                            <p className="font-medium text-slate-800 dark:text-slate-200">{selectedItem.billedStudyDate || "—"}</p>
                          </div>
                        </div>
                        <div>
                          <Label className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider">Billed Accession Number</Label>
                          <p className="font-mono font-semibold text-slate-800 dark:text-slate-200 text-xs">{selectedItem.billedAccessionNumber || "—"}</p>
                        </div>
                        <div>
                          <Label className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider">Test Name Ordered</Label>
                          <p className="font-semibold text-indigo-700 dark:text-indigo-400">{selectedItem.billedTestName || "—"}</p>
                        </div>
                      </>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full gap-3 py-10 text-center">
                        <Link2 className="h-8 w-8 text-rose-400 stroke-[1.5]" />
                        <span className="font-medium text-rose-500">No Billed Study Linked</span>
                        <p className="text-[11px] text-slate-500 max-w-[200px]">
                          This DICOM study was auto-pulled from PACS but lacks a valid link to a billed radiology test.
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Match Verification Details */}
              <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
                <CardHeader className="py-4 border-b border-slate-100 dark:border-slate-900">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <UserCheck className="h-4 w-4" /> Match Engine Decision Factors
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 flex flex-col gap-4 text-xs">
                  {/* Confirmed points */}
                  {reasons.length > 0 && (
                    <div>
                      <h4 className="font-semibold text-slate-800 dark:text-slate-200 mb-2 flex items-center gap-1.5">
                        <Check className="h-4 w-4 text-emerald-500" /> Match Reasons
                      </h4>
                      <ul className="list-disc pl-5 text-slate-600 dark:text-slate-400 flex flex-col gap-1">
                        {reasons.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Warning signals */}
                  {warnings.length > 0 && (
                    <div className="mt-2">
                      <h4 className="font-semibold text-rose-600 dark:text-rose-400 mb-2 flex items-center gap-1.5">
                        <AlertTriangle className="h-4 w-4" /> Match Warnings (Anti-Forgery Blockers)
                      </h4>
                      <div className="flex flex-col gap-2">
                        {warnings.map((w, i) => (
                          <div key={i} className="flex gap-2 p-2.5 rounded bg-rose-50 dark:bg-rose-950/20 text-rose-800 dark:text-rose-300 font-medium">
                            <span className="shrink-0">•</span>
                            <span>{w}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedItem.matchDecision === "APPROVED" && (
                    <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/50 rounded flex flex-col gap-1 text-[11px] text-emerald-800 dark:text-emerald-400 mt-2">
                      <span className="font-bold flex items-center gap-1">
                        <ShieldCheck className="h-3.5 w-3.5" /> MANUAL OVERRIDE APPROVED
                      </span>
                      <span><strong>Approved By:</strong> {selectedItem.matchApprovedBy}</span>
                      <span><strong>Date:</strong> {selectedItem.matchApprovedAt ? new Date(selectedItem.matchApprovedAt).toLocaleString() : ""}</span>
                      {selectedItem.matchOverrideReason && (
                        <span><strong>Justification:</strong> {selectedItem.matchOverrideReason}</span>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Action Buttons */}
              <div className="flex flex-wrap gap-3 items-center justify-between">
                <div className="flex gap-3">
                  {/* OHIF Link */}
                  {selectedItem.studyInstanceUID && (
                    <Button
                      // Must include the app's own base path — in production
                      // diagnostic-erp is served under /erp/, and a bare /pacs
                      // falls through to the public website's SPA (no matching
                      // nginx route) instead of opening the PACS viewer.
                      onClick={() => window.open(`${import.meta.env.BASE_URL.replace(/\/$/, "")}/pacs?studyInstanceUid=${selectedItem.studyInstanceUID}`, "_blank")}
                      variant="outline"
                      className="gap-1.5"
                    >
                      <Eye className="h-4 w-4" /> Open OHIF
                    </Button>
                  )}

                  {/* Weasis Link */}
                  {selectedItem.weasisUrl && (
                    <Button
                      onClick={() => window.open(selectedItem.weasisUrl!, "_blank")}
                      variant="outline"
                      className="gap-1.5"
                    >
                      <ExternalLink className="h-4 w-4" /> Open Weasis
                    </Button>
                  )}
                </div>

                <div className="flex gap-3">
                  <Button
                    onClick={() => setIsLinkDialogOpen(true)}
                    variant="secondary"
                    className="gap-1.5"
                  >
                    <Link2 className="h-4 w-4" /> Link Correct Study
                  </Button>

                  {selectedItem.matchScore !== "GREEN" && selectedItem.matchDecision !== "APPROVED" ? (
                    <Button
                      onClick={() => setIsOverrideDialogOpen(true)}
                      className="bg-amber-600 hover:bg-amber-700 text-white gap-1.5"
                    >
                      <ShieldCheck className="h-4 w-4" /> Approve Override
                    </Button>
                  ) : selectedItem.matchDecision !== "REJECTED" ? (
                    <Button
                      onClick={() => decisionMutation.mutate({ worklistId: selectedItem.id, decision: "REJECTED" })}
                      variant="destructive"
                      className="gap-1.5"
                    >
                      <X className="h-4 w-4" /> Reject Match
                    </Button>
                  ) : (
                    <Button
                      onClick={() => decisionMutation.mutate({ worklistId: selectedItem.id, decision: "APPROVED", overrideReason: "Re-approved from rejected state" })}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
                    >
                      <Check className="h-4 w-4" /> Re-Approve Match
                    </Button>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-[calc(100vh-200px)] text-slate-400">
              <HelpCircle className="h-16 w-16 stroke-[1.2]" />
              <span className="font-semibold mt-4">Select a PACS Worklist Item to Review</span>
            </div>
          )}
        </div>
      </div>

      {/* Override Justification Dialog */}
      <Dialog open={isOverrideDialogOpen} onOpenChange={setIsOverrideDialogOpen}>
        <DialogContent className="max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <DialogHeader>
            <DialogTitle>Authorize Manual Match Approval</DialogTitle>
            <DialogDescription>
              Provide a valid clinical or administrative justification to override this mismatch warn flag.
              This override is recorded in the immutable audit log.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-4">
            <Label htmlFor="override-reason" className="text-xs font-semibold">Justification Reason</Label>
            <Input
              id="override-reason"
              placeholder="e.g. Minor spelling typo on billing console; patient details verified manually."
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsOverrideDialogOpen(false)}>Cancel</Button>
            <Button
              disabled={!overrideReason.trim() || decisionMutation.isPending}
              onClick={() => decisionMutation.mutate({
                worklistId: selectedItem!.id,
                decision: "APPROVED",
                overrideReason
              })}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              Approve Override
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manual Link Study Dialog */}
      <Dialog open={isLinkDialogOpen} onOpenChange={setIsLinkDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <DialogHeader>
            <DialogTitle>Link Correct Billed Study</DialogTitle>
            <DialogDescription>
              Select a billed radiology study from the order book to manually associate with this PACS DICOM study.
            </DialogDescription>
          </DialogHeader>

          {/* Search box */}
          <div className="flex gap-2 items-center my-3">
            <Search className="h-4 w-4 text-slate-400 shrink-0" />
            <Input
              placeholder="Search by patient name, UHID, accession number, or test name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full"
            />
          </div>

          <div className="flex flex-col gap-3">
            <div className="text-xs font-bold text-slate-500 tracking-wide uppercase">Available Billed Studies</div>
            <div className="border border-slate-100 dark:border-slate-800 rounded divide-y divide-slate-100 dark:divide-slate-800 max-h-[50vh] overflow-y-auto">
              {filteredCandidates.length === 0 ? (
                <div className="text-center py-8 text-slate-500 text-xs">No matching billed studies found</div>
              ) : (
                filteredCandidates.map((cand) => (
                  <div key={cand.study.id} className="p-3.5 flex items-center justify-between gap-4 text-xs hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors">
                    <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-slate-900 dark:text-slate-100">{cand.study.patientName}</span>
                        <Badge variant="outline">{cand.study.patientUHID}</Badge>
                        <Badge className={getScoreBadgeColor(cand.matchScore)}>
                          {cand.matchScore} ({cand.matchPoints} pts)
                        </Badge>
                      </div>
                      <div className="text-slate-500 dark:text-slate-400 grid grid-cols-2 gap-y-1">
                        <span><strong>Test:</strong> {cand.study.testName}</span>
                        <span><strong>Accession:</strong> {cand.study.accessionNumber}</span>
                        <span><strong>Modality:</strong> {cand.study.modality}</span>
                        <span><strong>Bill Date:</strong> {cand.study.studyDate}</span>
                      </div>
                      {cand.matchWarnings.length > 0 && (
                        <div className="text-[11px] text-rose-500 font-medium flex items-center gap-1 mt-1">
                          <AlertTriangle className="h-3 w-3 shrink-0" /> {cand.matchWarnings[0]}
                        </div>
                      )}
                    </div>
                    <Button
                      size="sm"
                      onClick={() => linkMutation.mutate({ worklistId: selectedItem!.id, studyId: cand.study.id })}
                      disabled={linkMutation.isPending}
                      className="shrink-0 gap-1"
                    >
                      <Link2 className="h-3.5 w-3.5" /> Link Study
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setIsLinkDialogOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
