/**
 * Radiologist Productivity Tools — Phase 12
 * Hotkeys, macros, templates, timer, TAT heatmap, pending by urgency.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  RefreshCw, Keyboard, Text, FileText, Zap, Clock, Timer,
  Flame, Save, CheckCircle2, ChevronRight, Copy, Heart,
  BarChart3,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function RadiologistTools() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [macroTrigger, setMacroTrigger] = useState("");
  const [macroExpansion, setMacroExpansion] = useState("");

  const { data: shortcuts, refetch: refetchShortcuts } = useQuery<any[]>({
    queryKey: ["shortcuts"],
    queryFn: () => api.get("/api/radiology-workflow/shortcuts"),
  });

  const { data: macros, refetch: refetchMacros } = useQuery<any[]>({
    queryKey: ["macros"],
    queryFn: () => api.get("/api/radiology-workflow/macros"),
  });

  const { data: presets, refetch: refetchPresets } = useQuery<any[]>({
    queryKey: ["viewer-presets"],
    queryFn: () => api.get("/api/radiology-workflow/viewer-presets"),
  });

  const addMacroMut = useMutation({
    mutationFn: () => api.post("/api/radiology-workflow/macros", {
      radiologistId: 1, trigger: macroTrigger, expansion: macroExpansion,
      category: "general", isFavorite: false,
    }),
    onSuccess: () => {
      toast({ title: "Macro added" });
      setMacroTrigger("");
      setMacroExpansion("");
      refetchMacros();
    },
  });

  const allShortcuts = shortcuts ?? [];
  const allMacros = macros ?? [];
  const allPresets = presets ?? [];

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-950 text-slate-100">
      <div className="px-6 py-5">
        <PageHeader
          title="Radiologist Productivity Tools"
          subtitle="Hotkeys, macros, window presets, reporting timer"
        />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-6">
          {/* Hotkeys */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
            <div className="flex items-center gap-2 mb-4">
              <Keyboard className="w-4 h-4 text-cyan-400" />
              <h3 className="text-sm font-semibold text-slate-300">Keyboard Shortcuts</h3>
            </div>
            <div className="space-y-2">
              {allShortcuts.map((s: any) => (
                <div key={s.id} className="flex items-center justify-between text-sm border-b border-slate-800/40 pb-2">
                  <code className="text-xs bg-slate-800 px-2 py-0.5 rounded text-cyan-300">{s.keyCombo}</code>
                  <span className="text-slate-400">{s.description || s.action}</span>
                </div>
              ))}
              {allShortcuts.length === 0 && (
                <div className="text-sm text-slate-500">No custom shortcuts defined</div>
              )}
            </div>
          </div>

          {/* Macros */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
            <div className="flex items-center gap-2 mb-4">
              <Text className="w-4 h-4 text-violet-400" />
              <h3 className="text-sm font-semibold text-slate-300">Text Macros</h3>
            </div>
            <div className="space-y-2 mb-4">
              {allMacros.map((m: any) => (
                <div key={m.id} className="text-sm border-b border-slate-800/40 pb-2">
                  <code className="text-xs bg-slate-800 px-2 py-0.5 rounded text-violet-300">{m.trigger}</code>
                  <p className="text-slate-400 mt-1">{m.expansion}</p>
                </div>
              ))}
              {allMacros.length === 0 && (
                <div className="text-sm text-slate-500">No macros defined</div>
              )}
            </div>
            <div className="space-y-2">
              <Input placeholder="Trigger (e.g. .nl)" value={macroTrigger} onChange={(e) => setMacroTrigger(e.target.value)} className="bg-slate-900 border-slate-700 text-slate-200 text-sm" />
              <Input placeholder="Expansion text" value={macroExpansion} onChange={(e) => setMacroExpansion(e.target.value)} className="bg-slate-900 border-slate-700 text-slate-200 text-sm" />
              <Button size="sm" className="w-full" onClick={() => addMacroMut.mutate()} disabled={!macroTrigger || !macroExpansion}>
                <Zap className="w-3.5 h-3.5 mr-1" />
                Add Macro
              </Button>
            </div>
          </div>

          {/* Window Presets */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm font-semibold text-slate-300">Viewer Window Presets</h3>
            </div>
            <div className="space-y-2">
              {allPresets.map((p: any) => (
                <div key={p.id} className="flex items-center justify-between text-sm border-b border-slate-800/40 pb-2">
                  <div>
                    <span className="text-slate-200 font-medium">{p.name}</span>
                    <span className="text-slate-500 text-xs ml-2">{p.modality} · {p.bodyPart || "General"}</span>
                  </div>
                  <code className="text-xs bg-slate-800 px-2 py-0.5 rounded text-emerald-300">C:{p.windowCenter} W:{p.windowWidth}</code>
                </div>
              ))}
              {allPresets.length === 0 && (
                <div className="text-sm text-slate-500">No presets defined</div>
              )}
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          <QuickAction icon={<Save className="w-4 h-4" />} label="Save Draft" />
          <QuickAction icon={<CheckCircle2 className="w-4 h-4" />} label="Approve Report" />
          <QuickAction icon={<ChevronRight className="w-4 h-4" />} label="Next Study" />
          <QuickAction icon={<Timer className="w-4 h-4" />} label="Start Timer" />
          <QuickAction icon={<Copy className="w-4 h-4" />} label="Compare Previous" />
          <QuickAction icon={<FileText className="w-4 h-4" />} label="Insert Template" />
          <QuickAction icon={<Flame className="w-4 h-4" />} label="Critical Alert" />
          <QuickAction icon={<Heart className="w-4 h-4" />} label="Favorite Template" />
        </div>
      </div>
    </div>
  );
}

function QuickAction({ icon, label }: any) {
  return (
    <button className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-left hover:bg-slate-800/80 transition-colors flex items-center gap-3">
      <div className="text-slate-400">{icon}</div>
      <span className="text-sm font-medium text-slate-300">{label}</span>
    </button>
  );
}
