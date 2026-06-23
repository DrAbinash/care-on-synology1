// Phase 8: AI Teaching Assistant
// Generate teaching summaries, learning points, and exam questions.

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
  GraduationCap, Brain, Sparkles, ArrowLeft, Copy, Check,
  BookOpen, FileText, Stethoscope, ClipboardList,
} from "lucide-react";

interface AIOutput {
  summary: string;
  learningPoints: string;
  differentialDiagnosis: string;
  examPearls: string;
  examQuestions: string[];
  whyThisCase: string;
  similarCases: string;
}

export default function TeachingAIAssistant() {
  const { toast } = useToast();
  const [_, navigate] = useLocation();
  const [input, setInput] = useState("");
  const [output, setOutput] = useState<AIOutput | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const aiMutation = useMutation({
    mutationFn: async (text: string) => {
      return api.post<{ result: AIOutput }>("/ai/teaching-assistant", { text, mode: "full" });
    },
    onSuccess: (data) => {
      setOutput(data.result);
      toast({ title: "Teaching material generated", description: "AI Draft \u2014 Requires Radiologist Review" });
    },
    onError: () => {
      toast({ title: "AI generation failed", description: "Please try again later.", variant: "destructive" });
    },
  });

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Teaching Assistant"
        subtitle="Generate educational summaries, learning points, and exam questions from case findings"
      />

      <div className="flex items-center gap-3">
        <Button variant="outline" onClick={() => navigate("/teaching-cases")}>
          <ArrowLeft size={16} className="mr-2" /> Teaching Files
        </Button>
      </div>

      {/* AI Safety Label */}
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex items-center gap-2 text-sm text-yellow-800">
        <Sparkles size={16} />
        <span className="font-medium">AI Draft \u2014 Requires Radiologist Review</span>
        <span className="text-yellow-700 ml-2">All generated content is editable and must be reviewed by a senior radiologist before use in teaching.</span>
      </div>

      {/* Input */}
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Brain size={16} className="text-primary" />
          <h3 className="font-semibold">Enter Case Findings</h3>
        </div>
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Paste the findings, impression, or full report text here..."
          rows={8}
          className="font-mono text-sm"
        />
        <div className="flex items-center gap-3">
          <Button
            onClick={() => aiMutation.mutate(input)}
            disabled={!input.trim() || aiMutation.isPending}
          >
            <Sparkles size={16} className="mr-2" />
            {aiMutation.isPending ? "Generating..." : "Generate Teaching Material"}
          </Button>
          <Button variant="outline" onClick={() => { setInput(""); setOutput(null); }}>
            Clear
          </Button>
        </div>
      </div>

      {/* Output */}
      {output && (
        <div className="bg-card border border-card-border rounded-xl p-5 space-y-5">
          <h3 className="font-semibold text-lg flex items-center gap-2">
            <GraduationCap size={18} /> Generated Teaching Material
          </h3>

          {/* Summary */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-medium flex items-center gap-2"><BookOpen size={14} /> Summary</h4>
              <Button variant="ghost" size="sm" onClick={() => handleCopy(output.summary, "summary")}>
                {copied === "summary" ? <Check size={14} /> : <Copy size={14} />}
              </Button>
            </div>
            <div className="bg-muted/30 rounded-lg p-3 text-sm whitespace-pre-wrap">{output.summary}</div>
          </section>

          {/* Learning Points */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-medium flex items-center gap-2"><Stethoscope size={14} /> Learning Points</h4>
              <Button variant="ghost" size="sm" onClick={() => handleCopy(output.learningPoints, "learning")}>
                {copied === "learning" ? <Check size={14} /> : <Copy size={14} />}
              </Button>
            </div>
            <div className="bg-muted/30 rounded-lg p-3 text-sm whitespace-pre-wrap">{output.learningPoints}</div>
          </section>

          {/* Differential */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-medium flex items-center gap-2"><FileText size={14} /> Differential Diagnosis</h4>
              <Button variant="ghost" size="sm" onClick={() => handleCopy(output.differentialDiagnosis, "diff")}>
                {copied === "diff" ? <Check size={14} /> : <Copy size={14} />}
              </Button>
            </div>
            <div className="bg-muted/30 rounded-lg p-3 text-sm whitespace-pre-wrap">{output.differentialDiagnosis}</div>
          </section>

          {/* Exam Pearls */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-medium flex items-center gap-2"><ClipboardList size={14} /> Exam Pearls</h4>
              <Button variant="ghost" size="sm" onClick={() => handleCopy(output.examPearls, "pearls")}>
                {copied === "pearls" ? <Check size={14} /> : <Copy size={14} />}
              </Button>
            </div>
            <div className="bg-muted/30 rounded-lg p-3 text-sm whitespace-pre-wrap">{output.examPearls}</div>
          </section>

          {/* Exam Questions */}
          <section>
            <h4 className="font-medium flex items-center gap-2 mb-2"><ClipboardList size={14} /> Exam Questions</h4>
            <div className="space-y-2">
              {output.examQuestions.map((q, i) => (
                <div key={i} className="bg-muted/30 rounded-lg p-3 text-sm flex items-start gap-2">
                  <Badge variant="outline">{i + 1}</Badge>
                  <span>{q}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
