// Phase 7A: Image Review Assistant
// Structured AI-powered image review with findings, differential, missed findings,
// measurements, follow-up, confidence, and evidence.

import { useState } from "react";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Image, Eye, AlertTriangle, Check, Ruler, List, Clock, ArrowRight,
  Loader2, ChevronDown, ChevronUp,
} from "lucide-react";

interface ImageReviewResult {
  possibleFindings: Array<{
    finding: string;
    confidence: number;
    evidence: string;
    location?: string;
  }>;
  differential: string[];
  missedFindings: string[];
  measurements: Array<{
    label: string;
    value: string;
    normal?: string;
    unit?: string;
  }>;
  followUp: string;
  overallConfidence: number;
  aiSafetyLabel: string;
}

export default function ImageReviewAssistant() {
  const { toast } = useToast();
  const [studyDesc, setStudyDesc] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [result, setResult] = useState<ImageReviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [showDifferential, setShowDifferential] = useState(false);
  const [showMissed, setShowMissed] = useState(false);
  const [showMeasurements, setShowMeasurements] = useState(false);

  const runReview = async () => {
    if (!studyDesc.trim()) { toast({ title: "Enter study description", variant: "destructive" }); return; }
    setLoading(true);
    try {
      // This calls the existing ai-reporting endpoint with the image_review_assistant task
      const data = await api.post<ImageReviewResult>("/api/ai-reporting/image-review", {
        studyDescription: studyDesc,
        images,
      });
      setResult(data);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Review failed", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const confidenceColor = (c: number) => {
    if (c >= 0.9) return "bg-green-100 text-green-700";
    if (c >= 0.7) return "bg-blue-100 text-blue-700";
    if (c >= 0.5) return "bg-amber-100 text-amber-700";
    return "bg-red-100 text-red-700";
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Image Review Assistant"
        subtitle="AI-powered structured image review with possible findings, differential, measurements, follow-up, and confidence scores."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Input */}
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Study Description</label>
            <Textarea
              value={studyDesc}
              onChange={(e) => setStudyDesc(e.target.value)}
              placeholder="Describe the study: modality, anatomy, contrast, reason for exam..."
              rows={4}
              className="text-sm"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Images (base64)</label>
            <Textarea
              value={images.join("\n")}
              onChange={(e) => setImages(e.target.value.split("\n").filter(Boolean))}
              placeholder="Paste base64 image data (one per line)..."
              rows={3}
              className="text-sm font-mono text-[10px]"
            />
          </div>
          <Button onClick={runReview} disabled={loading} className="w-full">
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Image className="h-4 w-4 mr-1" />}
            Run Image Review
          </Button>
        </div>

        {/* Results */}
        {result && (
          <div className="space-y-4">
            {/* Overall Confidence */}
            <div className="flex items-center justify-between border rounded-lg p-3 bg-card">
              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Overall Confidence</span>
              </div>
              <Badge className={confidenceColor(result.overallConfidence)}>
                {Math.round(result.overallConfidence * 100)}%
              </Badge>
            </div>

            {/* AI Safety Label */}
            <div className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded p-2 flex items-center gap-2">
              <AlertTriangle className="h-3 w-3" />
              {result.aiSafetyLabel}
            </div>

            {/* Possible Findings */}
            <div className="space-y-2">
              <div className="text-sm font-medium flex items-center gap-2">
                <List className="h-4 w-4" /> Possible Findings
              </div>
              {result.possibleFindings.map((f, i) => (
                <div key={i} className="border rounded-lg p-3 bg-card space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">{f.finding}</span>
                    <Badge className={confidenceColor(f.confidence)}>{Math.round(f.confidence * 100)}%</Badge>
                  </div>
                  {f.location && <div className="text-[11px] text-muted-foreground">Location: {f.location}</div>}
                  <div className="text-[11px] text-muted-foreground">Evidence: {f.evidence}</div>
                </div>
              ))}
            </div>

            {/* Differential Diagnosis */}
            <div className="space-y-2">
              <button
                className="w-full flex items-center justify-between text-sm font-medium py-2 border-b"
                onClick={() => setShowDifferential(!showDifferential)}
              >
                <span className="flex items-center gap-2"><ArrowRight className="h-4 w-4" /> Differential Diagnosis</span>
                {showDifferential ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
              {showDifferential && (
                <div className="space-y-1">
                  {result.differential.map((d, i) => (
                    <div key={i} className="text-sm text-muted-foreground pl-2">- {d}</div>
                  ))}
                </div>
              )}
            </div>

            {/* Missed Findings */}
            <div className="space-y-2">
              <button
                className="w-full flex items-center justify-between text-sm font-medium py-2 border-b"
                onClick={() => setShowMissed(!showMissed)}
              >
                <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> Missed Findings</span>
                {showMissed ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
              {showMissed && (
                <div className="space-y-1">
                  {result.missedFindings.length > 0 ? result.missedFindings.map((m, i) => (
                    <div key={i} className="text-sm text-amber-600 pl-2">- {m}</div>
                  )) : (
                    <div className="text-sm text-green-600 flex items-center gap-1 pl-2">
                      <Check className="h-3 w-3" /> No missed findings detected
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Measurements */}
            <div className="space-y-2">
              <button
                className="w-full flex items-center justify-between text-sm font-medium py-2 border-b"
                onClick={() => setShowMeasurements(!showMeasurements)}
              >
                <span className="flex items-center gap-2"><Ruler className="h-4 w-4" /> Measurements</span>
                {showMeasurements ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
              {showMeasurements && (
                <div className="grid grid-cols-2 gap-2">
                  {result.measurements.map((m, i) => (
                    <div key={i} className="border rounded p-2 text-sm">
                      <div className="font-medium">{m.label}</div>
                      <div className="text-muted-foreground">{m.value} {m.unit}</div>
                      {m.normal && <div className="text-[11px] text-green-600">Normal: {m.normal}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Follow-up */}
            <div className="border rounded-lg p-3 bg-card space-y-1">
              <div className="text-sm font-medium flex items-center gap-2">
                <Clock className="h-4 w-4" /> Follow-Up
              </div>
              <div className="text-sm text-muted-foreground">{result.followUp}</div>
            </div>
          </div>
        )}
      </div>

      {/* Disclaimer */}
      <div className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded p-2 flex items-center gap-2">
        <AlertTriangle className="h-3 w-3" />
        All AI outputs are editable drafts. The radiologist remains the final authority. Do not rely solely on AI for diagnosis.
      </div>
    </div>
  );
}
