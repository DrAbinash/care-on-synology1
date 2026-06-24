import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Star, ShieldAlert, Plus, Trash2, Zap, Clock, BarChart3, PlusCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface UserReportPreferences {
  id: number;
  userId: number;
  favoriteFindings: string;     // JSON string: number[]
  favoriteImpressions: string;   // JSON string: string[]
  favoriteTemplates: string;     // JSON string: string[]
  personalMacros: string;        // JSON string: { name: string, content: string }[]
}

interface UsageLog {
  id: number;
  itemType: "finding" | "template" | "macro";
  itemId: string;
  itemLabel: string;
  usedAt: string;
}

interface PreferencesPanelProps {
  currentUserId?: number | null;
  onApplyTemplate: (templateName: string) => void;
  onInsertFindingText: (findingText: string) => void;
  onInsertImpressionPoint: (impressionText: string) => void;
}

export default function PreferencesPanel({
  currentUserId,
  onApplyTemplate,
  onInsertFindingText,
  onInsertImpressionPoint,
}: PreferencesPanelProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [activeSubTab, setActiveSubTab] = useState<"favs" | "macros" | "recents">("favs");
  const [isAddMacroOpen, setIsAddMacroOpen] = useState(false);
  const [macroName, setMacroName] = useState("");
  const [macroContent, setMacroContent] = useState("");

  const [isAddImpressionOpen, setIsAddImpressionOpen] = useState(false);
  const [newImpressionText, setNewImpressionText] = useState("");

  const [isAddTemplateOpen, setIsAddTemplateOpen] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");

  // Fetch preferences
  const { data: preferences } = useQuery<UserReportPreferences>({
    queryKey: ["user-report-preferences"],
    queryFn: () => api.get<UserReportPreferences>("/api/radiology/user-report-preferences"),
    enabled: !!currentUserId,
  });

  // Fetch usage logs
  const { data: usageLogs = [] } = useQuery<UsageLog[]>({
    queryKey: ["user-item-usage-logs"],
    queryFn: () => api.get<UsageLog[]>("/api/radiology/user-item-usage"),
    enabled: !!currentUserId,
  });

  const favImpressions: string[] = React.useMemo(() => {
    if (!preferences?.favoriteImpressions) return [];
    try { return JSON.parse(preferences.favoriteImpressions); } catch { return []; }
  }, [preferences]);

  const favTemplates: string[] = React.useMemo(() => {
    if (!preferences?.favoriteTemplates) return [];
    try { return JSON.parse(preferences.favoriteTemplates); } catch { return []; }
  }, [preferences]);

  const personalMacros: { name: string; content: string }[] = React.useMemo(() => {
    if (!preferences?.personalMacros) return [];
    try { return JSON.parse(preferences.personalMacros); } catch { return []; }
  }, [preferences]);

  // Mutations
  const updatePreferencesMutation = useMutation({
    mutationFn: async (payload: Partial<UserReportPreferences>) => {
      return api.post("/api/radiology/user-report-preferences", payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-report-preferences"] });
    },
  });

  const logUsageMutation = useMutation({
    mutationFn: async (payload: { itemType: string; itemId: string; itemLabel: string }) => {
      return api.post("/api/radiology/user-item-usage", payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-item-usage-logs"] });
    },
  });

  const handleAddMacro = () => {
    if (!macroName.trim() || !macroContent.trim()) return;
    const nextMacros = [...personalMacros, { name: macroName.trim(), content: macroContent.trim() }];
    updatePreferencesMutation.mutate({
      personalMacros: JSON.stringify(nextMacros),
    });
    setIsAddMacroOpen(false);
    setMacroName("");
    setMacroContent("");
    toast({ title: "Personal macro added" });
  };

  const handleDeleteMacro = (nameToDelete: string) => {
    const nextMacros = personalMacros.filter((m) => m.name !== nameToDelete);
    updatePreferencesMutation.mutate({
      personalMacros: JSON.stringify(nextMacros),
    });
    toast({ title: "Personal macro deleted" });
  };

  const handleAddImpression = () => {
    if (!newImpressionText.trim()) return;
    const nextImps = [...favImpressions, newImpressionText.trim()];
    updatePreferencesMutation.mutate({
      favoriteImpressions: JSON.stringify(nextImps),
    });
    setIsAddImpressionOpen(false);
    setNewImpressionText("");
    toast({ title: "Favorite impression saved" });
  };

  const handleDeleteImpression = (textToDelete: string) => {
    const nextImps = favImpressions.filter((i) => i !== textToDelete);
    updatePreferencesMutation.mutate({
      favoriteImpressions: JSON.stringify(nextImps),
    });
    toast({ title: "Favorite impression deleted" });
  };

  const handleAddTemplate = () => {
    if (!newTemplateName.trim()) return;
    const nextTemps = [...favTemplates, newTemplateName.trim()];
    updatePreferencesMutation.mutate({
      favoriteTemplates: JSON.stringify(nextTemps),
    });
    setIsAddTemplateOpen(false);
    setNewTemplateName("");
    toast({ title: "Favorite template saved" });
  };

  const handleDeleteTemplate = (nameToDelete: string) => {
    const nextTemps = favTemplates.filter((t) => t !== nameToDelete);
    updatePreferencesMutation.mutate({
      favoriteTemplates: JSON.stringify(nextTemps),
    });
    toast({ title: "Favorite template deleted" });
  };

  // Analytics helper functions
  const analytics = React.useMemo(() => {
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    const oneWeek = 7 * oneDay;
    const oneMonth = 30 * oneDay;

    const counts = { today: 0, week: 0, month: 0 };
    usageLogs.forEach((log) => {
      const time = new Date(log.usedAt).getTime();
      const diff = now - time;
      if (diff <= oneDay) counts.today++;
      if (diff <= oneWeek) counts.week++;
      if (diff <= oneMonth) counts.month++;
    });
    return counts;
  }, [usageLogs]);

  return (
    <div className="space-y-4 text-slate-200">
      {/* Sub Tabs switcher */}
      <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800 shrink-0">
        <button
          onClick={() => setActiveSubTab("favs")}
          className={`flex-1 py-1 text-[10px] font-semibold rounded-md transition-colors flex items-center justify-center gap-1 ${
            activeSubTab === "favs" ? "bg-slate-800 text-yellow-400" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <Star size={10} fill={activeSubTab === "favs" ? "currentColor" : "none"} />
          Favorites
        </button>
        <button
          onClick={() => setActiveSubTab("macros")}
          className={`flex-1 py-1 text-[10px] font-semibold rounded-md transition-colors flex items-center justify-center gap-1 ${
            activeSubTab === "macros" ? "bg-slate-800 text-emerald-400" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <Zap size={10} />
          Macros
        </button>
        <button
          onClick={() => setActiveSubTab("recents")}
          className={`flex-1 py-1 text-[10px] font-semibold rounded-md transition-colors flex items-center justify-center gap-1 ${
            activeSubTab === "recents" ? "bg-slate-800 text-cyan-400" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <Clock size={10} />
          Analytics
        </button>
      </div>

      {/* Content Panels */}
      {activeSubTab === "favs" && (
        <div className="space-y-4">
          {/* Favorite Templates */}
          <div className="space-y-2">
            <div className="flex justify-between items-center border-b border-slate-800 pb-1">
              <span className="text-[10px] uppercase font-bold text-slate-400">★ Pinned Templates</span>
              <button onClick={() => setIsAddTemplateOpen(true)} className="text-[9px] text-emerald-400 hover:underline flex items-center gap-0.5">
                <Plus size={8} /> Add Pinned
              </button>
            </div>
            <div className="flex flex-col gap-1.5 max-h-28 overflow-y-auto">
              {favTemplates.map((t) => (
                <div key={t} className="flex items-center justify-between bg-slate-900/50 border border-slate-850 p-2 rounded text-xs">
                  <button
                    onClick={() => {
                      onApplyTemplate(t);
                      logUsageMutation.mutate({ itemType: "template", itemId: t, itemLabel: t });
                    }}
                    className="flex-1 text-left text-slate-300 hover:text-emerald-400 truncate"
                  >
                    {t}
                  </button>
                  <button onClick={() => handleDeleteTemplate(t)} className="text-slate-500 hover:text-red-400 p-0.5">
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
              {favTemplates.length === 0 && (
                <p className="text-[10px] text-slate-500 text-center py-2">No templates pinned yet.</p>
              )}
            </div>
          </div>

          {/* Favorite Impressions */}
          <div className="space-y-2">
            <div className="flex justify-between items-center border-b border-slate-800 pb-1">
              <span className="text-[10px] uppercase font-bold text-slate-400">★ Favorite Impressions</span>
              <button onClick={() => setIsAddImpressionOpen(true)} className="text-[9px] text-emerald-400 hover:underline flex items-center gap-0.5">
                <Plus size={8} /> Add Favorite
              </button>
            </div>
            <div className="flex flex-col gap-1.5 max-h-36 overflow-y-auto">
              {favImpressions.map((imp) => (
                <div key={imp} className="flex items-start justify-between bg-slate-900/50 border border-slate-850 p-2 rounded text-xs gap-1">
                  <button
                    onClick={() => {
                      onInsertImpressionPoint(imp);
                      logUsageMutation.mutate({ itemType: "finding", itemId: imp, itemLabel: imp });
                    }}
                    className="flex-1 text-left text-slate-300 hover:text-emerald-400 line-clamp-2"
                  >
                    {imp}
                  </button>
                  <button onClick={() => handleDeleteImpression(imp)} className="text-slate-500 hover:text-red-400 p-0.5 shrink-0">
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
              {favImpressions.length === 0 && (
                <p className="text-[10px] text-slate-500 text-center py-2">No impression shortcuts saved.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {activeSubTab === "macros" && (
        <div className="space-y-3">
          <div className="flex justify-between items-center border-b border-slate-800 pb-1">
            <span className="text-[10px] uppercase font-bold text-slate-400">Personal Macros</span>
            <button onClick={() => setIsAddMacroOpen(true)} className="text-[9px] text-emerald-400 hover:underline flex items-center gap-0.5">
              <Plus size={8} /> Add Macro
            </button>
          </div>

          <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
            {personalMacros.map((macro) => (
              <div key={macro.name} className="bg-slate-900/50 border border-slate-850 p-2.5 rounded flex flex-col justify-between gap-1 relative group">
                <div className="flex justify-between items-center border-b border-slate-800 pb-1">
                  <button
                    onClick={() => {
                      onInsertFindingText(macro.content);
                      logUsageMutation.mutate({ itemType: "macro", itemId: macro.name, itemLabel: macro.name });
                    }}
                    className="text-xs font-bold font-mono text-emerald-400 hover:underline"
                  >
                    /{macro.name}
                  </button>
                  <button onClick={() => handleDeleteMacro(macro.name)} className="text-slate-500 hover:text-red-400 p-0.5">
                    <Trash2 size={11} />
                  </button>
                </div>
                <p className="text-[10.5px] text-slate-400 line-clamp-2 mt-1">{macro.content}</p>
              </div>
            ))}
            {personalMacros.length === 0 && (
              <p className="text-[10px] text-slate-500 text-center py-4">Create custom macros to expand typing shortcuts (e.g. typing /AGE_CHANGES).</p>
            )}
          </div>
        </div>
      )}

      {activeSubTab === "recents" && (() => {
        const mostUsed = (() => {
          const counts: Record<string, { label: string; type: string; count: number }> = {};
          usageLogs.forEach((log) => {
            const key = `${log.itemType}-${log.itemId}`;
            if (!counts[key]) {
              counts[key] = { label: log.itemLabel, type: log.itemType, count: 0 };
            }
            counts[key].count++;
          });
          const list = Object.values(counts);
          const templatesList = list.filter((x) => x.type === "template").sort((a, b) => b.count - a.count).slice(0, 5);
          const findingsList = list.filter((x) => x.type === "finding").sort((a, b) => b.count - a.count).slice(0, 5);
          const macrosList = list.filter((x) => x.type === "macro").sort((a, b) => b.count - a.count).slice(0, 5);
          return { templatesList, findingsList, macrosList };
        })();

        const favFindingsCount = (() => {
          if (!preferences?.favoriteFindings) return 0;
          try { return JSON.parse(preferences.favoriteFindings).length; } catch { return 0; }
        })();

        return (
          <div className="space-y-4">
            {/* Frequency Analytics Cards */}
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-slate-900/50 border border-slate-850 rounded p-2 text-center">
                <span className="text-[8px] uppercase text-slate-500 block">Today</span>
                <span className="text-sm font-bold text-emerald-400">{analytics.today}</span>
              </div>
              <div className="bg-slate-900/50 border border-slate-850 rounded p-2 text-center">
                <span className="text-[8px] uppercase text-slate-500 block">This Week</span>
                <span className="text-sm font-bold text-emerald-400">{analytics.week}</span>
              </div>
              <div className="bg-slate-900/50 border border-slate-850 rounded p-2 text-center">
                <span className="text-[8px] uppercase text-slate-500 block">This Month</span>
                <span className="text-sm font-bold text-emerald-400">{analytics.month}</span>
              </div>
            </div>

            {/* Pinned/Favorites Summary */}
            <div className="bg-slate-900/35 border border-slate-850 p-2.5 rounded-lg space-y-1.5">
              <span className="text-[10px] uppercase font-bold text-slate-400 block border-b border-slate-800 pb-1">Favorites & Pinned</span>
              <div className="grid grid-cols-2 gap-2 text-[10.5px] text-slate-300">
                <div>Pinned Templates: <span className="font-bold text-emerald-400">{favTemplates.length}</span></div>
                <div>Pinned Impressions: <span className="font-bold text-emerald-400">{favImpressions.length}</span></div>
                <div>Personal Macros: <span className="font-bold text-emerald-400">{personalMacros.length}</span></div>
                <div>Pinned Findings: <span className="font-bold text-emerald-400">{favFindingsCount}</span></div>
              </div>
            </div>

            {/* Most Used sections */}
            <div className="space-y-3">
              {mostUsed.templatesList.length > 0 && (
                <div className="space-y-1">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block border-b border-slate-850/50 pb-0.5">Most Used Templates</span>
                  <div className="space-y-1">
                    {mostUsed.templatesList.map((item, idx) => (
                      <div key={idx} className="flex justify-between items-center text-[10.5px] bg-slate-900/20 px-2 py-1 rounded">
                        <span className="text-slate-300 truncate max-w-[160px]">{item.label}</span>
                        <span className="text-[9px] text-slate-500 font-mono">{item.count}x</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {mostUsed.findingsList.length > 0 && (
                <div className="space-y-1">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block border-b border-slate-850/50 pb-0.5">Most Used Findings/Impressions</span>
                  <div className="space-y-1">
                    {mostUsed.findingsList.map((item, idx) => (
                      <div key={idx} className="flex justify-between items-center text-[10.5px] bg-slate-900/20 px-2 py-1 rounded">
                        <span className="text-slate-300 truncate max-w-[160px]">{item.label}</span>
                        <span className="text-[9px] text-slate-500 font-mono">{item.count}x</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {mostUsed.macrosList.length > 0 && (
                <div className="space-y-1">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block border-b border-slate-850/50 pb-0.5">Most Used Macros</span>
                  <div className="space-y-1">
                    {mostUsed.macrosList.map((item, idx) => (
                      <div key={idx} className="flex justify-between items-center text-[10.5px] bg-slate-900/20 px-2 py-1 rounded">
                        <span className="text-slate-300 truncate max-w-[160px]">{item.label}</span>
                        <span className="text-[9px] text-slate-500 font-mono">{item.count}x</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Recent Usage Logs */}
            <div className="space-y-2">
              <span className="text-[10px] uppercase font-bold text-slate-400 block border-b border-slate-800 pb-1">Recently Used Items</span>
              <div className="flex flex-col gap-1.5 max-h-44 overflow-y-auto">
                {usageLogs.slice(0, 15).map((log) => (
                  <div key={log.id} className="flex justify-between items-center text-[10.5px] bg-slate-905 border border-slate-850/40 p-1.5 rounded">
                    <div className="flex gap-2 items-center">
                      <span className={`px-1 rounded text-[8px] font-bold ${
                        log.itemType === "macro" ? "bg-emerald-950 text-emerald-400" :
                        log.itemType === "template" ? "bg-blue-950 text-blue-400" : "bg-purple-950 text-purple-400"
                      }`}>
                        {log.itemType.toUpperCase()}
                      </span>
                      <span className="truncate text-slate-300 max-w-[120px]">{log.itemLabel}</span>
                    </div>
                    <span className="text-[9px] text-slate-500">{new Date(log.usedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                ))}
                {usageLogs.length === 0 && (
                  <p className="text-[10px] text-slate-500 text-center py-4">No reporting item logs yet.</p>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Add Macro Dialog */}
      <Dialog open={isAddMacroOpen} onOpenChange={() => setIsAddMacroOpen(false)}>
        <DialogContent className="max-w-sm bg-slate-950 border border-slate-800 text-slate-200">
          <DialogHeader>
            <DialogTitle className="text-sm">Add Personal Macro</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-xs">
            <div>
              <label className="text-[10px] text-slate-500 block mb-0.5">Macro Shortcut Name (alphanumeric)</label>
              <Input
                value={macroName}
                onChange={(e) => setMacroName(e.target.value.replace(/[^a-zA-Z0-9_]/g, "").toUpperCase())}
                placeholder="e.g. AGE_CHANGES"
                className="h-8 bg-slate-900 border-slate-800 text-slate-200 font-mono"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 block mb-0.5">Insert Text Content</label>
              <textarea
                value={macroContent}
                onChange={(e) => setMacroContent(e.target.value)}
                rows={4}
                placeholder="Paragraph text to expand..."
                className="w-full rounded border bg-slate-900 border-slate-800 text-slate-200 p-2 focus:outline-none"
              />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button size="sm" variant="outline" onClick={() => setIsAddMacroOpen(false)}>Cancel</Button>
              <Button size="sm" onClick={handleAddMacro} disabled={!macroName || !macroContent} className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold">
                Add Macro
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Favorite Impression Dialog */}
      <Dialog open={isAddImpressionOpen} onOpenChange={() => setIsAddImpressionOpen(false)}>
        <DialogContent className="max-w-sm bg-slate-950 border border-slate-800 text-slate-200">
          <DialogHeader>
            <DialogTitle className="text-sm">Save Pinned Impression Shortcut</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-xs">
            <div>
              <label className="text-[10px] text-slate-500 block mb-0.5">Impression Text</label>
              <textarea
                value={newImpressionText}
                onChange={(e) => setNewImpressionText(e.target.value)}
                rows={3}
                placeholder="e.g. Mild chronic small vessel ischemic disease."
                className="w-full rounded border bg-slate-900 border-slate-800 text-slate-200 p-2 focus:outline-none"
              />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button size="sm" variant="outline" onClick={() => setIsAddImpressionOpen(false)}>Cancel</Button>
              <Button size="sm" onClick={handleAddImpression} disabled={!newImpressionText.trim()} className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold">
                Save Impression
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Favorite Template Dialog */}
      <Dialog open={isAddTemplateOpen} onOpenChange={() => setIsAddTemplateOpen(false)}>
        <DialogContent className="max-w-sm bg-slate-950 border border-slate-800 text-slate-200">
          <DialogHeader>
            <DialogTitle className="text-sm">Pin Favorite Template</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-xs">
            <div>
              <label className="text-[10px] text-slate-500 block mb-0.5">Template Name</label>
              <Input
                value={newTemplateName}
                onChange={(e) => setNewTemplateName(e.target.value)}
                placeholder="e.g. MRI Brain Normal"
                className="h-8 bg-slate-900 border-slate-800 text-slate-200"
              />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button size="sm" variant="outline" onClick={() => setIsAddTemplateOpen(false)}>Cancel</Button>
              <Button size="sm" onClick={handleAddTemplate} disabled={!newTemplateName.trim()} className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold">
                Pin Template
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
