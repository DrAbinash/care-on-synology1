import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { fetchApi } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { readStaffSession, FULL_ACCESS_ROLES, normalizeRole } from "@/lib/staffSession";
import {
  Settings2, Cpu, Wifi, Eye, FlaskConical, Info, ShieldAlert,
  ArrowLeft, Waves, Sliders, Brain, CheckCircle2, ListChecks,
  Activity, Play, HelpCircle, AlertTriangle, ShieldCheck, HelpCircle as HelpIcon,
  RefreshCw,
} from "lucide-react";

interface UsgSettings {
  ocrEnabled: boolean;
  aiNormalizeEnabled: boolean;
  srPriorityMode: boolean;
  autoRejectLowConfidence: boolean;
  humanReviewRequired: boolean;
  autoFinalize: boolean;
  confidenceThreshold: number;      // 0.0–1.0
  lowConfidenceCutoff: number;      // 0.0–1.0
  maxFramesToOcr: number;
  geAeTitle: string;
  geIp: string;
  gePort: string;
  pipelineEnabled: boolean;
}

const DEFAULTS: UsgSettings = {
  ocrEnabled: true,
  aiNormalizeEnabled: true,
  srPriorityMode: true,
  autoRejectLowConfidence: true,
  humanReviewRequired: true,
  autoFinalize: false,
  confidenceThreshold: 0.80,
  lowConfidenceCutoff: 0.60,
  maxFramesToOcr: 20,
  geAeTitle: "GE_USG",
  geIp: "",
  gePort: "11112",
  pipelineEnabled: true,
};

interface SampleTestResult {
  metadata: Record<string, unknown>;
  srMeasurements: unknown[];
  srCount: number;
  gePrivateMeasurements: Record<string, string>;
  dopplerMeasurements: unknown[];
  message: string;
}

interface PushMonitorItem {
  id: number;
  patientName: string;
  patientId: string;
  studyDate: string;
  studyDescription: string;
  sourceAe: string;
  studyInstanceUID: string;
  receivedTime: string;
  extractionStatus: string;
  extractionSource: string;
}

/**
 * UsgExtractionPanel — the USG extraction pipeline configuration surface
 * (GE Voluson push monitor/diagnostics + AI extraction settings), extracted
 * so it can live BOTH as a tab inside the canonical Radiology Settings
 * Center (its primary home — same named-export convention as ModalityPanel /
 * RadiologyStylePanel) AND behind the preserved standalone routes
 * (/radiology/usg-admin-settings, /usg/settings) via the thin page wrapper
 * below. This was the only UI for the live Voluson/extraction pipeline
 * settings and was nav-hidden after the PR B sidebar consolidation — folding
 * it into the Settings Center restores admin discoverability without
 * creating a second settings page.
 *
 * Callers are responsible for admin gating (both the page wrapper and the
 * Settings Center check FULL_ACCESS_ROLES before rendering).
 */
export function UsgExtractionPanel() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [activeTab, setActiveTab] = useState<"monitor" | "settings">("monitor");
  const [showAutoPull, setShowAutoPull] = useState(false);

  // Queries
  const { data: settings, isLoading } = useQuery<UsgSettings>({
    queryKey: ["usg-admin-settings"],
    queryFn: () => fetchApi("/api/usg-extraction/settings"),
    staleTime: 60_000,
  });

  const [form, setForm] = useState<UsgSettings>(DEFAULTS);

  const { data: stats, refetch: refetchStats } = useQuery<{
    lastPushReceived: string | null;
    lastUsStudyReceived: string | null;
  }>({
    queryKey: ["usg-extraction-stats"],
    queryFn: () => fetchApi("/api/usg-extraction/stats"),
  });

  const { data: monitorItems, refetch: refetchMonitor, isFetching: isMonitorFetching } = useQuery<PushMonitorItem[]>({
    queryKey: ["usg-push-monitor"],
    queryFn: () => fetchApi("/api/usg-extraction/push-monitor"),
    refetchInterval: form.pipelineEnabled === false ? false : 5000,
  });

  useEffect(() => {
    if (settings) setForm(settings);
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: (body: UsgSettings) =>
      fetchApi("/api/usg-extraction/settings", {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast({ title: "Settings saved" });
      void qc.invalidateQueries({ queryKey: ["usg-admin-settings"] });
    },
    onError: () => toast({ title: "Failed to save settings", variant: "destructive" }),
  });

  const [sampleJson, setSampleJson] = useState("");
  const [sampleResult, setSampleResult] = useState<SampleTestResult | null>(null);
  const [testLoading, setTestLoading] = useState(false);

  const runSampleTest = async () => {
    setTestLoading(true);
    setSampleResult(null);
    try {
      const r = await fetchApi("/api/usg-extraction/sample-test", {
        method: "POST",
        body: JSON.stringify({ dicomMetadataJson: sampleJson }),
      });
      setSampleResult(r as SampleTestResult);
    } catch {
      toast({ title: "Sample test failed", variant: "destructive" });
    } finally {
      setTestLoading(false);
    }
  };

  const upd = <K extends keyof UsgSettings>(k: K, v: UsgSettings[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const toggle = (k: keyof UsgSettings) =>
    setForm((f) => ({ ...f, [k]: !f[k] }));

  return (
    <div className="space-y-6">
      {/* Sub-tabs (monitor / settings) with a quick-save on the right */}
      <div className="flex border-b border-border gap-2 items-center">
        <Button
          variant={activeTab === "monitor" ? "secondary" : "ghost"}
          className={`rounded-b-none px-4 py-2 border-b-2 ${activeTab === "monitor" ? "border-primary font-semibold" : "border-transparent"}`}
          onClick={() => setActiveTab("monitor")}
        >
          <Activity className="h-4 w-4 mr-2 text-primary" /> USG Push Monitor & Diagnostics
        </Button>
        <Button
          variant={activeTab === "settings" ? "secondary" : "ghost"}
          className={`rounded-b-none px-4 py-2 border-b-2 ${activeTab === "settings" ? "border-primary font-semibold" : "border-transparent"}`}
          onClick={() => setActiveTab("settings")}
        >
          <Settings2 className="h-4 w-4 mr-2 text-primary" /> Extraction Settings
        </Button>
        {activeTab === "settings" && (
          <Button
            size="sm"
            className="ml-auto mb-1"
            onClick={() => saveMutation.mutate(form)}
            disabled={saveMutation.isPending || isLoading}
          >
            {saveMutation.isPending ? "Saving…" : "Save Settings"}
          </Button>
        )}
      </div>

      {activeTab === "monitor" && (
        <div className="space-y-6">
          {/* USG Push Configuration Details */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Wifi className="h-4 w-4 text-primary" /> USG Push Destination Details
                </CardTitle>
                <CardDescription>Target receiver configurations for the physical GE Voluson machine.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div className="rounded-lg bg-muted/40 p-3">
                    <span className="text-xs text-muted-foreground block">PACS AE Title</span>
                    <strong className="text-primary font-semibold">ORTHANC2</strong>
                  </div>
                  <div className="rounded-lg bg-muted/40 p-3">
                    <span className="text-xs text-muted-foreground block">PACS IP Address</span>
                    <strong className="text-primary font-semibold">172.16.1.139</strong>
                  </div>
                  <div className="rounded-lg bg-muted/40 p-3">
                    <span className="text-xs text-muted-foreground block">PACS Port</span>
                    <strong className="text-primary font-semibold">5680</strong>
                  </div>
                  <div className="rounded-lg bg-muted/40 p-3">
                    <span className="text-xs text-muted-foreground block">Destination Name</span>
                    <strong className="text-primary font-semibold">CARE_PACS</strong>
                  </div>
                </div>

                <Separator className="my-4" />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div className="flex items-center justify-between p-2 rounded bg-emerald-50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-300">
                    <span>Last PACS Push Received:</span>
                    <strong>
                      {stats?.lastPushReceived ? new Date(stats.lastPushReceived).toLocaleString() : "Never"}
                    </strong>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded bg-emerald-50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-300">
                    <span>Last US/USG Study Intake:</span>
                    <strong>
                      {stats?.lastUsStudyReceived ? new Date(stats.lastUsStudyReceived).toLocaleString() : "Never"}
                    </strong>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <ListChecks className="h-4 w-4 text-primary" /> Push Verification Checklist
                </CardTitle>
                <CardDescription>Perform these checks to debug GE to PACS connection issues.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <span>GE Machine can ping PACS IP</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <span>PACS port (5680) open on firewall</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <span>AE Title accepted (`ORTHANC2`)</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <span>DICOM association accepted</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <HelpIcon className="h-4 w-4 text-primary/60" />
                  <span>Study received in PACS (logs)</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <HelpIcon className="h-4 w-4 text-primary/60" />
                  <span>Study intake complete (ERP)</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Test instructions & Push Monitor */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="md:col-span-2">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Activity className="h-4 w-4 text-primary" /> Live USG Push Monitor
                  </CardTitle>
                  <CardDescription>Real-time log of incoming US/USG modality studies processed by the ERP.</CardDescription>
                </div>
                <Button variant="ghost" size="sm" onClick={() => { void refetchMonitor(); void refetchStats(); }}>
                  <RefreshCw className={`h-4 w-4 ${isMonitorFetching ? "animate-spin" : ""}`} />
                </Button>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto border border-border rounded-lg">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-muted text-muted-foreground uppercase font-semibold">
                      <tr>
                        <th className="p-3">Patient Name</th>
                        <th className="p-3">ID / Source</th>
                        <th className="p-3">Description</th>
                        <th className="p-3">Received Time</th>
                        <th className="p-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {Array.isArray(monitorItems) && monitorItems.length > 0 ? (
                        monitorItems.map((item) => (
                          <tr key={item.id} className="hover:bg-muted/30">
                            <td className="p-3 font-medium text-primary">{item.patientName}</td>
                            <td className="p-3 text-muted-foreground">
                              <div>{item.patientId || "N/A"}</div>
                              <Badge variant="outline" className="text-[9px] px-1 py-0 mt-0.5">
                                {item.sourceAe || "Unknown AE"}
                              </Badge>
                            </td>
                            <td className="p-3">{item.studyDescription || "Ultrasound Study"}</td>
                            <td className="p-3 text-muted-foreground">
                              {new Date(item.receivedTime).toLocaleString()}
                            </td>
                            <td className="p-3">
                              <Badge
                                variant="outline"
                                className={
                                  item.extractionStatus === "approved"
                                    ? "text-[10px] bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                                    : item.extractionStatus === "pending_review"
                                      ? "text-[10px] bg-amber-500/10 text-amber-500 border-amber-500/20"
                                      : "text-[10px] bg-muted text-muted-foreground"
                                }
                              >
                                {item.extractionStatus}
                              </Badge>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={5} className="p-4 text-center text-muted-foreground">
                            No ultrasound studies received yet. Use the instructions panel on the right to send a test study.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-6">
              {/* Send Test Study instructions */}
              <Card className="border-primary/40 bg-primary/5 dark:bg-primary/5">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2 text-primary">
                    <Play className="h-4 w-4" /> Send Test Study Instructions
                  </CardTitle>
                  <CardDescription>Step-by-step guide to pair the Voluson E9 machine.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-xs leading-relaxed">
                  <p>1. On the <strong>GE Voluson E9</strong> console, open the <strong>Utility</strong> settings menu.</p>
                  <p>2. Select the <strong>Connectivity</strong> tab, then click on <strong>DICOM</strong> destinations.</p>
                  <p>3. Click <strong>Add</strong> to configure a new target PACS destination:</p>
                  <ul className="list-disc pl-4 space-y-1 bg-background/50 p-2 rounded border border-border/40">
                    <li><strong>Service Name:</strong> CARE_PACS</li>
                    <li><strong>AE Title:</strong> ORTHANC2</li>
                    <li><strong>IP Address:</strong> 172.16.1.139</li>
                    <li><strong>Port:</strong> 5680</li>
                  </ul>
                  <p>4. Export/Send one OB test study containing Structured Reports (SR) to `CARE_PACS`.</p>
                  <p>5. Confirm successful intake by checking the <strong>USG Push Monitor</strong> on the left.</p>
                </CardContent>
              </Card>

              {/* Troubleshooting panel */}
              <Card className="border-red-200/60 bg-red-50/20 dark:bg-red-950/10">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2 text-destructive">
                    <HelpCircle className="h-4 w-4" /> Push Troubleshooting Guide
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-xs">
                  <div>
                    <strong className="text-primary">1. Association Rejected?</strong>
                    <p className="text-muted-foreground mt-0.5">Ensure the Voluson E9 AE Title matches `geAeTitle` configured in settings tab exactly.</p>
                  </div>
                  <div>
                    <strong className="text-primary">2. Port Blocked?</strong>
                    <p className="text-muted-foreground mt-0.5">Verify that firewall allows incoming connection on port 5680 on the NAS / server hosting ORTHANC2.</p>
                  </div>
                  <div>
                    <strong className="text-primary">3. Received but no extraction?</strong>
                    <p className="text-muted-foreground mt-0.5">Verify that the Modality tag sent by the machine is exactly `US` or `USG`. Check logs to ensure SR parser is not throwing formatting errors.</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      )}

      {activeTab === "settings" && (
        <div className="space-y-6">
          <Card className="border-sky-200 bg-sky-50/50 dark:bg-sky-950/20 dark:border-sky-800">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Waves className="h-4 w-4 text-primary" /> USG ERP pipeline
              </CardTitle>
              <CardDescription>
                The ultrasound machine still sends images to Orthanc (do not stop C-STORE on the scanner).
                This switch only pauses ERP ingest, SR fetch, OCR, and worklist auto-extraction so billing stays fast.
                Recabling switches is optional and only helps if USG and MRI share a congested physical switch — it does not replace this pause.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between p-3 rounded-lg bg-background border">
                <div>
                  <Label className="font-semibold">Ingest USG studies into radiology</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Off = images stay in Orthanc only. Turn on when you start reporting USG in this module.
                  </p>
                </div>
                <Switch checked={form.pipelineEnabled !== false} onCheckedChange={() => toggle("pipelineEnabled")} />
              </div>
            </CardContent>
          </Card>

          {/* Safety notice */}
          <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-4">
            <Info className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-amber-800 dark:text-amber-300">
              <strong>Safety:</strong> Even with all automation enabled, measurements always land in{" "}
              <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded text-xs">pending_review</code> status
              unless <em>Human Review Required</em> is disabled and <em>Auto Finalize</em> is enabled.
              Leaving both defaults on is strongly recommended.
            </div>
          </div>

          {/* AI Pipeline */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Brain className="h-4 w-4 text-primary" /> AI Extraction Pipeline
              </CardTitle>
              <CardDescription>Control which AI components run during measurement extraction.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                {/* OCR Toggle */}
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/50">
                  <div>
                    <Label className="font-semibold">Gemini Vision OCR</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Extract burned-in text from WADO image frames using AI vision.
                    </p>
                  </div>
                  <Switch checked={form.ocrEnabled} onCheckedChange={() => toggle("ocrEnabled")} />
                </div>

                {/* AI Normalize Toggle */}
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/50">
                  <div>
                    <Label className="font-semibold">AI Text Normalization</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Use Gemini to normalize messy OCR text into structured measurements.
                    </p>
                  </div>
                  <Switch checked={form.aiNormalizeEnabled} onCheckedChange={() => toggle("aiNormalizeEnabled")} />
                </div>

                {/* SR Priority Mode */}
                <div className="flex items-center justify-between p-3 rounded-lg bg-green-50/50 dark:bg-green-950/20 border border-green-200/60">
                  <div>
                    <Label className="font-semibold text-green-800 dark:text-green-300">DICOM SR Priority</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Prefer GE structured measurements from DICOM SR. OCR fills only missing fields.
                    </p>
                  </div>
                  <Switch checked={form.srPriorityMode} onCheckedChange={() => toggle("srPriorityMode")} />
                </div>

                {/* Auto Reject */}
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/50">
                  <div>
                    <Label className="font-semibold">Auto-Reject Low Confidence</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Automatically mark extractions below the Low Confidence Cutoff as rejected.
                    </p>
                  </div>
                  <Switch checked={form.autoRejectLowConfidence} onCheckedChange={() => toggle("autoRejectLowConfidence")} />
                </div>

                {/* Human Review Required */}
                <div className="flex items-center justify-between p-3 rounded-lg bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/60">
                  <div>
                    <Label className="font-semibold text-amber-800 dark:text-amber-300">Human Review Required</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Radiologist/sonologist must approve each measurement set before report use.
                    </p>
                  </div>
                  <Switch checked={form.humanReviewRequired} onCheckedChange={() => toggle("humanReviewRequired")} />
                </div>

                {/* Auto Finalize */}
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/50">
                  <div>
                    <Label className="font-semibold">Auto Finalize</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Automatically finalize approved measurements into reports (only if Human Review is OFF).
                    </p>
                  </div>
                  <Switch
                    checked={form.autoFinalize}
                    onCheckedChange={() => toggle("autoFinalize")}
                    disabled={form.humanReviewRequired}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Confidence Thresholds */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Sliders className="h-4 w-4 text-primary" /> Confidence Thresholds
              </CardTitle>
              <CardDescription>
                Numeric thresholds (0.0–1.0) controlling quality gates.
                <span className="ml-2 text-green-600 font-semibold">Green ≥ threshold</span>
                {" · "}
                <span className="text-red-600 font-semibold">Red &lt; cutoff</span>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                <div className="space-y-2">
                  <Label className="font-semibold">
                    Confidence Threshold
                    <Badge className="ml-2 text-xs bg-emerald-100 text-emerald-800 border-emerald-200">
                      {(form.confidenceThreshold * 100).toFixed(0)}%
                    </Badge>
                  </Label>
                  <Input
                    type="number" step="0.05" min="0" max="1"
                    value={form.confidenceThreshold}
                    onChange={(e) => upd("confidenceThreshold", Math.max(0, Math.min(1, Number(e.target.value))))}
                  />
                  <p className="text-xs text-muted-foreground">Measurements above this are shown in green.</p>
                </div>

                <div className="space-y-2">
                  <Label className="font-semibold">
                    Low Confidence Cutoff
                    <Badge className="ml-2 text-xs bg-red-100 text-red-800 border-red-200">
                      {(form.lowConfidenceCutoff * 100).toFixed(0)}%
                    </Badge>
                  </Label>
                  <Input
                    type="number" step="0.05" min="0" max="1"
                    value={form.lowConfidenceCutoff}
                    onChange={(e) => upd("lowConfidenceCutoff", Math.max(0, Math.min(1, Number(e.target.value))))}
                  />
                  <p className="text-xs text-muted-foreground">Below this triggers auto-reject (if enabled).</p>
                </div>

                <div className="space-y-2">
                  <Label className="font-semibold">
                    Max Frames to OCR
                    <Badge className="ml-2 text-xs" variant="outline">{form.maxFramesToOcr}</Badge>
                  </Label>
                  <Input
                    type="number" step="1" min="1" max="100"
                    value={form.maxFramesToOcr}
                    onChange={(e) => upd("maxFramesToOcr", Math.max(1, Number(e.target.value)))}
                  />
                  <p className="text-xs text-muted-foreground">Max WADO frames sent to Gemini Vision per study.</p>
                </div>
              </div>

              {/* Visual confidence bar */}
              <div className="rounded-lg bg-muted/30 p-3 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">Confidence Band Preview</p>
                <div className="relative h-6 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700">
                  <div
                    className="absolute left-0 top-0 h-full bg-red-400 dark:bg-red-600 transition-all"
                    style={{ width: `${form.lowConfidenceCutoff * 100}%` }}
                  />
                  <div
                    className="absolute top-0 h-full bg-yellow-400 dark:bg-yellow-500 transition-all"
                    style={{
                      left: `${form.lowConfidenceCutoff * 100}%`,
                      width: `${(form.confidenceThreshold - form.lowConfidenceCutoff) * 100}%`,
                    }}
                  />
                  <div
                    className="absolute right-0 top-0 h-full bg-emerald-400 dark:bg-emerald-500 transition-all"
                    style={{ width: `${(1 - form.confidenceThreshold) * 100}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span className="text-red-600 font-semibold">
                    Red (&lt;{(form.lowConfidenceCutoff * 100).toFixed(0)}%)
                  </span>
                  <span className="text-yellow-600 font-semibold">Yellow (medium)</span>
                  <span className="text-emerald-600 font-semibold">
                    Green (≥{(form.confidenceThreshold * 100).toFixed(0)}%)
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Machine Connectivity */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Wifi className="h-4 w-4 text-primary" /> GE Machine Connectivity (Source Identification)
              </CardTitle>
              <CardDescription>Configure the source identification values of your GE Voluson machine.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label>Voluson AE Title</Label>
                  <Input
                    value={form.geAeTitle}
                    onChange={(e) => upd("geAeTitle", e.target.value)}
                    placeholder="Voluson"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Voluson IP Address</Label>
                  <Input
                    value={form.geIp}
                    onChange={(e) => upd("geIp", e.target.value)}
                    placeholder="172.16.1.46"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Voluson Port</Label>
                  <Input
                    value={form.gePort}
                    onChange={(e) => upd("gePort", e.target.value)}
                    placeholder="104"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Fallback Auto Pull Section (Collapsed) */}
          <Card className="border-dashed border-border">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" /> Auto Pull Settings (Fallback Only)
                </CardTitle>
                <CardDescription>
                  Configure active querying (C-FIND/C-MOVE). Use only as fallback if Voluson DICOM push fails.
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAutoPull(!showAutoPull)}
              >
                {showAutoPull ? "Hide Fallback Settings" : "Configure Fallback"}
              </Button>
            </CardHeader>
            {showAutoPull && (
              <CardContent className="space-y-4">
                <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-amber-700 dark:text-amber-400">
                  ⚠️ <strong>Notice:</strong> Auto-pull triggers background polling tasks that increase PACS processor loads. Only enable if physical GE Voluson push configuration is completely unsupported.
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>C-FIND Query Interval (minutes)</Label>
                    <Input type="number" defaultValue={15} disabled />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Active Query Retrieve Mode</Label>
                    <Input defaultValue="C-MOVE" disabled />
                  </div>
                </div>
              </CardContent>
            )}
          </Card>

          {/* DICOM Parser Test */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FlaskConical className="h-4 w-4 text-primary" /> DICOM Metadata Parser Test
              </CardTitle>
              <CardDescription>
                Paste DICOM JSON metadata to test the SR parser without running a full extraction.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>DICOM Metadata JSON</Label>
                <textarea
                  rows={8}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder={'{"00080060":{"Value":["US"],"vr":"CS"}, "0040A730":{...}}'}
                  value={sampleJson}
                  onChange={(e) => setSampleJson(e.target.value)}
                />
              </div>
              <Button
                variant="outline" size="sm"
                onClick={runSampleTest}
                disabled={testLoading || !sampleJson.trim()}
              >
                <Eye className="h-4 w-4 mr-2" />
                {testLoading ? "Testing…" : "Run Parser Test"}
              </Button>

              {sampleResult && (
                <div className="mt-3 rounded-lg bg-muted/40 p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    <span className="text-sm font-semibold">{sampleResult.message}</span>
                  </div>
                  <pre className="text-[10px] overflow-x-auto font-mono text-muted-foreground">
                    {JSON.stringify(sampleResult, null, 2)}
                  </pre>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Save button (bottom) */}
          <div className="flex justify-end gap-3 pb-4">
            <Button variant="outline" onClick={() => setForm(DEFAULTS)}>Reset to Defaults</Button>
            <Button onClick={() => saveMutation.mutate(form)} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "Saving…" : "Save All Settings"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Standalone page wrapper — kept so the preserved deep links
 * (/radiology/usg-admin-settings and /usg/settings) continue to work after
 * the panel's primary home moved to Radiology Settings Center → USG
 * Extraction. Same admin gate as before; renders the shared panel.
 */
export default function UsgAdminSettings() {
  const [, navigate] = useLocation();
  const session = readStaffSession();
  const isAdmin = FULL_ACCESS_ROLES.has(normalizeRole(session?.user.role ?? ""));

  if (!isAdmin) {
    return (
      <div className="p-6 flex flex-col items-center justify-center gap-4 min-h-[40vh]">
        <ShieldAlert className="h-10 w-10 text-destructive/60" />
        <p className="font-semibold text-lg">Admin access required</p>
        <p className="text-sm text-muted-foreground">Only admins and super-admins can change extraction settings.</p>
        <Button variant="outline" onClick={() => navigate("/usg")}>← USG Dashboard</Button>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHeader
        title="USG Auto-Acquisition & Settings"
        subtitle="Manage GE Voluson DICOM push logs, connection checklists, and AI extraction settings — also available under Radiology Settings Center → USG Extraction"
        actions={
          <Button variant="outline" size="sm" onClick={() => navigate("/usg")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> USG Dashboard
          </Button>
        }
      />
      <UsgExtractionPanel />
    </div>
  );
}
