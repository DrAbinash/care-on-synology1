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
import { readStaffSession, FULL_ACCESS_ROLES } from "@/lib/staffSession";
import {
  Settings2, Cpu, Wifi, Eye, FlaskConical, Info, ShieldAlert,
  ArrowLeft, Waves, Sliders, Brain, CheckCircle2,
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
};

interface SampleTestResult {
  metadata: Record<string, unknown>;
  srMeasurements: unknown[];
  srCount: number;
  message: string;
}

export default function UsgAdminSettings() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const session = readStaffSession();
  const isAdmin = FULL_ACCESS_ROLES.has(session?.user.role ?? "");

  const { data: settings, isLoading } = useQuery<UsgSettings>({
    queryKey: ["usg-admin-settings"],
    queryFn: () => fetchApi("/api/usg-extraction/settings"),
    staleTime: 60_000,
  });

  const [form, setForm] = useState<UsgSettings>(DEFAULTS);

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
        title="USG Extraction Settings"
        subtitle="Configure the AI extraction pipeline, confidence thresholds, and machine connectivity"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate("/usg")}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Dashboard
            </Button>
            <Button
              size="sm"
              onClick={() => saveMutation.mutate(form)}
              disabled={saveMutation.isPending || isLoading}
            >
              {saveMutation.isPending ? "Saving…" : "Save Settings"}
            </Button>
          </div>
        }
      />

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

      {/* ── AI Pipeline ─────────────────────────────────────────────── */}
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

      {/* ── Confidence Thresholds ────────────────────────────────────── */}
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

      {/* ── Machine Connectivity ─────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wifi className="h-4 w-4 text-primary" /> GE Machine Connectivity
          </CardTitle>
          <CardDescription>DICOM AE title and network address of the primary GE USG machine.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label>AE Title</Label>
              <Input
                value={form.geAeTitle}
                onChange={(e) => upd("geAeTitle", e.target.value)}
                placeholder="GE_USG"
              />
            </div>
            <div className="space-y-1.5">
              <Label>IP Address</Label>
              <Input
                value={form.geIp}
                onChange={(e) => upd("geIp", e.target.value)}
                placeholder="192.168.1.100"
              />
            </div>
            <div className="space-y-1.5">
              <Label>DICOM Port</Label>
              <Input
                value={form.gePort}
                onChange={(e) => upd("gePort", e.target.value)}
                placeholder="11112"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── DICOM Parser Test ────────────────────────────────────────── */}
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
  );
}
