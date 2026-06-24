import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Star, ShieldAlert, Plus, Pin, Trash2, Edit2, Settings } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";

export interface ChocolateFinding {
  id: number;
  modality: string;
  bodyPart: string;
  groupName: string;
  shortName: string;
  findingText: string;
  impressionText?: string | null;
  isCritical: boolean;
  sortOrder: number;
}

interface UserPreferences {
  id: number;
  userId: number;
  favoriteFindingIds: string; // JSON array of numbers
  customFindingsJson: string; // JSON array of ChocolateFinding objects
}

interface ChocolateBoxPanelProps {
  modality: string;
  bodyPart: string;
  onSelectFinding: (finding: ChocolateFinding) => void;
  selectedFindingsList: ChocolateFinding[];
  userRole?: string;
  currentUserId?: number | null;
}

export default function ChocolateBoxPanel({
  modality,
  bodyPart,
  onSelectFinding,
  selectedFindingsList,
  userRole,
  currentUserId,
}: ChocolateBoxPanelProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [searchQuery, setSearchQuery] = useState("");
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [isAdminPanelOpen, setIsAdminPanelOpen] = useState(false);

  // Configuration States
  const [columns, setColumns] = useState<string>(() => localStorage.getItem("choc_box_cols") || "auto");
  const [tileLimit, setTileLimit] = useState<number>(() => Number(localStorage.getItem("choc_box_limit") || "0"));
  const [layoutWidth, setLayoutWidth] = useState<string>(() => localStorage.getItem("choc_box_width") || "standard");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Admin Form States
  const [editingFinding, setEditingFinding] = useState<Partial<ChocolateFinding> | null>(null);
  const [formModality, setFormModality] = useState(modality);
  const [formBodyPart, setFormBodyPart] = useState(bodyPart);
  const [formGroupName, setFormGroupName] = useState("");
  const [formShortName, setFormShortName] = useState("");
  const [formFindingText, setFormFindingText] = useState("");
  const [formImpressionText, setFormImpressionText] = useState("");
  const [formIsCritical, setFormIsCritical] = useState(false);
  const [formSortOrder, setFormSortOrder] = useState(0);

  // User Preferences Form States
  const [isCustomTileOpen, setIsCustomTileOpen] = useState(false);
  const [customShortName, setCustomShortName] = useState("");
  const [customFindingText, setCustomFindingText] = useState("");
  const [customImpressionText, setCustomImpressionText] = useState("");

  // Fetch Findings
  const { data: findings = [], refetch } = useQuery<ChocolateFinding[]>({
    queryKey: ["chocolate-findings", modality, bodyPart],
    queryFn: () =>
      api.get<ChocolateFinding[]>(
        `/api/radiology/chocolate-findings?modality=${encodeURIComponent(modality)}&bodyPart=${encodeURIComponent(bodyPart)}`
      ),
    enabled: !!modality && !!bodyPart,
  });

  // Fetch Preferences
  const { data: preferences } = useQuery<UserPreferences>({
    queryKey: ["user-findings-preferences"],
    queryFn: () => api.get<UserPreferences>("/api/radiology/user-findings-preferences"),
    enabled: !!currentUserId,
  });

  const favoritesList: number[] = React.useMemo(() => {
    if (!preferences?.favoriteFindingIds) return [];
    try {
      return JSON.parse(preferences.favoriteFindingIds);
    } catch {
      return [];
    }
  }, [preferences]);

  const customTiles: ChocolateFinding[] = React.useMemo(() => {
    if (!preferences?.customFindingsJson) return [];
    try {
      return JSON.parse(preferences.customFindingsJson);
    } catch {
      return [];
    }
  }, [preferences]);

  // Mutation to toggle Favorite Status
  const toggleFavoriteMutation = useMutation({
    mutationFn: async (findingId: number) => {
      const isFav = favoritesList.includes(findingId);
      const nextFavs = isFav
        ? favoritesList.filter((id) => id !== findingId)
        : [...favoritesList, findingId];

      return api.post("/api/radiology/user-findings-preferences", {
        favoriteFindingIds: JSON.stringify(nextFavs),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-findings-preferences"] });
    },
  });

  // Mutation to save Admin edits/adds
  const saveFindingMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        modality: formModality,
        bodyPart: formBodyPart,
        groupName: formGroupName || "General",
        shortName: formShortName,
        findingText: formFindingText,
        impressionText: formImpressionText || null,
        isCritical: formIsCritical,
        sortOrder: Number(formSortOrder),
      };

      if (editingFinding?.id) {
        return api.patch(`/api/radiology/chocolate-findings/${editingFinding.id}`, payload);
      } else {
        return api.post("/api/radiology/chocolate-findings", payload);
      }
    },
    onSuccess: () => {
      toast({ title: "Finding Config Saved" });
      setIsAdminPanelOpen(false);
      setEditingFinding(null);
      refetch();
    },
  });

  // Mutation to delete a finding
  const deleteFindingMutation = useMutation({
    mutationFn: async (id: number) => {
      return api.delete(`/api/radiology/chocolate-findings/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Finding Config Deleted" });
      refetch();
    },
  });

  // Mutation to add personal custom quick tile
  const addCustomTileMutation = useMutation({
    mutationFn: async () => {
      const newTile: ChocolateFinding = {
        id: Date.now(), // Local fake unique ID
        modality,
        bodyPart,
        groupName: "My Custom Quick Tiles",
        shortName: customShortName,
        findingText: customFindingText,
        impressionText: customImpressionText || null,
        isCritical: false,
        sortOrder: 100,
      };

      const nextCustom = [...customTiles, newTile];
      return api.post("/api/radiology/user-findings-preferences", {
        customFindingsJson: JSON.stringify(nextCustom),
      });
    },
    onSuccess: () => {
      toast({ title: "Custom Quick Tile Created" });
      setIsCustomTileOpen(false);
      setCustomShortName("");
      setCustomFindingText("");
      setCustomImpressionText("");
      qc.invalidateQueries({ queryKey: ["user-findings-preferences"] });
    },
  });

  // Mutation to delete personal custom quick tile
  const deleteCustomTileMutation = useMutation({
    mutationFn: async (id: number) => {
      const nextCustom = customTiles.filter((t) => t.id !== id);
      return api.post("/api/radiology/user-findings-preferences", {
        customFindingsJson: JSON.stringify(nextCustom),
      });
    },
    onSuccess: () => {
      toast({ title: "Custom Quick Tile Deleted" });
      qc.invalidateQueries({ queryKey: ["user-findings-preferences"] });
    },
  });

  // Load Admin edit form details
  const openEdit = (finding: ChocolateFinding) => {
    setEditingFinding(finding);
    setFormModality(finding.modality);
    setFormBodyPart(finding.bodyPart);
    setFormGroupName(finding.groupName);
    setFormShortName(finding.shortName);
    setFormFindingText(finding.findingText);
    setFormImpressionText(finding.impressionText || "");
    setFormIsCritical(finding.isCritical);
    setFormSortOrder(finding.sortOrder);
    setIsAdminPanelOpen(true);
  };

  const openAdd = () => {
    setEditingFinding(null);
    setFormModality(modality);
    setFormBodyPart(bodyPart);
    setFormGroupName("General");
    setFormShortName("");
    setFormFindingText("");
    setFormImpressionText("");
    setFormIsCritical(false);
    setFormSortOrder(0);
    setIsAdminPanelOpen(true);
  };

  const allVisibleFindings = React.useMemo(() => {
    const combined = [...findings, ...customTiles.filter((t) => t.modality === modality && t.bodyPart === bodyPart)];
    const filtered = combined.filter((f) => {
      if (pinnedOnly && !favoritesList.includes(f.id)) return false;
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        f.shortName.toLowerCase().includes(q) ||
        f.findingText.toLowerCase().includes(q) ||
        (f.groupName || "").toLowerCase().includes(q)
      );
    });

    // Sort favorites first
    return [...filtered].sort((a, b) => {
      const aFav = favoritesList.includes(a.id) ? 1 : 0;
      const bFav = favoritesList.includes(b.id) ? 1 : 0;
      if (aFav !== bFav) return bFav - aFav; // favorite (1) before non-favorite (0)
      return a.sortOrder - b.sortOrder;
    });
  }, [findings, customTiles, pinnedOnly, favoritesList, searchQuery, modality, bodyPart]);

  const limitedVisibleFindings = React.useMemo(() => {
    if (tileLimit > 0) return allVisibleFindings.slice(0, tileLimit);
    return allVisibleFindings;
  }, [allVisibleFindings, tileLimit]);

  const getGridClass = () => {
    if (columns === "3") return "grid-cols-3";
    if (columns === "4") return "grid-cols-4";
    if (columns === "5") return "grid-cols-5";
    if (columns === "6") return "grid-cols-6";
    return "grid-cols-[repeat(auto-fill,minmax(140px,1fr))]";
  };

  const isAdmin = userRole === "admin" || userRole === "super_admin";

  return (
    <div className={`space-y-4 ${layoutWidth === "wide" ? "w-full max-w-none" : ""}`}>
      {/* Top Filter and Search Bar */}
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <Input
            placeholder="Search tiles..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 bg-slate-900 border-slate-850 text-slate-200 text-xs"
          />
          <Button
            size="sm"
            variant={pinnedOnly ? "default" : "outline"}
            onClick={() => setPinnedOnly(!pinnedOnly)}
            className="h-8 text-xs border-slate-800"
          >
            <Pin size={12} className="mr-1" />
            Favorites
          </Button>
        </div>

        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsCustomTileOpen(true)}
            className="h-8 text-xs border-slate-800 bg-slate-900 text-slate-300"
          >
            <Plus size={12} className="mr-1" />
            Add Quick Tile
          </Button>

          {isAdmin && (
            <Button
              size="sm"
              variant="outline"
              onClick={openAdd}
              className="h-8 text-xs border-emerald-800 text-emerald-400 bg-emerald-950/20 hover:bg-emerald-950/40"
            >
              Config Tiles
            </Button>
          )}

          <Button
            size="sm"
            variant={isSettingsOpen ? "default" : "outline"}
            onClick={() => setIsSettingsOpen(!isSettingsOpen)}
            className="h-8 text-xs border-slate-850 bg-slate-900 text-slate-300"
          >
            <Settings size={12} className="mr-1" />
            Layout
          </Button>
        </div>
      </div>

      {/* Responsive layout preference selectors */}
      {isSettingsOpen && (
        <div className="bg-slate-900 border border-slate-850 rounded-xl p-3.5 grid grid-cols-3 gap-3 text-xs text-slate-300 transition-all">
          <div className="space-y-1">
            <span className="text-[10px] text-slate-500 font-bold uppercase">Grid Columns</span>
            <select
              value={columns}
              onChange={(e) => {
                setColumns(e.target.value);
                localStorage.setItem("choc_box_cols", e.target.value);
              }}
              className="w-full text-xs h-8 rounded border border-slate-800 bg-slate-950 text-slate-200 focus:outline-none"
            >
              <option value="auto">Auto (Responsive)</option>
              <option value="3">3 Columns</option>
              <option value="4">4 Columns</option>
              <option value="5">5 Columns</option>
              <option value="6">6 Columns</option>
            </select>
          </div>

          <div className="space-y-1">
            <span className="text-[10px] text-slate-500 font-bold uppercase">Max Tiles</span>
            <select
              value={tileLimit}
              onChange={(e) => {
                const val = Number(e.target.value);
                setTileLimit(val);
                localStorage.setItem("choc_box_limit", String(val));
              }}
              className="w-full text-xs h-8 rounded border border-slate-800 bg-slate-950 text-slate-200 focus:outline-none"
            >
              <option value="0">All Tiles</option>
              <option value="12">12 Tiles</option>
              <option value="24">24 Tiles</option>
              <option value="36">36 Tiles</option>
              <option value="48">48 Tiles</option>
            </select>
          </div>

          <div className="space-y-1">
            <span className="text-[10px] text-slate-500 font-bold uppercase">Wide Sizing</span>
            <select
              value={layoutWidth}
              onChange={(e) => {
                setLayoutWidth(e.target.value);
                localStorage.setItem("choc_box_width", e.target.value);
              }}
              className="w-full text-xs h-8 rounded border border-slate-800 bg-slate-950 text-slate-200 focus:outline-none"
            >
              <option value="standard">Standard width</option>
              <option value="wide">Wide (Stretch)</option>
            </select>
          </div>
        </div>
      )}

      {/* Grid of Clickable Findings (Chocolate Box) */}
      <div className={`grid ${getGridClass()} gap-3`}>
        {limitedVisibleFindings.map((finding) => {
          const isSelected = selectedFindingsList.some((s) => s.id === finding.id);
          const isFavorite = favoritesList.includes(finding.id);

          return (
            <div
              key={finding.id}
              className={`relative rounded-xl border p-3 cursor-pointer select-none transition-all flex flex-col justify-between h-24 ${
                isSelected
                  ? "bg-emerald-950/40 border-emerald-500 text-emerald-400 shadow-md shadow-emerald-950/50"
                  : "bg-slate-900/60 border-slate-800 text-slate-300 hover:bg-slate-800/60"
              }`}
              onClick={() => onSelectFinding(finding)}
            >
              <div className="flex justify-between items-start gap-1">
                <span className="font-bold text-xs line-clamp-2 leading-tight">
                  {finding.shortName}
                </span>

                {/* Favorite Toggle Button */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFavoriteMutation.mutate(finding.id);
                  }}
                  className={`p-0.5 transition-colors ${
                    isFavorite ? "text-yellow-500" : "text-slate-600 hover:text-yellow-500"
                  }`}
                >
                  <Star size={11} fill={isFavorite ? "currentColor" : "none"} />
                </button>
              </div>

              {/* Group Name badge / Critical Indicator */}
              <div className="flex justify-between items-center mt-2">
                <span className="text-[9px] text-slate-500 font-mono tracking-wide uppercase truncate max-w-[80px]">
                  {finding.groupName}
                </span>
                <div className="flex gap-1.5 items-center">
                  {finding.isCritical && (
                    <ShieldAlert size={11} className="text-red-500" />
                  )}
                  {/* Admin Edit actions on tile */}
                  {isAdmin && finding.groupName !== "My Custom Quick Tiles" && (
                    <div className="flex gap-1 opacity-0 hover:opacity-100 absolute bottom-2 right-2 bg-slate-900 border border-slate-800 rounded p-0.5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openEdit(finding);
                        }}
                        className="p-0.5 text-slate-400 hover:text-emerald-400"
                      >
                        <Edit2 size={10} />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm("Delete this config tile?")) {
                            deleteFindingMutation.mutate(finding.id);
                          }
                        }}
                        className="p-0.5 text-slate-400 hover:text-red-500"
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  )}
                  {finding.groupName === "My Custom Quick Tiles" && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm("Delete this custom quick tile?")) {
                          deleteCustomTileMutation.mutate(finding.id);
                        }
                      }}
                      className="p-0.5 text-slate-500 hover:text-red-400"
                    >
                      <Trash2 size={10} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {allVisibleFindings.length === 0 && (
          <div className="col-span-full py-8 text-center text-xs text-slate-500">
            No findings tiles configured for {modality} - {bodyPart}.
          </div>
        )}
      </div>

      {/* Admin Finding Tile Config Dialog */}
      <Dialog open={isAdminPanelOpen} onOpenChange={() => setIsAdminPanelOpen(false)}>
        <DialogContent className="max-w-md bg-slate-950 border border-slate-800 text-slate-200">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {editingFinding ? "Edit Findings Tile Configuration" : "Add Findings Tile Configuration"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-slate-500 block mb-0.5">Modality</label>
                <Input
                  value={formModality}
                  onChange={(e) => setFormModality(e.target.value)}
                  className="h-8 bg-slate-900 border-slate-800 text-slate-200"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 block mb-0.5">Body Part</label>
                <Input
                  value={formBodyPart}
                  onChange={(e) => setFormBodyPart(e.target.value)}
                  className="h-8 bg-slate-900 border-slate-800 text-slate-200"
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] text-slate-500 block mb-0.5">Group Name</label>
              <Input
                value={formGroupName}
                onChange={(e) => setFormGroupName(e.target.value)}
                placeholder="e.g. Ischemia, Vascular"
                className="h-8 bg-slate-900 border-slate-800 text-slate-200"
              />
            </div>

            <div>
              <label className="text-[10px] text-slate-500 block mb-0.5">Short Display Name (Tile Text)</label>
              <Input
                value={formShortName}
                onChange={(e) => setFormShortName(e.target.value)}
                placeholder="e.g. Age Related Changes"
                className="h-8 bg-slate-900 border-slate-800 text-slate-200"
              />
            </div>

            <div>
              <label className="text-[10px] text-slate-500 block mb-0.5">Detailed Findings Text</label>
              <textarea
                value={formFindingText}
                onChange={(e) => setFormFindingText(e.target.value)}
                rows={3}
                placeholder="Enter complete observation paragraph..."
                className="w-full rounded border bg-slate-900 border-slate-800 text-slate-200 p-2 focus:outline-none"
              />
            </div>

            <div>
              <label className="text-[10px] text-slate-500 block mb-0.5">Linked Impression Text (Optional)</label>
              <Input
                value={formImpressionText}
                onChange={(e) => setFormImpressionText(e.target.value)}
                placeholder="e.g. Age-related cerebral atrophy."
                className="h-8 bg-slate-900 border-slate-800 text-slate-200"
              />
            </div>

            <div className="flex gap-4 items-center">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formIsCritical}
                  onChange={(e) => setFormIsCritical(e.target.checked)}
                  className="rounded border-slate-850 bg-slate-900 text-emerald-600 h-3.5 w-3.5 focus:ring-0 focus:ring-offset-0"
                />
                <span>Is Critical Finding</span>
              </label>

              <div className="flex items-center gap-2">
                <span>Sort Order</span>
                <Input
                  type="number"
                  value={formSortOrder}
                  onChange={(e) => setFormSortOrder(Number(e.target.value))}
                  className="h-8 w-16 bg-slate-900 border-slate-800 text-slate-200"
                />
              </div>
            </div>

            <div className="flex gap-2 justify-end pt-3">
              <Button size="sm" variant="outline" onClick={() => setIsAdminPanelOpen(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => saveFindingMutation.mutate()}
                disabled={saveFindingMutation.isPending}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
              >
                Save Configuration
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* User Custom Quick Tile Dialog */}
      <Dialog open={isCustomTileOpen} onOpenChange={() => setIsCustomTileOpen(false)}>
        <DialogContent className="max-w-md bg-slate-950 border border-slate-800 text-slate-200">
          <DialogHeader>
            <DialogTitle className="text-sm">Create Personal Quick Findings Tile</DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              This tile will only be visible to you and won't affect other radiologists' settings.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-xs">
            <div>
              <label className="text-[10px] text-slate-500 block mb-0.5">Short Display Name (Tile Text)</label>
              <Input
                value={customShortName}
                onChange={(e) => setCustomShortName(e.target.value)}
                placeholder="e.g. My Custom Finding"
                className="h-8 bg-slate-900 border-slate-800 text-slate-200"
              />
            </div>

            <div>
              <label className="text-[10px] text-slate-500 block mb-0.5">Detailed Findings Text</label>
              <textarea
                value={customFindingText}
                onChange={(e) => setCustomFindingText(e.target.value)}
                rows={3}
                placeholder="Enter complete observation paragraph..."
                className="w-full rounded border bg-slate-900 border-slate-800 text-slate-200 p-2 focus:outline-none"
              />
            </div>

            <div>
              <label className="text-[10px] text-slate-500 block mb-0.5">Linked Impression Text (Optional)</label>
              <Input
                value={customImpressionText}
                onChange={(e) => setCustomImpressionText(e.target.value)}
                placeholder="Linked impression..."
                className="h-8 bg-slate-900 border-slate-800 text-slate-200"
              />
            </div>

            <div className="flex gap-2 justify-end pt-3">
              <Button size="sm" variant="outline" onClick={() => setIsCustomTileOpen(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => addCustomTileMutation.mutate()}
                disabled={addCustomTileMutation.isPending}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
              >
                Create Tile
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
