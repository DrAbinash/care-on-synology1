/**
 * Smart Radiology Platform Cards — Phase 10.1
 * All 9 feature cards in one module for clean integration into:
 *   - PacsDashboard.tsx (Command Center) → operational cards
 *   - RadiologySettings.tsx → AI/config cards
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Loader2, BrainCircuit, ShieldCheck, AlertTriangle, CheckCircle2, XCircle,
  ListChecks, TrendingUp, Timer, AlertOctagon, Route, ClipboardEdit,
  MonitorSmartphone, Send, RotateCcw, Archive, Globe, Sparkles, Zap,
} from "lucide-react";

// ────────────────────────────────────────────────────────────────────────
// 1. AI Impression Assistant Card
// ────────────────────────────────────────────────────────────────────────

const MODALITIES = [
  { value: "USG_ABDOMEN", label: "USG Abdomen" },
  { value: "USG_PELVIS", label: "USG Pelvis" },
  { value: "OB_GROWTH", label: "OB Growth" },
  { value: "DOPPLER", label: "Doppler" },
  { value: "CT_BRAIN", label: "CT Brain" },
  { value: "MRI_BRAIN", label: "MRI Brain" },
  { value: "MRI_SPINE", label: "MRI Spine" },
];

export function AiImpressionCard() {
  const qc = useQueryClient();
  const [studyId, setStudyId] = useState("");
  const [modality, setModality] = useState("USG_ABDOMEN");
  const [findings, setFindings] = useState("");
  const [results, setResults] = useState<any[]>([]);

  const genMut = useMutation({
    mutationFn: () => api.post<any>(`/api/smart-radiology/ai-impressions/${studyId}`, { modality, findingsText: findings }),
    onSuccess: (r) => { setResults((p) => [r, ...p]); qc.invalidateQueries({ queryKey: ["ai-impressions", studyId] }); },
  });

  return (
    <div className="rounded-xl border bg-card p-4 space-y-4">
      <div className="flex items-center gap-2">
        <BrainCircuit className="h-5 w-5 text-primary" />
        <h3 className="font-semibold">AI Impression Assistant</h3>
        <Badge variant="outline" className="text-xs">Never auto-finalizes</Badge>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Input placeholder="Study ID" value={studyId} onChange={(e) => setStudyId(e.target.value)} />
        <Select value={modality} onValueChange={setModality}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{MODALITIES.map((m) => (<SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>))}</SelectContent>
        </Select>
        <Button onClick={() => genMut.mutate()} disabled={genMut.isPending || !studyId || !findings}>
          {genMut.isPending ? <Loader2 className="animate-spin h-4 w-4 mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />} Generate
        </Button>
      </div>
      <Textarea placeholder="Paste findings text here..." value={findings} onChange={(e) => setFindings(e.target.value)} rows={4} />
      {results.length > 0 && (
        <div className="space-y-2">
          {results.map((r) => (
            <div key={r.id} className="rounded-lg border p-3 bg-muted/30">
              <div className="flex items-center justify-between mb-1">
                <Badge variant="secondary" className="text-xs gap-1"><BrainCircuit className="h-3 w-3" /> AI Suggestion</Badge>
                <span className="text-xs text-muted-foreground">{r.modality}</span>
              </div>
              <p className="text-sm whitespace-pre-wrap">{r.aiGeneratedImpression}</p>
              <div className="flex gap-2 mt-2">
                <Button size="sm" variant="outline" onClick={() => api.patch(`/api/smart-radiology/ai-impressions/${r.id}/verify`, {})}><CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Verify</Button>
                <Button size="sm" variant="ghost" onClick={() => api.patch(`/api/smart-radiology/ai-impressions/${r.id}/reject`, {})}><XCircle className="h-3.5 w-3.5 mr-1" /> Reject</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// 2. Quality Checker Card
// ────────────────────────────────────────────────────────────────────────

export function QualityCheckerCard() {
  const qc = useQueryClient();
  const [draftId, setDraftId] = useState("");
  const [findings, setFindings] = useState("");
  const [impression, setImpression] = useState("");
  const [lastResult, setLastResult] = useState<any>(null);

  const checkMut = useMutation({
    mutationFn: () => api.post<any>(`/api/smart-radiology/quality-check/${draftId}`, { findingsText: findings, impressionText: impression }),
    onSuccess: (r) => { setLastResult(r); qc.invalidateQueries({ queryKey: ["quality-check", draftId] }); },
  });

  const resultColor = (r: string) =>
    r === "PASS" ? "bg-green-100 text-green-800 border-green-200" :
    r === "WARNING" ? "bg-yellow-100 text-yellow-800 border-yellow-200" :
    "bg-red-100 text-red-800 border-red-200";

  const details = lastResult?.detailsJson ? JSON.parse(lastResult.detailsJson) : null;

  return (
    <div className="rounded-xl border bg-card p-4 space-y-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-primary" />
        <h3 className="font-semibold">Report Quality Checker</h3>
        <Badge variant="outline" className="text-xs">Pre-finalization</Badge>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Input placeholder="Report Draft ID" value={draftId} onChange={(e) => setDraftId(e.target.value)} />
        <div className="col-span-2 flex gap-2">
          <Button className="flex-1" onClick={() => checkMut.mutate()} disabled={checkMut.isPending || !draftId}>
            {checkMut.isPending ? <Loader2 className="animate-spin h-4 w-4 mr-1" /> : <ShieldCheck className="h-4 w-4 mr-1" />} Run Quality Check
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Textarea placeholder="Findings text" value={findings} onChange={(e) => setFindings(e.target.value)} rows={3} />
        <Textarea placeholder="Impression text" value={impression} onChange={(e) => setImpression(e.target.value)} rows={3} />
      </div>
      {lastResult && (
        <div className="rounded-lg border p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Badge className={`${resultColor(lastResult.overallResult)} border`}>{lastResult.overallResult}</Badge>
            <span className="text-xs text-muted-foreground">Checked at {new Date(lastResult.checkedAt).toLocaleString()}</span>
          </div>
          {details?.checks && (
            <div className="grid grid-cols-2 gap-2 text-sm">
              {Object.entries(details.checks).map(([k, v]) => (
                <div key={k} className={`flex items-center gap-1.5 rounded px-2 py-1 ${v ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>
                  {v ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  <span className="capitalize">{k.replace(/([A-Z])/g, " $1").trim()}</span>
                </div>
              ))}
            </div>
          )}
          {lastResult.overallResult !== "PASS" && (
            <Button size="sm" variant="outline" onClick={() => api.patch(`/api/smart-radiology/quality-check/${lastResult.id}/acknowledge`, {})}>
              <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Acknowledge Warnings
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// 3. Follow-Up Recommendations Card
// ────────────────────────────────────────────────────────────────────────

export function FollowUpRecommendationsCard() {
  const qc = useQueryClient();
  const [draftId, setDraftId] = useState("");
  const [findings, setFindings] = useState("");
  const [impression, setImpression] = useState("");
  const [generated, setGenerated] = useState<any[]>([]);

  const genMut = useMutation({
    mutationFn: () => api.post<any>(`/api/smart-radiology/follow-up/${draftId}`, { findingsText: findings, impressionText: impression }),
    onSuccess: (r) => { setGenerated(r.generated); qc.invalidateQueries({ queryKey: ["follow-up", draftId] }); },
  });

  const acceptMut = useMutation({
    mutationFn: (id: number) => api.patch(`/api/smart-radiology/follow-up/${id}/accept`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["follow-up", draftId] }),
  });

  return (
    <div className="rounded-xl border bg-card p-4 space-y-4">
      <div className="flex items-center gap-2">
        <ListChecks className="h-5 w-5 text-primary" />
        <h3 className="font-semibold">Follow-Up Recommendations</h3>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Input placeholder="Report Draft ID" value={draftId} onChange={(e) => setDraftId(e.target.value)} />
        <Button className="col-span-2" onClick={() => genMut.mutate()} disabled={genMut.isPending || !draftId || !findings}>
          {genMut.isPending ? <Loader2 className="animate-spin h-4 w-4 mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />} Generate Recommendations
        </Button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Textarea placeholder="Findings text" value={findings} onChange={(e) => setFindings(e.target.value)} rows={2} />
        <Textarea placeholder="Impression text" value={impression} onChange={(e) => setImpression(e.target.value)} rows={2} />
      </div>
      {generated.length > 0 && (
        <div className="space-y-2">
          {generated.map((r: any) => (
            <div key={r.id} className="flex items-start gap-2 rounded-lg border p-2.5">
              <Badge variant={r.priority === "stat" ? "destructive" : r.priority === "urgent" ? "default" : "outline"}>{r.priority.toUpperCase()}</Badge>
              <div className="flex-1 min-w-0">
                <p className="text-sm">{r.recommendationText}</p>
                <p className="text-xs text-muted-foreground">Rule: {r.triggerRule}</p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => acceptMut.mutate(r.id)} disabled={acceptMut.isPending}><CheckCircle2 className="h-4 w-4" /></Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// 4. Template Learning Card
// ────────────────────────────────────────────────────────────────────────

export function TemplateLearningCard() {
  const qc = useQueryClient();
  const { data: templates } = useQuery({
    queryKey: ["templates"],
    queryFn: () => api.get<any[]>("/api/smart-radiology/templates"),
  });
  const [name, setName] = useState("");
  const [modality, setModality] = useState("");
  const [content, setContent] = useState("");

  const saveMut = useMutation({
    mutationFn: () => api.post("/api/smart-radiology/templates", { name, modality: modality || undefined, content }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["templates"] }); setName(""); setContent(""); },
  });

  const delMut = useMutation({
    mutationFn: (id: number) => api.delete(`/api/smart-radiology/templates/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["templates"] }),
  });

  return (
    <div className="rounded-xl border bg-card p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Zap className="h-5 w-5 text-primary" />
        <h3 className="font-semibold">Template Learning</h3>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Input placeholder="Template name" value={name} onChange={(e) => setName(e.target.value)} />
        <Input placeholder="Modality (optional)" value={modality} onChange={(e) => setModality(e.target.value)} />
        <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !name || !content}>
          {saveMut.isPending ? <Loader2 className="animate-spin h-4 w-4 mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />} Save Template
        </Button>
      </div>
      <Textarea placeholder="Template content..." value={content} onChange={(e) => setContent(e.target.value)} rows={3} />
      {templates && templates.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Name</TableHead><TableHead>Modality</TableHead><TableHead className="text-right">Actions</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell>{t.modality || "—"}</TableCell>
                  <TableCell className="text-right"><Button size="sm" variant="ghost" onClick={() => delMut.mutate(t.id)} disabled={delMut.isPending}><XCircle className="h-4 w-4" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// 5. Multi-Language Reporting Card
// ────────────────────────────────────────────────────────────────────────

export function MultiLanguageCard() {
  const qc = useQueryClient();
  const [draftId, setDraftId] = useState("");
  const [reportText, setReportText] = useState("");
  const [translation, setTranslation] = useState<any>(null);

  const genMut = useMutation({
    mutationFn: () => api.post<any>(`/api/smart-radiology/translations/${draftId}`, { reportText }),
    onSuccess: (r) => { setTranslation(r); qc.invalidateQueries({ queryKey: ["translations", draftId] }); },
  });

  return (
    <div className="rounded-xl border bg-card p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Globe className="h-5 w-5 text-primary" />
        <h3 className="font-semibold">Multi-Language Reporting</h3>
        <Badge variant="outline" className="text-xs">Original report unchanged</Badge>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Input placeholder="Report Draft ID" value={draftId} onChange={(e) => setDraftId(e.target.value)} />
        <Button className="col-span-2" onClick={() => genMut.mutate()} disabled={genMut.isPending || !draftId || !reportText}>
          {genMut.isPending ? <Loader2 className="animate-spin h-4 w-4 mr-1" /> : <Globe className="h-4 w-4 mr-1" />} Generate Hindi Summary
        </Button>
      </div>
      <Textarea placeholder="Report text to translate..." value={reportText} onChange={(e) => setReportText(e.target.value)} rows={3} />
      {translation && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-lg border p-3 bg-muted/30">
            <Badge variant="outline" className="mb-2">Hindi Summary</Badge>
            <p className="text-sm whitespace-pre-wrap">{translation.hindiSummary}</p>
          </div>
          <div className="rounded-lg border p-3 bg-muted/30">
            <Badge variant="outline" className="mb-2">Bilingual</Badge>
            <p className="text-sm whitespace-pre-wrap">{translation.bilingualSummary}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// 6. SLA / TAT Dashboard Card
// ────────────────────────────────────────────────────────────────────────

export function TatDashboardCard() {
  const [filter, setFilter] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["tat-metrics", filter],
    queryFn: () => api.get<any>(`/api/smart-radiology/tat-metrics${filter ? `?${filter}` : ""}`),
  });

  const metrics = data?.metrics ?? [];
  const agg = data?.aggregate ?? {};

  return (
    <div className="rounded-xl border bg-card p-4 space-y-4">
      <div className="flex items-center gap-2">
        <TrendingUp className="h-5 w-5 text-primary" />
        <h3 className="font-semibold">SLA / TAT Dashboard</h3>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg border p-3 text-center"><div className="text-2xl font-bold">{agg.totalCount ?? 0}</div><div className="text-xs text-muted-foreground">Total Studies</div></div>
        <div className="rounded-lg border p-3 text-center"><div className="text-2xl font-bold text-yellow-600">{agg.delayedCount ?? 0}</div><div className="text-xs text-muted-foreground">Delayed</div></div>
        <div className="rounded-lg border p-3 text-center"><div className="text-2xl font-bold text-red-600">{agg.breachedCount ?? 0}</div><div className="text-xs text-muted-foreground">SLA Breached</div></div>
        <div className="rounded-lg border p-3 text-center"><div className="text-2xl font-bold">{agg.avgTotal ? Math.round(agg.avgTotal) : 0}m</div><div className="text-xs text-muted-foreground">Avg TAT</div></div>
      </div>
      {isLoading ? (
        <div className="text-muted-foreground text-sm py-4"><Loader2 className="animate-spin h-4 w-4 inline mr-1" /> Loading...</div>
      ) : metrics.length === 0 ? (
        <div className="text-center py-6 text-muted-foreground text-sm">No TAT metrics recorded yet.</div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Study</TableHead><TableHead>Modality</TableHead><TableHead>Priority</TableHead><TableHead>Total TAT</TableHead><TableHead>SLA</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {metrics.slice(0, 10).map((m: any) => (
                <TableRow key={m.id}>
                  <TableCell className="font-mono text-xs">{m.accessionNumber || m.studyId}</TableCell>
                  <TableCell>{m.modality || "—"}</TableCell>
                  <TableCell><Badge variant="outline">{m.priority}</Badge></TableCell>
                  <TableCell>{m.totalTatMinutes ?? "—"}m</TableCell>
                  <TableCell>{m.slaBreached ? <Badge variant="destructive">Breach</Badge> : <Badge variant="default">OK</Badge>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// 7. DICOM Routing Rules Card
// ────────────────────────────────────────────────────────────────────────

export function RoutingRulesCard() {
  const qc = useQueryClient();
  const { data: rules } = useQuery({
    queryKey: ["routing-rules"],
    queryFn: () => api.get<any[]>("/api/smart-radiology/routing-rules"),
  });
  const [name, setName] = useState("");
  const [modality, setModality] = useState("");
  const [targetQueue, setTargetQueue] = useState("");

  const saveMut = useMutation({
    mutationFn: () => api.post("/api/smart-radiology/routing-rules", { name, modality: modality || undefined, targetQueue }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["routing-rules"] }); setName(""); setTargetQueue(""); },
  });

  const delMut = useMutation({
    mutationFn: (id: number) => api.delete(`/api/smart-radiology/routing-rules/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["routing-rules"] }),
  });

  return (
    <div className="rounded-xl border bg-card p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Route className="h-5 w-5 text-primary" />
        <h3 className="font-semibold">DICOM Routing Rules</h3>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <Input placeholder="Rule name" value={name} onChange={(e) => setName(e.target.value)} />
        <Input placeholder="Modality filter" value={modality} onChange={(e) => setModality(e.target.value)} />
        <Input placeholder="Target queue" value={targetQueue} onChange={(e) => setTargetQueue(e.target.value)} />
        <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !name || !targetQueue}>
          {saveMut.isPending ? <Loader2 className="animate-spin h-4 w-4 mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />} Add Rule
        </Button>
      </div>
      {rules && rules.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Name</TableHead><TableHead>Modality</TableHead><TableHead>Queue</TableHead><TableHead className="text-right">Actions</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell>{r.modality || "Any"}</TableCell>
                  <TableCell><Badge variant="outline">{r.targetQueue}</Badge></TableCell>
                  <TableCell className="text-right"><Button size="sm" variant="ghost" onClick={() => delMut.mutate(r.id)} disabled={delMut.isPending}><XCircle className="h-4 w-4" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// 8. Report Amendment Manager Card
// ────────────────────────────────────────────────────────────────────────

export function AmendmentManagerCard() {
  const qc = useQueryClient();
  const [draftId, setDraftId] = useState("");
  const [priorContent, setPriorContent] = useState("");
  const [addendum, setAddendum] = useState("");
  const [reason, setReason] = useState("");
  const [amendments, setAmendments] = useState<any[]>([]);

  const loadMut = useMutation({
    mutationFn: () => api.get<any[]>(`/api/smart-radiology/amendments/${draftId}`),
    onSuccess: (r) => setAmendments(r),
  });

  const createMut = useMutation({
    mutationFn: () => api.post(`/api/smart-radiology/amendments/${draftId}`, { priorContent, addendumText: addendum, amendmentReason: reason }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["amendments", draftId] }); loadMut.mutate(); setAddendum(""); setReason(""); },
  });

  return (
    <div className="rounded-xl border bg-card p-4 space-y-4">
      <div className="flex items-center gap-2">
        <ClipboardEdit className="h-5 w-5 text-primary" />
        <h3 className="font-semibold">Amendment / Addendum Manager</h3>
        <Badge variant="outline" className="text-xs">Immutable finalized reports</Badge>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Input placeholder="Report Draft ID" value={draftId} onChange={(e) => setDraftId(e.target.value)} />
        <Button variant="outline" onClick={() => loadMut.mutate()} disabled={loadMut.isPending || !draftId}>
          {loadMut.isPending ? <Loader2 className="animate-spin h-4 w-4 mr-1" /> : <Archive className="h-4 w-4 mr-1" />} Load History
        </Button>
        <Button onClick={() => createMut.mutate()} disabled={createMut.isPending || !draftId || !priorContent || !addendum || !reason}>
          {createMut.isPending ? <Loader2 className="animate-spin h-4 w-4 mr-1" /> : <ClipboardEdit className="h-4 w-4 mr-1" />} Create Amendment
        </Button>
      </div>
      <Textarea placeholder="Prior report content (copy finalized report here)" value={priorContent} onChange={(e) => setPriorContent(e.target.value)} rows={3} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Textarea placeholder="Addendum text" value={addendum} onChange={(e) => setAddendum(e.target.value)} rows={2} />
        <Textarea placeholder="Amendment reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
      </div>
      {amendments.length > 0 && (
        <div className="space-y-2">
          {amendments.map((a) => (
            <div key={a.id} className="rounded-lg border p-3 bg-muted/30">
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="destructive">{a.amendmentLabel}</Badge>
                <span className="text-xs text-muted-foreground">By {a.amendedByName} • {new Date(a.amendedAt).toLocaleString()}</span>
              </div>
              <p className="text-xs text-muted-foreground">Reason: {a.amendmentReason}</p>
              <p className="text-sm mt-1">{a.addendumText}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// 9. Mobile Sonographer Mode Card
// ────────────────────────────────────────────────────────────────────────

export function SonographerModeCard() {
  const qc = useQueryClient();
  const [studyId, setStudyId] = useState("");
  const [measurements, setMeasurements] = useState("");
  const [keyImages, setKeyImages] = useState("");
  const [dictation, setDictation] = useState("");
  const [draftText, setDraftText] = useState("");

  const createMut = useMutation({
    mutationFn: () => api.post("/api/smart-radiology/sonographer-drafts", {
      studyId: Number(studyId), approvedMeasurementsJson: measurements, keyImageIdsJson: keyImages,
      voiceDictationText: dictation, draftReportText: draftText,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sonographer-drafts"] }),
  });

  return (
    <div className="rounded-xl border bg-card p-4 space-y-4">
      <div className="flex items-center gap-2">
        <MonitorSmartphone className="h-5 w-5 text-primary" />
        <h3 className="font-semibold">Mobile Sonographer Mode</h3>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input placeholder="Study ID" value={studyId} onChange={(e) => setStudyId(e.target.value)} />
        <Input placeholder="Key image IDs (JSON array)" value={keyImages} onChange={(e) => setKeyImages(e.target.value)} />
      </div>
      <Textarea placeholder="Approved measurements JSON" value={measurements} onChange={(e) => setMeasurements(e.target.value)} rows={2} />
      <Textarea placeholder="Voice dictation transcript" value={dictation} onChange={(e) => setDictation(e.target.value)} rows={2} />
      <Textarea placeholder="Draft report text" value={draftText} onChange={(e) => setDraftText(e.target.value)} rows={3} />
      <div className="flex gap-2">
        <Button onClick={() => createMut.mutate()} disabled={createMut.isPending || !studyId}>
          {createMut.isPending ? <Loader2 className="animate-spin h-4 w-4 mr-1" /> : <Send className="h-4 w-4 mr-1" />} Save Draft
        </Button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// 10. DICOM SR Export Queue Card
// ────────────────────────────────────────────────────────────────────────

export function DicomSrExportCard() {
  const qc = useQueryClient();
  const { data: queue } = useQuery({
    queryKey: ["dicom-sr-export"],
    queryFn: () => api.get<any[]>("/api/smart-radiology/dicom-sr-export"),
  });
  const [studyId, setStudyId] = useState("");
  const [measurements, setMeasurements] = useState("");

  const createMut = useMutation({
    mutationFn: () => api.post("/api/smart-radiology/dicom-sr-export", { studyId: Number(studyId), measurementsJson: measurements }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dicom-sr-export"] }),
  });

  const retryMut = useMutation({
    mutationFn: (id: number) => api.patch(`/api/smart-radiology/dicom-sr-export/${id}/retry`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dicom-sr-export"] }),
  });

  return (
    <div className="rounded-xl border bg-card p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Archive className="h-5 w-5 text-primary" />
        <h3 className="font-semibold">DICOM SR Export Queue</h3>
        <Badge variant="outline" className="text-xs">Future PACS send hook</Badge>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Input placeholder="Study ID" value={studyId} onChange={(e) => setStudyId(e.target.value)} />
        <Input placeholder="Measurements JSON" value={measurements} onChange={(e) => setMeasurements(e.target.value)} />
        <Button onClick={() => createMut.mutate()} disabled={createMut.isPending || !studyId}>
          {createMut.isPending ? <Loader2 className="animate-spin h-4 w-4 mr-1" /> : <Send className="h-4 w-4 mr-1" />} Queue Export
        </Button>
      </div>
      {queue && queue.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Study</TableHead><TableHead>Status</TableHead><TableHead>Attempts</TableHead><TableHead className="text-right">Actions</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {queue.map((q) => (
                <TableRow key={q.id}>
                  <TableCell className="font-mono text-xs">{q.studyId}</TableCell>
                  <TableCell><Badge variant="outline">{q.exportStatus}</Badge></TableCell>
                  <TableCell>{q.exportAttemptCount}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => retryMut.mutate(q.id)} disabled={retryMut.isPending}><RotateCcw className="h-4 w-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
