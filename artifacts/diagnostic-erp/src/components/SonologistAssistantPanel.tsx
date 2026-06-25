import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Sparkles,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Copy,
  Mic,
  Settings,
  BookOpen,
  Eye,
  Activity,
  Maximize2,
  FileText,
  UserCheck,
  RefreshCw,
} from "lucide-react";

interface ChecklistItem {
  name: string;
  status: "completed" | "missing";
}

interface QualityAlert {
  type: string;
  severity: "PASS" | "WARNING" | "CRITICAL";
  message: string;
}

interface AssistantPanelProps {
  studyId: number;
  activeText: string;
  onUpdateText: (newText: string) => void;
  staffId?: number;
}

export default function SonologistAssistantPanel({
  studyId,
  activeText,
  onUpdateText,
  staffId = 1,
}: AssistantPanelProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState("clinical");
  const [voiceText, setVoiceText] = useState("");

  // Fetch checklist
  const { data: checklistData, refetch: refetchChecklist } = useQuery<{ checklist: ChecklistItem[] }>({
    queryKey: ["assistant-checklist", studyId],
    queryFn: () => fetchApi(`/api/radiology-copilot/sonologist-assistant/checklist/${studyId}`),
    enabled: !!studyId,
  });

  // Fetch quality review alerts
  const { data: qualityData, refetch: refetchQuality } = useQuery<{ alerts: QualityAlert[] }>({
    queryKey: ["assistant-quality", studyId],
    queryFn: () => fetchApi(`/api/radiology-copilot/sonologist-assistant/quality-review/${studyId}`),
    enabled: !!studyId,
  });

  // Fetch learning settings
  const { data: learningData } = useQuery<{ learningEnabled: boolean }>({
    queryKey: ["learning-settings", staffId],
    queryFn: () => fetchApi(`/api/radiology-copilot/sonologist-assistant/learning-settings/${staffId}`),
  });

  // Toggle learning settings mutation
  const toggleLearningMutation = useMutation({
    mutationFn: (learningEnabled: boolean) =>
      fetchApi(`/api/radiology-copilot/sonologist-assistant/learning-settings`, {
        method: "POST",
        body: JSON.stringify({ staffId, learningEnabled }),
      }),
    onSuccess: () => {
      toast({ title: "Learning Settings Updated" });
      void qc.invalidateQueries({ queryKey: ["learning-settings", staffId] });
    },
  });

  // Draft generation mutation
  const draftMutation = useMutation({
    mutationFn: () =>
      fetchApi(`/api/radiology-copilot/sonologist-assistant/generate-drafts`, {
        method: "POST",
        body: JSON.stringify({ studyId }),
      }) as Promise<{ findings: string; impression: string; followUp: string; comparison: string }>,
    onSuccess: (res) => {
      toast({ title: "Clinical Drafts Generated", description: "Click copy to insert them into your report editor." });
    },
  });

  // Co-pilot action mutation
  const copilotMutation = useMutation({
    mutationFn: (action: string) =>
      fetchApi(`/api/radiology-copilot/sonologist-assistant/copilot-action`, {
        method: "POST",
        body: JSON.stringify({ action, text: activeText }),
      }) as Promise<{ result: string }>,
    onSuccess: (res) => {
      onUpdateText(res.result);
      toast({ title: "Text Optimized by AI" });
    },
  });

  // Voice Integration mutation
  const voiceMutation = useMutation({
    mutationFn: () =>
      fetchApi(`/api/radiology-copilot/sonologist-assistant/voice-integration`, {
        method: "POST",
        body: JSON.stringify({ text: voiceText }),
      }) as Promise<{ processed: string }>,
    onSuccess: (res) => {
      setVoiceText(res.processed);
      toast({ title: "Voice Dictation Standardized" });
    },
  });

  // Trigger learning mutation
  const learnMutation = useMutation({
    mutationFn: () =>
      fetchApi(`/api/radiology-copilot/sonologist-assistant/learn`, {
        method: "POST",
        body: JSON.stringify({ staffId, modality: "USG", bodyPart: "OB", draftContent: activeText }),
      }) as Promise<{ success: boolean; learnedCount?: number }>,
    onSuccess: (res) => {
      if (res.learnedCount && res.learnedCount > 0) {
        toast({ title: "AI Learned Phrases", description: `Learned ${res.learnedCount} new phrasing patterns from your finalized draft.` });
      } else {
        toast({ title: "Draft Analyzed", description: "No new unique phrases found." });
      }
    },
  });

  const getAlertIcon = (sev: string) => {
    if (sev === "PASS") return <CheckCircle className="text-emerald-500 h-4 w-4 mt-0.5 flex-shrink-0" />;
    if (sev === "WARNING") return <AlertTriangle className="text-amber-500 h-4 w-4 mt-0.5 flex-shrink-0" />;
    return <XCircle className="text-red-500 h-4 w-4 mt-0.5 flex-shrink-0" />;
  };

  const getAlertBg = (sev: string) => {
    if (sev === "PASS") return "border-emerald-200 bg-emerald-50/50 text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300";
    if (sev === "WARNING") return "border-amber-200 bg-amber-50/50 text-amber-800 dark:bg-amber-950/20 dark:text-amber-300";
    return "border-red-200 bg-red-50/50 text-red-800 dark:bg-red-950/20 dark:text-red-300";
  };

  return (
    <Card className="border-border/60 shadow-xl bg-gradient-to-br from-background via-background to-indigo-50/10 h-full flex flex-col">
      <CardHeader className="pb-3 border-b border-border/40">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-bold flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400">
            <Sparkles className="h-4 w-4 text-violet-500 animate-pulse" /> AI Sonologist Assistant
          </CardTitle>
          <Badge variant="outline" className="text-[10px] bg-indigo-50/50 dark:bg-indigo-950/30">Copilot Active</Badge>
        </div>
        <CardDescription className="text-xs">Clinical assistants, checklists, quality reviews, and terminology tools.</CardDescription>
      </CardHeader>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
        <TabsList className="grid w-full grid-cols-5 p-1 bg-muted/40 border-b rounded-none h-10">
          <TabsTrigger value="clinical" className="text-[10px] py-1.5 px-0">Clinical</TabsTrigger>
          <TabsTrigger value="quality" className="text-[10px] py-1.5 px-0">Quality</TabsTrigger>
          <TabsTrigger value="copilot" className="text-[10px] py-1.5 px-0">Co-pilot</TabsTrigger>
          <TabsTrigger value="voice" className="text-[10px] py-1.5 px-0">Voice</TabsTrigger>
          <TabsTrigger value="settings" className="text-[10px] py-1.5 px-0">Settings</TabsTrigger>
        </TabsList>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
          {/* CLINICAL ASSISTANT */}
          <TabsContent value="clinical" className="m-0 space-y-4">
            <Button className="w-full text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white" onClick={() => {
              draftMutation.mutate();
              refetchChecklist();
            }} disabled={draftMutation.isPending}>
              <RefreshCw className={`h-3 w-3 mr-1.5 ${draftMutation.isPending ? 'animate-spin' : ''}`} />
              Generate Clinical Suggestions
            </Button>

            {draftMutation.data && (
              <div className="space-y-4">
                <Card className="border-border/40 bg-card/60">
                  <CardHeader className="p-3"><CardTitle className="text-xs font-bold">Findings Draft</CardTitle></CardHeader>
                  <CardContent className="p-3 pt-0 space-y-2">
                    <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line bg-muted/20 p-2.5 rounded-lg border">{draftMutation.data.findings}</p>
                    <Button size="sm" variant="outline" className="w-full text-[10px] h-7" onClick={() => onUpdateText(draftMutation.data!.findings)}>
                      <Copy className="h-3 w-3 mr-1" /> Use in Findings
                    </Button>
                  </CardContent>
                </Card>

                <Card className="border-border/40 bg-card/60">
                  <CardHeader className="p-3"><CardTitle className="text-xs font-bold">Impression Draft</CardTitle></CardHeader>
                  <CardContent className="p-3 pt-0 space-y-2">
                    <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line bg-muted/20 p-2.5 rounded-lg border">{draftMutation.data.impression}</p>
                    <Button size="sm" variant="outline" className="w-full text-[10px] h-7" onClick={() => onUpdateText(draftMutation.data!.impression)}>
                      <Copy className="h-3 w-3 mr-1" /> Use in Impression
                    </Button>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Checklist items */}
            {checklistData && checklistData.checklist.length > 0 && (
              <Card className="border-border/40">
                <CardHeader className="p-3"><CardTitle className="text-xs font-bold">Missing Measurements Checklist</CardTitle></CardHeader>
                <CardContent className="p-3 pt-0 space-y-2">
                  {checklistData.checklist.map((item, i) => (
                    <div key={i} className="flex items-center justify-between text-xs py-1 border-b last:border-0 border-border/20">
                      <span className="font-medium">{item.name}</span>
                      <Badge variant={item.status === "completed" ? "default" : "destructive"} className="text-[9px] py-0 px-1.5">
                        {item.status}
                      </Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* AI QUALITY REVIEW */}
          <TabsContent value="quality" className="m-0 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-muted-foreground">Quality Check Results</span>
              <Button size="sm" variant="ghost" className="h-6 text-[10px] p-1 text-indigo-600" onClick={() => refetchQuality()}>
                Re-check
              </Button>
            </div>

            <div className="space-y-3">
              {qualityData?.alerts.map((al, idx) => (
                <div key={idx} className={`p-3 rounded-lg border text-xs flex gap-2.5 items-start ${getAlertBg(al.severity)}`}>
                  {getAlertIcon(al.severity)}
                  <div>
                    <div className="font-bold flex items-center gap-1.5 uppercase tracking-wide text-[10px]">
                      {al.severity} · {al.type}
                    </div>
                    <div className="mt-1 leading-relaxed">{al.message}</div>
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>

          {/* REPORT CO-PILOT */}
          <TabsContent value="copilot" className="m-0 space-y-4">
            <div className="text-xs font-semibold text-muted-foreground mb-1">Editor Helpers (Applies to active text)</div>
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" variant="outline" className="text-[10px]" onClick={() => copilotMutation.mutate("improve_grammar")}>
                Improve Grammar
              </Button>
              <Button size="sm" variant="outline" className="text-[10px]" onClick={() => copilotMutation.mutate("standardize_terminology")}>
                Standardize Terms
              </Button>
            </div>

            <div className="text-xs font-semibold text-muted-foreground mb-1 pt-2">Structured Summary Utilities</div>
            <div className="space-y-2">
              <Button size="sm" variant="outline" className="w-full text-xs" onClick={() => copilotMutation.mutate("refer_summary")}>
                Generate Referring Doctor Summary
              </Button>
              <Button size="sm" variant="outline" className="w-full text-xs" onClick={() => copilotMutation.mutate("patient_summary")}>
                Generate Patient-Friendly Summary
              </Button>
              <Button size="sm" variant="outline" className="w-full text-xs text-violet-700 bg-violet-50 hover:bg-violet-100 border-violet-200 dark:bg-violet-950/20 dark:text-violet-400" onClick={() => copilotMutation.mutate("differential_diagnoses")}>
                Suggest Differential Diagnoses
              </Button>
            </div>
          </TabsContent>

          {/* VOICE Dictation Helpers */}
          <TabsContent value="voice" className="m-0 space-y-4">
            <div className="space-y-2">
              <Label className="text-xs font-bold text-muted-foreground">Dictation Input Post-Processing</Label>
              <Textarea
                placeholder="Speech-to-text dictated block..."
                value={voiceText}
                onChange={(e) => setVoiceText(e.target.value)}
                rows={5}
                className="text-xs"
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="flex-1 text-xs" onClick={() => voiceMutation.mutate()} disabled={voiceMutation.isPending}>
                <Mic className="h-3 w-3 mr-1" /> Expand & Format
              </Button>
              {voiceText && (
                <Button size="sm" variant="outline" className="text-xs" onClick={() => {
                  onUpdateText(activeText + "\n" + voiceText);
                  setVoiceText("");
                  toast({ title: "Text added to report" });
                }}>
                  Append to Editor
                </Button>
              )}
            </div>
          </TabsContent>

          {/* LEARNING ENGINE CONFIG */}
          <TabsContent value="settings" className="m-0 space-y-4">
            <Card className="border-border/40">
              <CardHeader className="p-3"><CardTitle className="text-xs font-bold">Preferences & Learning Settings</CardTitle></CardHeader>
              <CardContent className="p-3 pt-0 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-xs font-bold">Enable Template Learning</Label>
                    <p className="text-[10px] text-muted-foreground">Automatically index phrasing preferences from finalized signed reports</p>
                  </div>
                  <Switch
                    checked={learningData ? learningData.learningEnabled : true}
                    onCheckedChange={(val) => toggleLearningMutation.mutate(val)}
                  />
                </div>

                <div className="pt-2 border-t border-border/20">
                  <Button size="sm" variant="outline" className="w-full text-xs" onClick={() => learnMutation.mutate()} disabled={learnMutation.isPending}>
                    <BookOpen className="h-3 w-3 mr-1.5" /> Analyze Current Phrasings Now
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </div>
      </Tabs>
    </Card>
  );
}
