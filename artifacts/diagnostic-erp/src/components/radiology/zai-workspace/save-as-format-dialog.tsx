import { useEffect, useState } from "react";
import { useWorkspaceSelector } from "@/lib/zai-workspace/store";
import { MODALITIES } from "@/lib/zai-workspace/quick-select-library";
import { clinicalSavePayload } from "@/lib/zai-workspace/fullReportFormat";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Save } from "lucide-react";
const MODS = ["MR","CT","XR","US","MG","DX","NM","PT","DOPPLER","ECHO","USG_OB"];
export function SaveAsFormatDialog() {
  const open = useWorkspaceSelector((s) => s.saveAsFormatDialogOpen);
  const close = useWorkspaceSelector((s) => s.closeSaveAsFormatDialog);
  const save = useWorkspaceSelector((s) => s.saveAsFormat);
  const study = useWorkspaceSelector((s) => s.studies.find((x) => x.id === s.activeStudyId));
  const reportingContext = useWorkspaceSelector((s) => s.reportingContext);
  const appliedTitle = useWorkspaceSelector((s) => s.appliedFormatReportTitle);
  const ft = useWorkspaceSelector((s) => s.findingsText);
  const it = useWorkspaceSelector((s) => s.impressionText);
  const rt = useWorkspaceSelector((s) => s.recommendationText);
  const tt = useWorkspaceSelector((s) => s.techniqueText);
  const ht = useWorkspaceSelector((s) => s.clinicalHistoryText);
  const defaultBp = reportingContext.region || study?.bodyPart || "Brain";
  const [name, setName] = useState("");
  const [reportTitle, setReportTitle] = useState("");
  const [protocolScope, setProtocolScope] = useState("");
  const [mod, setMod] = useState(study?.modality ?? "MR");
  const [bp, setBp] = useState(defaultBp);
  const [tags, setTags] = useState("");
  useEffect(() => {
    if (!open) return;
    setMod(study?.modality ?? "MR");
    setBp(reportingContext.region || study?.bodyPart || "Brain");
    setReportTitle(appliedTitle || study?.studyDescription || "");
    setProtocolScope(reportingContext.protocolName || "");
  }, [open, study?.modality, study?.bodyPart, study?.studyDescription, reportingContext.region, reportingContext.protocolName, appliedTitle]);
  if (!open) return null;
  const bps = MODALITIES[mod] ?? [];
  const has = ft.trim() || it.trim() || ht.trim() || tt.trim() || rt.trim();
  const handleSave = () => {
    if (!name.trim() || !has) return;
    save(clinicalSavePayload({
      name: name.trim(),
      modality: mod,
      bodyPart: bp,
      diagnosisTags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      clinicalHistory: ht,
      technique: tt,
      findings: ft,
      impression: it,
      recommendation: rt,
      reportTitle,
      protocolScope,
      isCommon: false,
      custom: true,
    }));
    setName("");
    setTags("");
    setReportTitle("");
    setProtocolScope("");
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Save className="h-4 w-4 text-emerald-600" /> Save as full report format</DialogTitle>
          <DialogDescription>
            Saves Clinical History, Technique, Findings, Impression, Recommendation, printed heading and optional protocol scope.
            Patient demographics, header and images are never stored — CARE fills those from the current study.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {!has && <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-700">No clinical section content. Add some first.</div>}
          <div>
            <Label htmlFor="rf-name" className="text-[11px] uppercase tracking-wider">Library name</Label>
            <Input id="rf-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. MRI Brain — Fazekas 1 + Senile Changes" className="h-8 text-sm" autoFocus data-testid="save-format-name" />
          </div>
          <div>
            <Label htmlFor="rf-title" className="text-[11px] uppercase tracking-wider">Printed test heading</Label>
            <Input id="rf-title" value={reportTitle} onChange={(e) => setReportTitle(e.target.value)} placeholder="e.g. MRI BRAIN PLAIN" className="h-8 text-sm" data-testid="save-format-report-title" />
            <p className="text-[10px] text-muted-foreground mt-0.5">Shown below demography. Leave blank to keep the current study title fallback.</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="rf-mod" className="text-[11px] uppercase tracking-wider">Modality</Label>
              <select id="rf-mod" value={mod} onChange={(e) => setMod(e.target.value as typeof mod)} className="mt-0.5 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm h-8">
                {MODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="rf-bp" className="text-[11px] uppercase tracking-wider">Study / body region</Label>
              <select id="rf-bp" value={bp} onChange={(e) => setBp(e.target.value)} className="mt-0.5 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm h-8">
                {bps.map((b) => <option key={b} value={b}>{b}</option>)}
                {!bps.includes(bp) && <option value={bp}>{bp}</option>}
              </select>
            </div>
          </div>
          <div>
            <Label htmlFor="rf-protocol" className="text-[11px] uppercase tracking-wider">Protocol / sub-technique (optional)</Label>
            <Input id="rf-protocol" value={protocolScope} onChange={(e) => setProtocolScope(e.target.value)} placeholder="e.g. Screening, Plain, Contrast, Stroke" className="h-8 text-sm" data-testid="save-format-protocol-scope" />
          </div>
          <div>
            <Label htmlFor="rf-tags" className="text-[11px] uppercase tracking-wider">Diagnosis tags (comma-separated)</Label>
            <Input id="rf-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="white matter disease, fazekas 1" className="h-8 text-sm" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={close}>Cancel</Button>
          <Button onClick={handleSave} disabled={!name.trim() || !has} className="bg-emerald-600 hover:bg-emerald-700" data-testid="save-full-format-confirm">
            <Plus className="h-3.5 w-3.5 mr-1" /> Save full format
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
