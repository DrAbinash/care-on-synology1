// Phase 7A: Missed Finding Detector
// Frontend knowledge-base for detecting potentially missed critical findings.
// All AI suggestions are purely advisory — radiologist remains final authority.

import { useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  detectMissedFindings,
  getAllModalities,
  getFindingsForModality,
  type MissedFindingCheck,
} from "@/lib/missedFindingDetector";
import {
  AlertTriangle, Search, Check, Info, Loader2,
} from "lucide-react";

export default function MissedFindingDetector() {
  const { toast } = useToast();
  const [modality, setModality] = useState("CT Brain");
  const [studyDesc, setStudyDesc] = useState("");
  const [reportBody, setReportBody] = useState("");
  const [impression, setImpression] = useState("");
  const [findings, setFindings] = useState<MissedFindingCheck[]>([]);
  const [loading, setLoading] = useState(false);

  const modalities = getAllModalities();

  const runDetector = () => {
    setLoading(true);
    setTimeout(() => {
      const detected = detectMissedFindings(modality, studyDesc, reportBody, impression);
      setFindings(detected);
      setLoading(false);
      if (detected.length === 0) {
        toast({ title: "No missed critical findings detected" });
      }
    }, 400);
  };

  const severityColor = (s: string) => {
    if (s === "critical") return "bg-red-100 text-red-700 border-red-200";
    if (s === "urgent") return "bg-orange-100 text-orange-700 border-orange-200";
    return "bg-yellow-100 text-yellow-700 border-yellow-200";
  };

  const allFindings = getFindingsForModality(modality);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Missed Finding Detector"
        subtitle="Knowledge-base powered check for potentially missed critical findings. All suggestions are advisory — radiologist remains final authority."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left: Input */}
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Modality</label>
            <select
              value={modality}
              onChange={(e) => { setModality(e.target.value); setFindings([]); }}
              className="w-full h-9 rounded-md border bg-background px-3 text-sm"
            >
              {modalities.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Study Description</label>
            <Textarea
              value={studyDesc}
              onChange={(e) => setStudyDesc(e.target.value)}
              placeholder="e.g., CT Brain Plain with contrast"
              rows={2}
              className="text-sm"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Report Body (Findings)</label>
            <Textarea
              value={reportBody}
              onChange={(e) => setReportBody(e.target.value)}
              placeholder="Paste the findings section here..."
              rows={6}
              className="text-sm"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Impression</label>
            <Textarea
              value={impression}
              onChange={(e) => setImpression(e.target.value)}
              placeholder="Paste the impression section here..."
              rows={3}
              className="text-sm"
            />
          </div>

          <Button onClick={runDetector} disabled={loading} className="w-full">
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Search className="h-4 w-4 mr-1" />}
            Run Missed Finding Check
          </Button>
        </div>

        {/* Right: Results + Knowledge Base */}
        <div className="space-y-4">
          {/* Detected findings */}
          {findings.length > 0 && (
            <div className="space-y-3">
              <div className="text-sm font-medium flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                Potentially Missed Findings ({findings.length})
              </div>
              {findings.map((f, i) => (
                <div key={i} className={`border rounded-lg p-3 space-y-2 ${severityColor(f.severity).replace(/bg-.*\s/, "bg-white ")}`}>
                  <div className="flex items-center gap-2">
                    <Badge className={severityColor(f.severity)}>{f.severity.toUpperCase()}</Badge>
                    <span className="font-semibold text-sm">{f.finding}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{f.description}</p>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <Info className="h-3 w-3" />
                    {f.why}
                  </div>
                  <div className="bg-muted/30 rounded p-2 text-[11px] text-muted-foreground">
                    <strong>Suggestion:</strong> {f.suggestion}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Confidence: {Math.round(f.confidence * 100)}%
                  </div>
                </div>
              ))}
            </div>
          )}

          {findings.length === 0 && reportBody && !loading && (
            <div className="text-sm text-green-600 bg-green-50 border border-green-200 rounded p-3 flex items-center gap-2">
              <Check className="h-4 w-4" />
              No missed critical findings detected for this modality.
            </div>
          )}

          {/* Knowledge Base Preview */}
          <div className="space-y-3">
            <div className="text-sm font-medium">Knowledge Base for {modality}</div>
            <div className="space-y-2">
              {allFindings.map((f, i) => (
                <div key={i} className="border rounded p-2 text-[11px] space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge className={severityColor(f.severity)}>{f.severity}</Badge>
                    <span className="font-medium">{f.finding}</span>
                  </div>
                  <p className="text-muted-foreground">{f.description}</p>
                  <p className="text-muted-foreground">{f.why}</p>
                  <p className="text-muted-foreground">{f.suggestion}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* AI Disclaimer */}
      <div className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded p-2 flex items-center gap-2">
        <AlertTriangle className="h-3 w-3" />
        This is a knowledge-base powered suggestion tool. The radiologist remains the final authority. All AI outputs are editable and require review.
      </div>
    </div>
  );
}
