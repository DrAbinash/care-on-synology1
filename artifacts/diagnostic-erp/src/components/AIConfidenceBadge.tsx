/**
 * Phase 10C: AI Confidence Badge
 * Wraps any AI suggestion output with confidence %, evidence bullets,
 * uncertainty reasons, and alternative diagnoses.
 * AI Draft – Requires Radiologist Review
 */
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronUp, Sparkles, AlertTriangle, HelpCircle } from "lucide-react";

interface AIConfidenceMetadata {
  confidence: number; // 0-100
  evidenceBullets?: string[];
  uncertaintyReasons?: string[];
  alternatives?: string[];
  provider?: string;
  model?: string;
}

interface Props {
  metadata: AIConfidenceMetadata;
  children: React.ReactNode;
  compact?: boolean;
}

function confidenceColor(pct: number): string {
  if (pct >= 80) return "bg-green-100 text-green-700 border-green-200";
  if (pct >= 60) return "bg-yellow-100 text-yellow-700 border-yellow-200";
  return "bg-red-100 text-red-700 border-red-200";
}

function confidenceLabel(pct: number): string {
  if (pct >= 85) return "High Confidence";
  if (pct >= 70) return "Moderate Confidence";
  if (pct >= 50) return "Low Confidence";
  return "Very Low Confidence";
}

export default function AIConfidenceBadge({ metadata, children, compact = false }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { confidence, evidenceBullets = [], uncertaintyReasons = [], alternatives = [], provider, model } = metadata;
  const hasDetails = evidenceBullets.length > 0 || uncertaintyReasons.length > 0 || alternatives.length > 0;

  return (
    <div className="space-y-2">
      {/* AI safety banner */}
      <div className="flex items-center gap-1.5 text-[10px] text-yellow-700 bg-yellow-50 border border-yellow-200 rounded px-2 py-1">
        <Sparkles size={10} />
        <span className="font-medium">AI Draft — Requires Radiologist Review</span>
        {provider && <span className="text-yellow-600 ml-auto">{provider}{model ? ` · ${model}` : ""}</span>}
      </div>

      {/* Confidence badge row */}
      <div className="flex items-center gap-2">
        <Badge className={`text-[10px] px-2 border ${confidenceColor(confidence)}`}>
          {confidence}% · {confidenceLabel(confidence)}
        </Badge>
        {/* Confidence bar */}
        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${confidence >= 80 ? "bg-green-500" : confidence >= 60 ? "bg-yellow-500" : "bg-red-400"}`}
            style={{ width: `${confidence}%` }}
          />
        </div>
        {hasDetails && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground transition"
          >
            <HelpCircle size={11} />
            {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
        )}
      </div>

      {/* Details panel */}
      {expanded && hasDetails && !compact && (
        <div className="border border-card-border rounded-lg p-2.5 space-y-2 text-xs bg-muted/10">
          {evidenceBullets.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">Why AI suggested this</div>
              <ul className="space-y-0.5">
                {evidenceBullets.map((b, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <span className="text-green-600 mt-0.5">✓</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {uncertaintyReasons.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold text-orange-600 uppercase mb-1 flex items-center gap-1">
                <AlertTriangle size={10} /> Why AI is uncertain
              </div>
              <ul className="space-y-0.5">
                {uncertaintyReasons.map((r, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-orange-700">
                    <span className="mt-0.5">•</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {alternatives.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">Alternative diagnoses</div>
              <ul className="space-y-0.5">
                {alternatives.map((a, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-muted-foreground">
                    <span className="mt-0.5">↳</span>
                    <span>{a}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Main content */}
      <div>{children}</div>
    </div>
  );
}

// Utility: parse a raw AI confidence statement from text
export function parseConfidenceFromText(text: string): number {
  const match = text.match(/(\d+)\s*%\s*(confidence|certain|sure)/i);
  if (match) return Math.min(100, Math.max(0, Number(match[1])));
  if (/high confidence|highly confident|strongly suggest/i.test(text)) return 85;
  if (/moderate confidence|likely|probable/i.test(text)) return 70;
  if (/low confidence|possible|uncertain/i.test(text)) return 50;
  return 65;
}
