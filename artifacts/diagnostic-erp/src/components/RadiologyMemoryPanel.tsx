/**
 * Phase 9: Radiology Memory + Context Engine
 * Learns Dr Sugandha's reporting preferences over time.
 * All features OFF by default. Radiologist is always final authority.
 */
import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import {
  Brain, Star, ThumbsUp, ThumbsDown, HelpCircle, Clock, ArrowRight,
  X, BookOpen, BarChart3, Search, Zap, ChevronDown, ChevronUp,
  TrendingUp, MessageSquare, Trash2, AlertTriangle,
} from "lucide-react";
import { isFeatureEnabled } from "@/lib/staffSession";
import AIConfidenceBadge, { parseConfidenceFromText } from "./AIConfidenceBadge";

interface MemorySuggestion {
  id: number;
  trigger: string;
  phrase: string;
  phraseType: string;
  usageCount: number;
  acceptanceCount: number;
}

interface MemoryPattern {
  id: number;
  patternType: string;
  key: string;
  variant: string;
  chosenCount: number;
  alternativeCount: number;
  preferenceRate: number;
  createdAt: string;
}

interface MemoryMeasurement {
  id: number;
  measurementType: string;
  value: string;
  unit: string;
  referenceRange?: string;
  priorValues?: string[];
  classification?: string;
  createdAt: string;
}

interface Props {
  patientId?: number;
  orderId?: number;
  modality?: string;
  bodyPart?: string;
  findingsText?: string;
  impressionText?: string;
  onSuggestionInsert?: (text: string) => void;
}

export default function RadiologyMemoryPanel({
  patientId,
  orderId,
  modality,
  bodyPart,
  findingsText,
  impressionText,
  onSuggestionInsert,
}: Props) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<"suggest" | "impressions" | "measurements" | "analytics" | "feedback">("suggest");
  const [suggestions, setSuggestions] = useState<MemorySuggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [patterns, setPatterns] = useState<MemoryPattern[]>([]);
  const [loadingPatterns, setLoadingPatterns] = useState(false);
  const [measurements, setMeasurements] = useState<MemoryMeasurement[]>([]);
  const [loadingMeasurements, setLoadingMeasurements] = useState(false);
  const [analytics, setAnalytics] = useState<any>(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedSuggestion, setExpandedSuggestion] = useState<number | null>(null);
  const [macroInput, setMacroInput] = useState("");
  const [macroSuggestions, setMacroSuggestions] = useState<string[]>([]);

  const enabled = isFeatureEnabled("radiologyMemoryEngine");
  const feedbackEnabled = isFeatureEnabled("radiologyFeedbackLoop");
  const macroEnabled = isFeatureEnabled("radiologyMacroEngine");
  const impressionMemoryEnabled = isFeatureEnabled("radiologyImpressionMemory");
  const measurementMemoryEnabled = isFeatureEnabled("radiologyMeasurementMemory");
  const analyticsEnabled = isFeatureEnabled("radiologyAnalyticsMemory");

  // Fetch suggestions based on trigger text
  const fetchSuggestions = useCallback(async () => {
    if (!enabled || !findingsText?.trim()) return;
    setLoadingSuggestions(true);
    try {
      const r = await fetch("/api/radiology-memory/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trigger: findingsText.slice(-50),
          modality: modality || "",
          bodyPart: bodyPart || "",
          limit: 10,
        }),
      });
      const data = await r.json();
      if (r.ok) {
        setSuggestions(data.suggestions ?? []);
      }
    } catch {
      // Silently fail — memory is auxiliary
    } finally {
      setLoadingSuggestions(false);
    }
  }, [enabled, findingsText, modality, bodyPart]);

  // Fetch patterns / style preferences
  const fetchPatterns = useCallback(async () => {
    if (!enabled || !isFeatureEnabled("radiologyStyleLearning")) return;
    setLoadingPatterns(true);
    try {
      const r = await fetch("/api/radiology-memory/patterns?limit=20");
      const data = await r.json();
      if (r.ok) {
        setPatterns(data.patterns ?? []);
      }
    } catch {
      // Silently fail
    } finally {
      setLoadingPatterns(false);
    }
  }, [enabled]);

  // Fetch measurements history
  const fetchMeasurements = useCallback(async () => {
    if (!measurementMemoryEnabled || !patientId) return;
    setLoadingMeasurements(true);
    try {
      const r = await fetch(
        `/api/radiology-memory/measurements?patientId=${patientId}&modality=${modality || ""}&bodyPart=${bodyPart || ""}&limit=20`
      );
      const data = await r.json();
      if (r.ok) {
        setMeasurements(data.measurements ?? []);
      }
    } catch {
      // Silently fail
    } finally {
      setLoadingMeasurements(false);
    }
  }, [measurementMemoryEnabled, patientId, modality, bodyPart]);

  // Fetch analytics
  const fetchAnalytics = useCallback(async () => {
    if (!analyticsEnabled) return;
    setLoadingAnalytics(true);
    try {
      const r = await fetch("/api/radiology-memory/analytics?days=30");
      const data = await r.json();
      if (r.ok) {
        setAnalytics(data);
      }
    } catch {
      // Silently fail
    } finally {
      setLoadingAnalytics(false);
    }
  }, [analyticsEnabled]);

  // Auto-fetch suggestions when findings text changes (debounced)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (activeTab === "suggest") fetchSuggestions();
    }, 800);
    return () => clearTimeout(timer);
  }, [activeTab, findingsText, fetchSuggestions]);

  useEffect(() => {
    if (activeTab === "impressions") fetchPatterns();
    if (activeTab === "measurements") fetchMeasurements();
    if (activeTab === "analytics") fetchAnalytics();
  }, [activeTab, fetchPatterns, fetchMeasurements, fetchAnalytics]);

  // Macro engine: listen for "/" triggers
  const handleMacroInput = (val: string) => {
    setMacroInput(val);
    if (!macroEnabled || val.length < 2 || !val.startsWith("/")) {
      setMacroSuggestions([]);
      return;
    }
    // Simple client-side prefix matching for now
    const prefix = val.slice(1).toLowerCase();
    const commonMacros = [
      { key: "normalbrain", text: "Normal brain parenchyma with no focal lesion or abnormal signal. Ventricular system is normal. No midline shift." },
      { key: "l4l5disc", text: "L4-L5: Posterior disc bulge with bilateral neural foraminal narrowing." },
      { key: "fazekas2", text: "Fazekas grade 2 white matter hyperintensities (moderate periventricular involvement)." },
      { key: "normalchest", text: "Both lungs are clear. No consolidation, effusion, or pneumothorax. Cardiothoracic ratio is normal." },
      { key: "normalliver", text: "Liver is normal in size and echotexture. No focal lesion. Portal vein is normal." },
      { key: "gallstone", text: "Gallbladder shows multiple echogenic foci with posterior acoustic shadowing, consistent with cholelithiasis." },
    ];
    const matches = commonMacros
      .filter((m) => m.key.includes(prefix))
      .map((m) => m.text);
    setMacroSuggestions(matches);
  };

  // Log feedback on a suggestion
  const sendFeedback = async (suggestionText: string, rating: "useful" | "not_useful" | "partially_useful") => {
    if (!feedbackEnabled) return;
    try {
      await fetch("/api/radiology-memory/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suggestionType: "phrase",
          suggestionText,
          rating,
          modality: modality || "",
          bodyPart: bodyPart || "",
          orderId: orderId || null,
          reportId: null,
        }),
      });
      toast({ title: "Feedback recorded", description: "Thank you for helping me learn." });
    } catch {
      // Silently fail
    }
  };

  // Log decision (accept/reject/edit)
  const logDecision = async (suggestionText: string, action: "accepted" | "rejected" | "edited") => {
    if (!isFeatureEnabled("radiologyDecisionMemory")) return;
    try {
      await fetch("/api/radiology-memory/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suggestionType: "phrase",
          suggestionText,
          action,
          finalText: impressionText?.slice(0, 500) || null,
          modality: modality || null,
          bodyPart: bodyPart || null,
          orderId: orderId || null,
          reportId: null,
        }),
      });
    } catch {
      // Silently fail
    }
  };

  // Memorize approved report
  const memorize = async () => {
    if (!enabled || !findingsText?.trim()) return;
    try {
      await fetch("/api/radiology-memory/memorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modality: modality || "",
          bodyPart: bodyPart || "",
          findingText: findingsText,
          impressionText: impressionText || "",
          orderId: orderId || 0,
        }),
      });
      toast({ title: "Report memorized", description: "I'll remember this for future suggestions." });
    } catch {
      // Silently fail
    }
  };

  const tabs = [
    { id: "suggest" as const, label: "Suggest", icon: Brain, enabled: enabled },
    { id: "impressions" as const, label: "Impressions", icon: BookOpen, enabled: impressionMemoryEnabled },
    { id: "measurements" as const, label: "Measurements", icon: TrendingUp, enabled: measurementMemoryEnabled },
    { id: "analytics" as const, label: "Analytics", icon: BarChart3, enabled: analyticsEnabled },
    { id: "feedback" as const, label: "Feedback", icon: MessageSquare, enabled: feedbackEnabled },
  ];

  const activeTabs = tabs.filter((t) => t.enabled);

  if (!enabled) {
    return (
      <div className="bg-card border border-card-border rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 bg-muted/30 border-b border-border flex items-center gap-2">
          <Brain size={14} className="text-primary" />
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Radiology Memory</span>
        </div>
        <div className="p-4 text-center text-xs text-muted-foreground">
          Memory Engine is OFF. Enable it in Settings → Radiology Memory.
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-card-border rounded-xl shadow-sm overflow-hidden">
      <div className="px-4 py-2 bg-muted/30 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain size={14} className="text-primary" />
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Radiology Memory</span>
        </div>
        <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={memorize}>
          <Star size={10} className="mr-1" /> Memorize
        </Button>
      </div>

      {/* Tab buttons */}
      {activeTabs.length > 0 && (
        <div className="flex border-b border-border">
          {activeTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-1 py-2 text-[11px] font-medium transition-colors ${
                activeTab === tab.id
                  ? "bg-primary/10 text-primary border-b-2 border-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/20"
              }`}
            >
              <tab.icon size={12} />
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* Tab content */}
      <div className="p-3 space-y-3 max-h-[400px] overflow-y-auto">

        {/* ── Suggest Tab ── */}
        {activeTab === "suggest" && (
          <div className="space-y-3">
            {/* Macro Engine */}
            {macroEnabled && (
              <div className="space-y-2">
                <div className="text-[10px] font-semibold uppercase text-muted-foreground flex items-center gap-1">
                  <Zap size={10} /> Macro Engine
                </div>
                <Input
                  value={macroInput}
                  onChange={(e) => handleMacroInput(e.target.value)}
                  placeholder="Type /normalbrain, /l4l5disc, /fazekas2..."
                  className="text-xs h-8"
                />
                {macroSuggestions.length > 0 && (
                  <div className="border rounded-lg overflow-hidden space-y-1">
                    <div className="text-[10px] text-amber-600 font-medium flex items-center gap-1 px-3 py-1 bg-amber-50 dark:bg-amber-900/10">
                      <AlertTriangle size={10} /> AI Draft – Requires Radiologist Review
                    </div>
                    {macroSuggestions.map((text, i) => (
                      <button
                        key={i}
                        className="w-full text-left px-3 py-2 text-[11px] hover:bg-muted/20 transition-colors flex items-center gap-2"
                        onClick={() => {
                          onSuggestionInsert?.(text);
                          setMacroInput("");
                          setMacroSuggestions([]);
                        }}
                      >
                        <ArrowRight size={10} className="text-primary flex-shrink-0" />
                        <span className="truncate">{text.slice(0, 60)}...</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Memory Suggestions */}
            <div className="space-y-2">
              <div className="text-[10px] font-semibold uppercase text-muted-foreground flex items-center gap-1">
                <Search size={10} /> Smart Suggestions
              </div>
              {loadingSuggestions ? (
                <div className="text-center py-3 text-xs text-muted-foreground">Loading suggestions...</div>
              ) : suggestions.length === 0 ? (
                <div className="text-center py-3 text-xs text-muted-foreground">
                  {findingsText?.trim()
                    ? "No matching suggestions yet. Keep reporting — I will learn."
                    : "Start typing findings to see suggestions."}
                </div>
              ) : (
                <div className="space-y-1">
                  {suggestions.map((s) => (
                    <div key={s.id} className="border rounded-lg overflow-hidden">
                      <button
                        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-muted/20 transition-colors"
                        onClick={() => setExpandedSuggestion(expandedSuggestion === s.id ? null : s.id)}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[10px] font-mono uppercase text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                            {s.phraseType}
                          </span>
                          <span className="text-xs truncate">{s.phrase.slice(0, 40)}...</span>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <span className="text-[10px] text-muted-foreground">
                            <Clock size={10} className="inline mr-0.5" />
                            {s.usageCount}x
                          </span>
                          {expandedSuggestion === s.id ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        </div>
                      </button>
                      {expandedSuggestion === s.id && (
                        <div className="px-3 py-2 border-t bg-muted/10 text-xs space-y-2">
                          <div className="text-[10px] text-amber-600 font-medium flex items-center gap-1">
                            <AlertTriangle size={10} /> AI Draft – Requires Radiologist Review
                          </div>
                          {isFeatureEnabled("confidenceVisualization") ? (
                            <AIConfidenceBadge metadata={{
                              confidence: parseConfidenceFromText(s.phrase),
                            }}>
                              <Textarea value={s.phrase} readOnly className="text-[11px] min-h-[60px] bg-muted/30" />
                            </AIConfidenceBadge>
                          ) : (
                            <Textarea value={s.phrase} readOnly className="text-[11px] min-h-[60px] bg-muted/30" />
                          )}
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              className="flex-1 text-[10px] h-7"
                              onClick={() => {
                                onSuggestionInsert?.(s.phrase);
                                logDecision(s.phrase, "accepted");
                              }}
                            >
                              <ArrowRight size={10} className="mr-1" /> Insert
                            </Button>
                            {feedbackEnabled && (
                              <div className="flex gap-1">
                                <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => sendFeedback(s.phrase, "useful")}>
                                  <ThumbsUp size={10} />
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => sendFeedback(s.phrase, "not_useful")}>
                                  <ThumbsDown size={10} />
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => sendFeedback(s.phrase, "partially_useful")}>
                                  <HelpCircle size={10} />
                                </Button>
                              </div>
                            )}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            Trigger: {s.trigger}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Impressions Tab ── */}
        {activeTab === "impressions" && (
          <div className="space-y-3">
            <div className="text-[10px] text-amber-600 font-medium flex items-center gap-1">
              <AlertTriangle size={10} /> AI Draft – Requires Radiologist Review
            </div>
            <p className="text-[11px] text-muted-foreground">
              Impressions recalled from similar cases. Always review before use.
            </p>
            {loadingPatterns ? (
              <div className="text-center py-3 text-xs text-muted-foreground">Loading...</div>
            ) : patterns.length === 0 ? (
              <div className="text-center py-3 text-xs text-muted-foreground">
                No impression patterns yet. Report more cases to build memory.
              </div>
            ) : (
              <div className="space-y-1">
                {patterns.map((p) => (
                  <div key={p.id} className="border rounded-lg px-3 py-2 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold uppercase text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                        {p.patternType}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{p.preferenceRate}% prefer</span>
                    </div>
                    <p className="text-[11px]">{p.variant}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Measurements Tab ── */}
        {activeTab === "measurements" && (
          <div className="space-y-3">
            <p className="text-[11px] text-muted-foreground">
              Historical measurements for this patient. Trends are for reference only.
            </p>
            {loadingMeasurements ? (
              <div className="text-center py-3 text-xs text-muted-foreground">Loading...</div>
            ) : measurements.length === 0 ? (
              <div className="text-center py-3 text-xs text-muted-foreground">
                {patientId ? "No measurements recorded for this patient." : "Select a patient to see measurement history."}
              </div>
            ) : (
              <div className="space-y-1">
                {measurements.map((m) => (
                  <div key={m.id} className="border rounded-lg px-3 py-2 text-xs flex items-center justify-between">
                    <div>
                      <div className="font-medium">{m.measurementType}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {m.classification ? `Classification: ${m.classification}` : "No classification"}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-primary">{m.value} {m.unit}</div>
                      <div className="text-[10px] text-muted-foreground">{m.referenceRange}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Analytics Tab ── */}
        {activeTab === "analytics" && (
          <div className="space-y-3">
            <p className="text-[11px] text-muted-foreground">
              Dr Sugandha's personal productivity dashboard. All data is local to your account.
            </p>
            {loadingAnalytics ? (
              <div className="text-center py-3 text-xs text-muted-foreground">Loading...</div>
            ) : !analytics ? (
              <div className="text-center py-3 text-xs text-muted-foreground">
                Not enough data yet. Keep reporting to see your analytics.
              </div>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="border rounded-lg p-2 text-center">
                    <div className="text-lg font-bold text-primary">{analytics.totalReports ?? 0}</div>
                    <div className="text-[10px] text-muted-foreground">Reports</div>
                  </div>
                  <div className="border rounded-lg p-2 text-center">
                    <div className="text-lg font-bold text-primary">{analytics.suggestionsUsed ?? 0}</div>
                    <div className="text-[10px] text-muted-foreground">Suggestions Used</div>
                  </div>
                  <div className="border rounded-lg p-2 text-center">
                    <div className="text-lg font-bold text-primary">{analytics.timeSavedMinutes ?? 0}</div>
                    <div className="text-[10px] text-muted-foreground">Minutes Saved</div>
                  </div>
                  <div className="border rounded-lg p-2 text-center">
                    <div className="text-lg font-bold text-primary">{analytics.topPhrases?.length ?? 0}</div>
                    <div className="text-[10px] text-muted-foreground">Top Phrases</div>
                  </div>
                </div>
                {analytics.topPhrases?.length > 0 && (
                  <div className="border rounded-lg p-3 space-y-1">
                    <div className="text-[10px] font-semibold uppercase text-muted-foreground">Most Used Phrases</div>
                    {analytics.topPhrases.map((p: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-[11px]">
                        <span className="truncate">{p.phrase}</span>
                        <span className="text-muted-foreground">{p.count}x</span>
                      </div>
                    ))}
                  </div>
                )}
                {analytics.topTemplates?.length > 0 && (
                  <div className="border rounded-lg p-3 space-y-1">
                    <div className="text-[10px] font-semibold uppercase text-muted-foreground">Most Used Templates</div>
                    {analytics.topTemplates.map((t: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-[11px]">
                        <span className="truncate">{t.name}</span>
                        <span className="text-muted-foreground">{t.count}x</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Feedback Tab ── */}
        {activeTab === "feedback" && (
          <div className="space-y-3">
            <p className="text-[11px] text-muted-foreground">
              Your feedback helps me learn. Rate suggestions to improve future accuracy.
            </p>
            <div className="space-y-2">
              <Button
                size="sm"
                variant="outline"
                className="w-full text-xs justify-start"
                onClick={() => {
                  if (findingsText?.trim()) {
                    sendFeedback(findingsText.slice(0, 200), "useful");
                  } else {
                    toast({ title: "Enter findings first", variant: "destructive" });
                  }
                }}
              >
                <ThumbsUp size={12} className="mr-2 text-green-600" /> This was Useful
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="w-full text-xs justify-start"
                onClick={() => {
                  if (findingsText?.trim()) {
                    sendFeedback(findingsText.slice(0, 200), "partially_useful");
                  } else {
                    toast({ title: "Enter findings first", variant: "destructive" });
                  }
                }}
              >
                <HelpCircle size={12} className="mr-2 text-amber-600" /> Partially Useful
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="w-full text-xs justify-start"
                onClick={() => {
                  if (findingsText?.trim()) {
                    sendFeedback(findingsText.slice(0, 200), "not_useful");
                  } else {
                    toast({ title: "Enter findings first", variant: "destructive" });
                  }
                }}
              >
                <ThumbsDown size={12} className="mr-2 text-red-600" /> Not Useful
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="w-full text-xs justify-start"
                onClick={() => {
                  if (findingsText?.trim()) {
                    logDecision(findingsText.slice(0, 200), "rejected");
                  }
                  toast({ title: "Decision logged", description: "I'll learn from this rejection." });
                }}
              >
                <Trash2 size={12} className="mr-2 text-muted-foreground" /> Rejected / Ignored
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
