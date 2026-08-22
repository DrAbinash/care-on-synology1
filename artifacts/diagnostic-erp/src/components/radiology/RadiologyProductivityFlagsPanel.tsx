import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { Brain, ScanLine } from "lucide-react";
import { isFeatureEnabled, setFeatureFlag } from "@/lib/staffSession";

type ToggleDef = { id: string; label: string; desc: string };

/** Browser-local flags that are actually read via isFeatureEnabled in the ERP UI. */
const MEMORY_TOGGLES: ToggleDef[] = [
  { id: "radiologyMemoryEngine", label: "Radiology Memory Engine", desc: "Persistent memory that learns reporting preferences over time (styles, phrases, measurements)." },
  { id: "radiologyStyleLearning", label: "Style Learning", desc: "Learn preferred wording, impression style, formatting, and terminology per radiologist." },
  { id: "radiologyImpressionMemory", label: "Impression Memory", desc: "Store approved impressions and suggest them when similar findings appear." },
  { id: "radiologyMeasurementMemory", label: "Measurement Memory", desc: "Track measurement history across studies with trend graphs." },
  { id: "radiologyDecisionMemory", label: "Decision Memory", desc: "Track accepted, rejected, and edited AI suggestions to learn preferences." },
  { id: "radiologyFeedbackLoop", label: "AI Feedback Loop", desc: "Useful / Not Useful / Partially Useful buttons for AI suggestions." },
  { id: "radiologyAnalyticsMemory", label: "Personal Analytics", desc: "Per-radiologist template, phrase, and time-saved analytics in the memory panel." },
  { id: "radiologyMacroEngine", label: "Personal Macro Engine", desc: "Shortcuts like /normalbrain, /l4l5disc, /fazekas2 for instant insertion." },
];

const IMAGE_INTEL_TOGGLES: ToggleDef[] = [
  { id: "dicomImageIntelligence", label: "DICOM Image Intelligence (master)", desc: "Master switch for the image-intelligence platform; sub-features still need their own toggles." },
  { id: "lesionTracking", label: "Lesion Tracker", desc: "Longitudinal lesion monitoring across studies." },
  { id: "changeDetection", label: "Smart Change Detector", desc: "Interval change detection: new lesions, growth, regression, etc." },
  { id: "measurementAssistant", label: "Structured Measurement Assistant", desc: "Guided measurement entry with normal ranges." },
  { id: "spineIntelligence", label: "Spine Intelligence", desc: "Automated disc grading and canal stenosis classification (partial rollout)." },
  { id: "brainIntelligence", label: "Brain Intelligence", desc: "Fazekas scoring, atrophy grading, and white-matter classification (partial rollout)." },
  { id: "tumorFollowup", label: "Tumor Follow-up Engine", desc: "RECIST-guided measurement tracking and response assessment (partial rollout)." },
  { id: "imageAnnotations", label: "Image Annotation Layer", desc: "Text annotations on DICOM images linked to report text." },
  { id: "multiAIImageReview", label: "Multi-AI Image Review", desc: "Parallel AI review across providers for secondary opinion." },
  { id: "teachingGenerator", label: "Teaching Case Generator", desc: "Auto-generate teaching summaries and exam questions from cases." },
  { id: "researchDatabase", label: "Research Database", desc: "Case tagging, cohort building, and anonymized research export." },
  { id: "caseOfMonth", label: "Case of the Month", desc: "Editorial workflow for monthly teaching cases." },
  { id: "confidenceVisualization", label: "AI Confidence Visualization", desc: "Colour-coded confidence bars on AI suggestions." },
];

function BrowserFlagToggle({ def }: { def: ToggleDef }) {
  const [on, setOn] = useState(() => isFeatureEnabled(def.id));
  return (
    <label className="flex items-center justify-between px-3 py-2 rounded-lg border border-card-border bg-muted/20 cursor-pointer">
      <div className="pr-4">
        <div className="text-sm font-medium">{def.label}</div>
        <div className="text-[11px] text-muted-foreground">{def.desc}</div>
      </div>
      <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 ${on ? "bg-primary" : "bg-muted-foreground/40"}`}>
        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${on ? "translate-x-5" : "translate-x-1"}`} />
      </span>
      <input
        type="checkbox"
        className="sr-only"
        checked={on}
        onChange={() => {
          const next = !on;
          setOn(next);
          setFeatureFlag(def.id, next);
        }}
      />
    </label>
  );
}

function ToggleSection({ title, icon, toggles }: { title: string; icon: ReactNode; toggles: ToggleDef[] }) {
  return (
    <div className="bg-card border border-card-border rounded-xl p-5 space-y-3">
      <h3 className="font-bold text-base flex items-center gap-2">{icon}{title}</h3>
      <div className="space-y-2">
        {toggles.map((t) => <BrowserFlagToggle key={t.id} def={t} />)}
      </div>
    </div>
  );
}

/** Wired browser-local radiology workstation flags (Settings → Radiology → Productivity). */
export default function RadiologyProductivityFlagsPanel() {
  return (
    <div className="max-w-4xl space-y-6">
      <div className="rounded-xl border bg-card border-card-border p-4 space-y-1">
        <h2 className="font-bold text-lg flex items-center gap-2"><ScanLine size={18} /> Device productivity flags</h2>
        <p className="text-sm text-muted-foreground">
          Only flags that the reporting UI actually reads are shown here. They are stored in this browser only —
          not clinic-wide server Feature Flags or PACS settings. For roadmap / server switches use{" "}
          <Link href="/settings?tab=feature-flags" className="text-primary underline">Settings → Feature Flags (Server)</Link>.
        </p>
      </div>

      <ToggleSection title="Radiology memory" icon={<Brain size={16} />} toggles={MEMORY_TOGGLES} />
      <ToggleSection title="DICOM image intelligence" icon={<Brain size={16} />} toggles={IMAGE_INTEL_TOGGLES} />
    </div>
  );
}
