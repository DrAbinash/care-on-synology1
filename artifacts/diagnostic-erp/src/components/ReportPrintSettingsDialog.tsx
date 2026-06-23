import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  loadPrintSettings, savePrintSettings, DEFAULT_PRINT_SETTINGS,
  type PrintSettings,
} from "@/lib/reportPdfGenerator";
import { Settings2, RotateCcw, Eye, EyeOff, MoveUp, MoveDown, GripVertical } from "lucide-react";

export function useReportPrintSettings() {
  const [settings, setSettings] = useState<PrintSettings>(loadPrintSettings);
  const [open, setOpen] = useState(false);
  return { settings, setSettings, open, setOpen };
}

interface ReportPrintSettingsDialogProps {
  open: boolean;
  onClose: () => void;
  settings: PrintSettings;
  onChange: (s: PrintSettings) => void;
}

export default function ReportPrintSettingsDialog({
  open, onClose, settings, onChange,
}: ReportPrintSettingsDialogProps) {
  const s = settings;
  const update = (patch: Partial<PrintSettings>) => onChange({ ...s, ...patch });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="h-4 w-4" /> Report Print Settings
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-5 text-sm">
          {/* Paper */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Paper Size</Label>
              <Select value={s.paperSize} onValueChange={(v) => update({ paperSize: v as PrintSettings["paperSize"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="A4">A4</SelectItem>
                  <SelectItem value="A5">A5</SelectItem>
                  <SelectItem value="Letter">Letter</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Orientation</Label>
              <Select value={s.orientation} onValueChange={(v) => update({ orientation: v as PrintSettings["orientation"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="portrait">Portrait</SelectItem>
                  <SelectItem value="landscape">Landscape</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Font */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Font Size</Label>
              <Select value={s.fontSize} onValueChange={(v) => update({ fontSize: v as PrintSettings["fontSize"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="small">Small (9 pt)</SelectItem>
                  <SelectItem value="medium">Medium (10 pt)</SelectItem>
                  <SelectItem value="large">Large (11 pt)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Font Family</Label>
              <Select value={s.fontFamily} onValueChange={(v) => update({ fontFamily: v as PrintSettings["fontFamily"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="helvetica">Helvetica</SelectItem>
                  <SelectItem value="times">Times</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Margins */}
          <div className="space-y-2">
            <Label>Margins (mm)</Label>
            <div className="grid grid-cols-4 gap-2">
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Top</Label>
                <Input type="number" value={s.margins.top} onChange={(e) => update({ margins: { ...s.margins, top: Number(e.target.value) } })} />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Bottom</Label>
                <Input type="number" value={s.margins.bottom} onChange={(e) => update({ margins: { ...s.margins, bottom: Number(e.target.value) } })} />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Left</Label>
                <Input type="number" value={s.margins.left} onChange={(e) => update({ margins: { ...s.margins, left: Number(e.target.value) } })} />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Right</Label>
                <Input type="number" value={s.margins.right} onChange={(e) => update({ margins: { ...s.margins, right: Number(e.target.value) } })} />
              </div>
            </div>
          </div>

          {/* Header */}
          <div className="space-y-2 border rounded p-2">
            <div className="flex items-center justify-between">
              <Label>Header</Label>
              <Switch checked={s.header.enabled} onCheckedChange={(v) => update({ header: { ...s.header, enabled: v } })} />
            </div>
            {s.header.enabled && (
              <div className="space-y-2">
                <Input placeholder="Header title" value={s.header.title} onChange={(e) => update({ header: { ...s.header, title: e.target.value } })} />
                <div className="flex gap-2">
                  <Switch checked={s.header.showDate} onCheckedChange={(v) => update({ header: { ...s.header, showDate: v } })} />
                  <Label className="text-[10px] text-muted-foreground">Show Date</Label>
                  <Switch checked={s.header.showAccession} onCheckedChange={(v) => update({ header: { ...s.header, showAccession: v } })} />
                  <Label className="text-[10px] text-muted-foreground">Show Accession</Label>
                </div>
              </div>
            )}
          </div>

          {/* Footer / Disclaimer */}
          <div className="space-y-2 border rounded p-2">
            <div className="flex items-center justify-between">
              <Label>Footer / Disclaimer</Label>
              <Switch checked={s.footer.enabled} onCheckedChange={(v) => update({ footer: { ...s.footer, enabled: v } })} />
            </div>
            {s.footer.enabled && (
              <div className="space-y-2">
                <Textarea rows={3} value={s.footer.disclaimer} onChange={(e) => update({ footer: { ...s.footer, disclaimer: e.target.value } })} />
                <div className="flex gap-2 items-center">
                  <Switch checked={s.footer.showPageNumber} onCheckedChange={(v) => update({ footer: { ...s.footer, showPageNumber: v } })} />
                  <Label className="text-[10px] text-muted-foreground">Show Page Number</Label>
                </div>
              </div>
            )}
          </div>

          {/* Layout & Section Order */}
          <div className="space-y-2 border rounded p-2">
            <Label>Layout & Section Order</Label>
            <p className="text-[10px] text-muted-foreground">Drag up/down to reorder sections. Click the eye icon to show/hide sections.</p>
            <div className="space-y-1">
              {s.layout.map((section, idx) => {
                const label = section.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
                const visible = s.show[section];
                return (
                  <div key={section} className="flex items-center gap-1 bg-muted/40 rounded px-2 py-1">
                    <GripVertical className="h-3 w-3 text-muted-foreground" />
                    <span className="flex-1 text-xs">{label}</span>
                    <button
                      className="p-1 rounded hover:bg-muted"
                      onClick={() => {
                        const newLayout = [...s.layout];
                        if (idx > 0) {
                          [newLayout[idx], newLayout[idx - 1]] = [newLayout[idx - 1], newLayout[idx]];
                          update({ layout: newLayout });
                        }
                      }}
                      title="Move up"
                    >
                      <MoveUp className="h-3 w-3" />
                    </button>
                    <button
                      className="p-1 rounded hover:bg-muted"
                      onClick={() => {
                        const newLayout = [...s.layout];
                        if (idx < newLayout.length - 1) {
                          [newLayout[idx], newLayout[idx + 1]] = [newLayout[idx + 1], newLayout[idx]];
                          update({ layout: newLayout });
                        }
                      }}
                      title="Move down"
                    >
                      <MoveDown className="h-3 w-3" />
                    </button>
                    <button
                      className="p-1 rounded hover:bg-muted"
                      onClick={() => update({ show: { ...s.show, [section]: !visible } })}
                      title={visible ? "Hide section" : "Show section"}
                    >
                      {visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3 text-muted-foreground" />}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Watermark */}
          <div className="space-y-2">
            <Label>Watermark</Label>
            <Input placeholder="e.g. DRAFT / CONFIDENTIAL" value={s.watermark} onChange={(e) => update({ watermark: e.target.value })} />
            <div className="flex gap-2 items-center">
              <Label className="text-[10px] text-muted-foreground">Opacity: {Math.round(s.watermarkOpacity * 100)}%</Label>
              <input type="range" min={0} max={50} step={1} value={s.watermarkOpacity * 100} onChange={(e) => update({ watermarkOpacity: Number(e.target.value) / 100 })} className="flex-1" />
            </div>
          </div>

          {/* Signature */}
          <div className="space-y-2 border rounded p-2">
            <div className="flex items-center justify-between">
              <Label>Digital Signature</Label>
              <Switch checked={s.signature.enabled} onCheckedChange={(v) => update({ signature: { ...s.signature, enabled: v } })} />
            </div>
            {s.signature.enabled && (
              <div className="space-y-2">
                <Input placeholder="Doctor Name" value={s.signature.name} onChange={(e) => update({ signature: { ...s.signature, name: e.target.value } })} />
                <Input placeholder="Qualifications (e.g. MBBS, MD(Radiology))" value={s.signature.qualification} onChange={(e) => update({ signature: { ...s.signature, qualification: e.target.value } })} />
                <Input placeholder="Registration Number" value={s.signature.registrationNo} onChange={(e) => update({ signature: { ...s.signature, registrationNo: e.target.value } })} />
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Signature Image</Label>
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = () => update({ signature: { ...s.signature, imageDataUrl: String(reader.result) } });
                      reader.readAsDataURL(file);
                    }}
                    className="block w-full text-xs"
                  />
                  {s.signature.imageDataUrl && (
                    <img src={s.signature.imageDataUrl} alt="Signature preview" className="h-12 object-contain border rounded" />
                  )}
                </div>
                <div className="flex gap-2 items-center">
                  <Switch checked={s.signature.showQualification} onCheckedChange={(v) => update({ signature: { ...s.signature, showQualification: v } })} />
                  <Label className="text-[10px] text-muted-foreground">Show Qualification</Label>
                  <Switch checked={s.signature.showRegistrationNo} onCheckedChange={(v) => update({ signature: { ...s.signature, showRegistrationNo: v } })} />
                  <Label className="text-[10px] text-muted-foreground">Show Reg. No</Label>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => onChange(DEFAULT_PRINT_SETTINGS)}>
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Reset
          </Button>
          <Button size="sm" onClick={() => { savePrintSettings(s); onClose(); }}>Save & Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
