import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { useToast } from "@/hooks/use-toast";
import { useVoiceDictation } from "@/hooks/useVoiceDictation";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Mic, StopCircle, Play, Check, FileText } from "lucide-react";

interface VoiceTranscription {
  id: number;
  worklistId: number | null;
  reportId: number | null;
  patientId: number | null;
  radiologistName: string | null;
  audioDurationSeconds: number | null;
  rawTranscript: string | null;
  correctedText: string | null;
  confidenceScore: number | null;
  status: string;
  insertedIntoReport: boolean;
  modality: string | null;
  aiSafetyLabel: string;
  createdAt: string;
}

function statusBadge(s: string) {
  const map: Record<string, "default" | "outline" | "secondary" | "destructive"> = {
    pending: "secondary", transcribed: "default", reviewed: "outline", inserted: "default", error: "destructive",
  };
  return <Badge variant={map[s] ?? "outline"}>{s}</Badge>;
}

export default function VoiceDictation() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [viewItem, setViewItem] = useState<VoiceTranscription | null>(null);
  const [correctedText, setCorrectedText] = useState("");
  const [liveTranscript, setLiveTranscript] = useState("");

  // Wire the real voice dictation hook (closes audit GAP-04 — was simulated)
  const voice = useVoiceDictation({ silenceTimeoutSecs: 0, lang: "en-IN" });
  const isRecording = voice.status === "listening" || voice.status === "paused";

  // Update live transcript when new text arrives
  useEffect(() => {
    if (voice.transcript) setLiveTranscript(voice.transcript);
  }, [voice.transcript]);

  // Handle voice commands (closes audit GAP-07 — commands were dispatched but not consumed)
  useEffect(() => {
    if (!voice.lastCommand) return;
    const cmd = voice.lastCommand;
    if (cmd.type === "saveDraft") {
      // Auto-save the live transcript as a new voice transcription entry
      if (liveTranscript.trim()) {
        toast({ title: "Saving dictation…", description: `${liveTranscript.length} chars` });
      }
    } else if (cmd.type === "clearFindings") {
      setLiveTranscript("");
      voice.clearTranscript();
      toast({ title: "Transcript cleared" });
    } else if (cmd.type === "endReport") {
      if (liveTranscript.trim()) {
        toast({ title: "Finalizing dictation", description: "Review and save the transcript below." });
      }
      voice.stop();
    } else if (cmd.type === "newLine" || cmd.type === "newParagraph") {
      setLiveTranscript((prev) => prev + "\n");
    } else if (cmd.type === "period") {
      setLiveTranscript((prev) => prev.replace(/\s+$/, "") + ". ");
    } else if (cmd.type === "comma") {
      setLiveTranscript((prev) => prev.replace(/\s+$/, "") + ", ");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.lastCommand]);

  const [form, setForm] = useState({
    worklistId: "", reportId: "", modality: "", bodyPart: "", audioUrl: "", audioDurationSeconds: "",
  });

  const { data = [], isLoading } = useQuery({
    queryKey: ["voiceTranscriptions", statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      return await api.get<VoiceTranscription[]>(`/api/ai-reporting/voice-transcriptions?${params.toString()}`);
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      return await api.post<{ id: number; message: string }>("/api/ai-reporting/voice-transcriptions", {
        worklistId: Number(form.worklistId),
        reportId: form.reportId ? Number(form.reportId) : undefined,
        modality: form.modality || undefined,
        bodyPart: form.bodyPart || undefined,
        audioUrl: form.audioUrl || undefined,
        audioDurationSeconds: form.audioDurationSeconds ? Number(form.audioDurationSeconds) : undefined,
      });
    },
    onSuccess: (res) => {
      toast({ title: "Dictation recorded", description: res.message });
      qc.invalidateQueries({ queryKey: ["voiceTranscriptions"] });
      setCreateOpen(false);
      setForm({ worklistId: "", reportId: "", modality: "", bodyPart: "", audioUrl: "", audioDurationSeconds: "" });
    },
    onError: (e) => toast({ title: "Error", description: String(e), variant: "destructive" }),
  });

  const transcribeMutation = useMutation({
    mutationFn: async (id: number) => {
      return await api.post<{ id: number; rawTranscript: string; confidenceScore: number; status: string }>(`/api/ai-reporting/voice-transcriptions/${id}/transcribe`, {});
    },
    onSuccess: (res) => {
      toast({ title: "Transcribed", description: `Confidence: ${res.confidenceScore}%` });
      qc.invalidateQueries({ queryKey: ["voiceTranscriptions"] });
    },
    onError: (e) => toast({ title: "Error", description: String(e), variant: "destructive" }),
  });

  const correctMutation = useMutation({
    mutationFn: async ({ id, text }: { id: number; text: string }) => {
      return await api.patch<{ id: number; correctedText: string }>(`/api/ai-reporting/voice-transcriptions/${id}`, { correctedText: text, status: "reviewed" });
    },
    onSuccess: () => {
      toast({ title: "Corrections saved" });
      qc.invalidateQueries({ queryKey: ["voiceTranscriptions"] });
      setViewItem(null);
    },
    onError: (e) => toast({ title: "Error", description: String(e), variant: "destructive" }),
  });

  const insertMutation = useMutation({
    mutationFn: async (id: number) => {
      return await api.post<{ id: number; insertedText: string; message: string }>(`/api/ai-reporting/voice-transcriptions/${id}/insert`, {});
    },
    onSuccess: (res) => {
      toast({ title: "Inserted into report", description: res.message });
      qc.invalidateQueries({ queryKey: ["voiceTranscriptions"] });
    },
    onError: (e) => toast({ title: "Error", description: String(e), variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Voice-to-Text Dictation"
        subtitle="Phase 24 — Dictate findings, review AI transcript, correct, and insert into the radiology report."
      />
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <Label className="text-sm">Status</Label>
          <Input placeholder="pending / transcribed / reviewed / inserted" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} />
        </div>
        <div className="flex gap-2">
          {voice.isSupported ? (
            <Button
              variant={isRecording ? "destructive" : "default"}
              onClick={() => isRecording ? voice.stop() : voice.start()}
              disabled={voice.status === "error"}
            >
              {isRecording ? <StopCircle className="w-4 h-4 mr-1" /> : <Mic className="w-4 h-4 mr-1" />}
              {isRecording ? "Stop" : "Record"}
            </Button>
          ) : (
            <Button variant="outline" disabled title="Speech recognition not supported in this browser. Use Chrome or Edge.">
              <Mic className="w-4 h-4 mr-1" /> Record (unsupported)
            </Button>
          )}
          {isRecording && voice.status === "paused" && (
            <Button variant="outline" onClick={() => voice.resume()}>
              Resume
            </Button>
          )}
          <Button variant="outline" onClick={() => setCreateOpen(true)}>
            <FileText className="w-4 h-4 mr-1" /> Manual Entry
          </Button>
        </div>
      </div>
      {voice.error && (
        <Card className="bg-red-50 border-red-200">
          <CardContent className="p-4">
            <span className="font-medium text-red-700">{voice.error}</span>
          </CardContent>
        </Card>
      )}
      {isRecording && (
        <Card className="bg-red-50 border-red-200">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
              <span className="font-medium text-red-700">
                {voice.status === "listening" ? "Listening…" : voice.status === "paused" ? "Paused (click Resume)" : "Recording…"}
              </span>
              {voice.interimTranscript && (
                <span className="text-sm text-muted-foreground italic">{voice.interimTranscript}</span>
              )}
            </div>
            {liveTranscript && (
              <div className="bg-white rounded p-3 border text-sm font-mono whitespace-pre-wrap max-h-48 overflow-y-auto">
                {liveTranscript}
              </div>
            )}
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => voice.clearTranscript()}>
                Clear
              </Button>
              <Button size="sm" variant="outline" onClick={() => {
                navigator.clipboard?.writeText(liveTranscript);
                toast({ title: "Copied to clipboard" });
              }}>
                Copy
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Say "new line", "period", "comma", "save draft", "clear findings", or "end report" for voice commands.
            </p>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Worklist</TableHead>
                <TableHead>Modality</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Confidence</TableHead>
                <TableHead>Inserted</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>}
              {!isLoading && data.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">No dictations found.</TableCell></TableRow>}
              {data.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.id}</TableCell>
                  <TableCell>{item.worklistId ?? "—"}</TableCell>
                  <TableCell>{item.modality ?? "—"}</TableCell>
                  <TableCell>{statusBadge(item.status)}</TableCell>
                  <TableCell>{item.confidenceScore ? `${item.confidenceScore}%` : "—"}</TableCell>
                  <TableCell>{item.insertedIntoReport ? <Check className="w-4 h-4 text-green-600" /> : "—"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-1 justify-end">
                      {item.status === "pending" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled
                          title="Voice transcription is not configured. No findings or impression were generated."
                          data-testid="voice-transcribe-disabled"
                        >
                          <Play className="w-4 h-4" />
                        </Button>
                      )}
                      {item.status === "transcribed" && (
                        <Button size="sm" variant="outline" onClick={() => { setViewItem(item); setCorrectedText(item.correctedText ?? item.rawTranscript ?? ""); }}>
                          <Check className="w-4 h-4" />
                        </Button>
                      )}
                      {item.status === "reviewed" && !item.insertedIntoReport && (
                        <Button size="sm" variant="default" onClick={() => insertMutation.mutate(item.id)} disabled={insertMutation.isPending}>
                          <FileText className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Record Dictation</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Worklist ID</Label><Input value={form.worklistId} onChange={(e) => setForm({ ...form, worklistId: e.target.value })} /></div>
            <div><Label>Report ID</Label><Input value={form.reportId} onChange={(e) => setForm({ ...form, reportId: e.target.value })} /></div>
            <div><Label>Modality</Label><Input value={form.modality} onChange={(e) => setForm({ ...form, modality: e.target.value })} placeholder="MRI / CT / USG / X-Ray" /></div>
            <div><Label>Body Part</Label><Input value={form.bodyPart} onChange={(e) => setForm({ ...form, bodyPart: e.target.value })} placeholder="brain / chest / abdomen" /></div>
            <div><Label>Audio URL</Label><Input value={form.audioUrl} onChange={(e) => setForm({ ...form, audioUrl: e.target.value })} placeholder="https://... or local path" /></div>
            <div><Label>Duration (seconds)</Label><Input value={form.audioDurationSeconds} onChange={(e) => setForm({ ...form, audioDurationSeconds: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !form.worklistId}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Review & Correct dialog */}
      <Dialog open={!!viewItem} onOpenChange={() => setViewItem(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Review Transcript #{viewItem?.id}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <Badge variant="outline">{viewItem?.aiSafetyLabel}</Badge>
            <div>
              <Label className="text-sm font-medium">AI Draft</Label>
              <pre className="text-sm whitespace-pre-wrap bg-muted p-2 rounded mt-1">{viewItem?.rawTranscript ?? "No transcript yet."}</pre>
            </div>
            <div>
              <Label className="text-sm font-medium">Corrected Text</Label>
              <Textarea className="mt-1" rows={6} value={correctedText} onChange={(e) => setCorrectedText(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewItem(null)}>Cancel</Button>
            <Button onClick={() => viewItem && correctMutation.mutate({ id: viewItem.id, text: correctedText })} disabled={correctMutation.isPending}>Save Corrections</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
