// Phase 8: Teaching Presentation Mode
// Generate teaching slides, quizzes, and unknown cases.

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
  Presentation, ArrowLeft, Sparkles, Copy, Check, FileText, Play,
  GraduationCap, HelpCircle, ChevronRight,
} from "lucide-react";

interface SlideData {
  title: string;
  content: string;
  type: "case" | "image" | "question" | "summary" | "reference";
}

interface QuizQuestion {
  question: string;
  options: string[];
  correctAnswer: number;
  explanation: string;
}

interface PresentationOutput {
  slides: SlideData[];
  quiz: QuizQuestion[];
  unknownCase: { findings: string; impression: string; reveal: string };
  duration: string;
}

export default function TeachingPresentationMode() {
  const { toast } = useToast();
  const [_, navigate] = useLocation();
  const [input, setInput] = useState("");
  const [output, setOutput] = useState<PresentationOutput | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [activeSlide, setActiveSlide] = useState(0);
  const [mode, setMode] = useState<"slides" | "quiz" | "unknown">("slides");

  const aiMutation = useMutation({
    mutationFn: async (text: string) => {
      return api.post<{ result: PresentationOutput }>("/ai/teaching-presentation", { text, mode });
    },
    onSuccess: (data) => {
      setOutput(data.result);
      setActiveSlide(0);
      toast({ title: "Presentation generated", description: "AI Draft \u2014 Requires Radiologist Review" });
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

  const slides = output?.slides ?? [];
  const quiz = output?.quiz ?? [];
  const unknown = output?.unknownCase;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Presentation Mode"
        subtitle="Generate teaching slides, quizzes, and unknown cases"
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
          <Presentation size={16} className="text-primary" />
          <h3 className="font-semibold">Enter Case Findings</h3>
        </div>
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Paste the findings or impression here..."
          rows={6}
          className="font-mono text-sm"
        />
        <div className="flex items-center gap-2">
          <button
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${mode === "slides" ? "bg-primary text-white" : "bg-muted text-muted-foreground border border-card-border"}`}
            onClick={() => setMode("slides")}
          >
            <FileText size={14} className="inline mr-1" /> Slides
          </button>
          <button
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${mode === "quiz" ? "bg-primary text-white" : "bg-muted text-muted-foreground border border-card-border"}`}
            onClick={() => setMode("quiz")}
          >
            <HelpCircle size={14} className="inline mr-1" /> Quiz
          </button>
          <button
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${mode === "unknown" ? "bg-primary text-white" : "bg-muted text-muted-foreground border border-card-border"}`}
            onClick={() => setMode("unknown")}
          >
            <Play size={14} className="inline mr-1" /> Unknown Case
          </button>
        </div>
        <div className="flex items-center gap-3">
          <Button
            onClick={() => aiMutation.mutate(input)}
            disabled={!input.trim() || aiMutation.isPending}
          >
            <Sparkles size={16} className="mr-2" />
            {aiMutation.isPending ? "Generating..." : "Generate Presentation"}
          </Button>
          <Button variant="outline" onClick={() => { setInput(""); setOutput(null); }}>
            Clear
          </Button>
        </div>
      </div>

      {/* Output */}
      {output && mode === "slides" && slides.length > 0 && (
        <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-lg flex items-center gap-2">
              <Presentation size={18} /> Teaching Slides
            </h3>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">{activeSlide + 1} / {slides.length}</span>
              <Button variant="outline" size="sm" onClick={() => setActiveSlide(Math.max(0, activeSlide - 1))} disabled={activeSlide === 0}>
                Prev
              </Button>
              <Button variant="outline" size="sm" onClick={() => setActiveSlide(Math.min(slides.length - 1, activeSlide + 1))} disabled={activeSlide === slides.length - 1}>
                Next
              </Button>
            </div>
          </div>

          <div className="bg-muted/30 rounded-lg p-6 min-h-[200px] space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline">{slides[activeSlide].type}</Badge>
              <Button variant="ghost" size="sm" onClick={() => handleCopy(slides[activeSlide].content, `slide-${activeSlide}`)}>
                {copied === `slide-${activeSlide}` ? <Check size={14} /> : <Copy size={14} />}
              </Button>
            </div>
            <h4 className="font-semibold text-lg">{slides[activeSlide].title}</h4>
            <div className="text-sm whitespace-pre-wrap">{slides[activeSlide].content}</div>
          </div>
        </div>
      )}

      {output && mode === "quiz" && quiz.length > 0 && (
        <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
          <h3 className="font-semibold text-lg flex items-center gap-2">
            <HelpCircle size={18} /> Quiz
          </h3>
          <div className="space-y-4">
            {quiz.map((q, i) => (
              <div key={i} className="bg-muted/30 rounded-lg p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{i + 1}</Badge>
                  <span className="font-medium text-sm">{q.question}</span>
                </div>
                <div className="space-y-1">
                  {q.options.map((opt, j) => (
                    <div key={j} className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-muted/50">
                      <span className="text-xs font-medium w-5">{String.fromCharCode(65 + j)}.</span>
                      <span>{opt}</span>
                    </div>
                  ))}
                </div>
                <div className="text-sm text-green-700 bg-green-50 rounded-lg p-2">
                  <span className="font-medium">Answer: {String.fromCharCode(65 + q.correctAnswer)}</span> — {q.explanation}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {output && mode === "unknown" && unknown && (
        <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
          <h3 className="font-semibold text-lg flex items-center gap-2">
            <Play size={18} /> Unknown Case
          </h3>
          <div className="bg-muted/30 rounded-lg p-4 space-y-2">
            <h4 className="font-medium">Findings</h4>
            <div className="text-sm whitespace-pre-wrap">{unknown.findings}</div>
          </div>
          <div className="bg-muted/30 rounded-lg p-4 space-y-2">
            <h4 className="font-medium">What is the Diagnosis?</h4>
            <div className="text-sm text-muted-foreground">Think before revealing...</div>
          </div>
          <div className="bg-green-50 rounded-lg p-4 space-y-2">
            <h4 className="font-medium text-green-800">Reveal</h4>
            <div className="text-sm text-green-800 whitespace-pre-wrap">{unknown.reveal}</div>
          </div>
        </div>
      )}
    </div>
  );
}
