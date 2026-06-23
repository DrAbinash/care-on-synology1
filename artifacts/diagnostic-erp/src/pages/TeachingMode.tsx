// Phase 8: Teaching Mode
// Educational explanations with WHY button, learning references, and differential.

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import {
  GraduationCap, Brain, Lightbulb, ArrowLeft, Copy, Check,
  BookOpen, HelpCircle, Stethoscope, Target, Sparkles,
} from "lucide-react";

interface TeachingModeOutput {
  why: string;
  differentialDiagnosis: string;
  learningPoints: string;
  examPearls: string;
  references: string;
  similarCases: string;
  teachingLevel: string;
}

export default function TeachingMode() {
  const { toast } = useToast();
  const [_, navigate] = useLocation();
  const [input, setInput] = useState("");
  const [output, setOutput] = useState<TeachingModeOutput | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("why");

  const aiMutation = useMutation({
    mutationFn: async (text: string) => {
      return api.post<{ result: TeachingModeOutput }>("/ai/teaching-mode", { text });
    },
    onSuccess: (data) => {
      setOutput(data.result);
      toast({ title: "Teaching mode generated", description: "AI Draft \u2014 Requires Radiologist Review" });
    },
    onError: () => {
      toast({ title: "Generation failed", description: "Please try again later.", variant: "destructive" });
    },
  });

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const tabs = [
    { id: "why", label: "Why", icon: HelpCircle },
    { id: "differential", label: "Differential", icon: Stethoscope },
    { id: "learning", label: "Learning Points", icon: Lightbulb },
    { id: "pearls", label: "Exam Pearls", icon: Target },
    { id: "references", label: "References", icon: BookOpen },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Teaching Mode"
        subtitle="Educational explanations for residents and trainees"
      />

      <div className="flex items-center gap-3">
        <Button variant="outline" onClick={() => navigate("/teaching-cases")}>
          <ArrowLeft size={16} className="mr-2" /> Teaching Files
        </Button>
      </div>

      {/* AI Safety */}
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex items-center gap-2 text-sm text-yellow-800">
        <Sparkles size={16} />
        <span className="font-medium">AI Draft \u2014 Requires Radiologist Review</span>
      </div>

      {/* Input */}
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <GraduationCap size={16} className="text-primary" />
          <h3 className="font-semibold">Enter Case Findings</h3>
        </div>
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Paste the findings or impression here..."
          rows={6}
          className="font-mono text-sm"
        />
        <div className="flex items-center gap-3">
          <Button
            onClick={() => aiMutation.mutate(input)}
            disabled={!input.trim() || aiMutation.isPending}
          >
            <GraduationCap size={16} className="mr-2" />
            {aiMutation.isPending ? "Generating..." : "Generate Teaching Mode"}
          </Button>
          <Button variant="outline" onClick={() => { setInput(""); setOutput(null); }}>
            Clear
          </Button>
        </div>
      </div>

      {/* Output */}
      {output && (
        <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-lg flex items-center gap-2">
              <Brain size={18} /> Teaching Mode
              <Badge variant="outline">{output.teachingLevel}</Badge>
            </h3>
          </div>

          {/* Tabs */}
          <div className="flex flex-wrap gap-2 border-b border-card-border pb-2">
            {tabs.map((t) => (
              <button
                key={t.id}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                  activeTab === t.id
                    ? "bg-primary text-white"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
                onClick={() => setActiveTab(t.id)}
              >
                <t.icon size={14} /> {t.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="space-y-3">
            {activeTab === "why" && (
              <div className="bg-muted/30 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium flex items-center gap-2"><HelpCircle size={14} /> Why This Diagnosis</h4>
                  <Button variant="ghost" size="sm" onClick={() => handleCopy(output.why, "why")}>
                    {copied === "why" ? <Check size={14} /> : <Copy size={14} />}
                  </Button>
                </div>
                <div className="text-sm whitespace-pre-wrap">{output.why}</div>
              </div>
            )}

            {activeTab === "differential" && (
              <div className="bg-muted/30 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium flex items-center gap-2"><Stethoscope size={14} /> Differential Diagnosis</h4>
                  <Button variant="ghost" size="sm" onClick={() => handleCopy(output.differentialDiagnosis, "diff")}>
                    {copied === "diff" ? <Check size={14} /> : <Copy size={14} />}
                  </Button>
                </div>
                <div className="text-sm whitespace-pre-wrap">{output.differentialDiagnosis}</div>
              </div>
            )}

            {activeTab === "learning" && (
              <div className="bg-muted/30 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium flex items-center gap-2"><Lightbulb size={14} /> Learning Points</h4>
                  <Button variant="ghost" size="sm" onClick={() => handleCopy(output.learningPoints, "learn")}>
                    {copied === "learn" ? <Check size={14} /> : <Copy size={14} />}
                  </Button>
                </div>
                <div className="text-sm whitespace-pre-wrap">{output.learningPoints}</div>
              </div>
            )}

            {activeTab === "pearls" && (
              <div className="bg-muted/30 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium flex items-center gap-2"><Target size={14} /> Exam Pearls</h4>
                  <Button variant="ghost" size="sm" onClick={() => handleCopy(output.examPearls, "pearl")}>
                    {copied === "pearl" ? <Check size={14} /> : <Copy size={14} />}
                  </Button>
                </div>
                <div className="text-sm whitespace-pre-wrap">{output.examPearls}</div>
              </div>
            )}

            {activeTab === "references" && (
              <div className="bg-muted/30 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium flex items-center gap-2"><BookOpen size={14} /> References</h4>
                  <Button variant="ghost" size="sm" onClick={() => handleCopy(output.references, "ref")}>
                    {copied === "ref" ? <Check size={14} /> : <Copy size={14} />}
                  </Button>
                </div>
                <div className="text-sm whitespace-pre-wrap">{output.references}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
