import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Palette, CheckCircle, Save, RotateCcw } from "lucide-react";

export type StyleSetting = {
  id: number;
  presetName: string;
  sectionOrder: string;
  showClinicalHistory: boolean;
  showComparison: boolean;
  showRecommendation: boolean;
  showCriticalCommunication: boolean;
  showMeasurements: boolean;
  headingStyle: string;
  abnormalEmphasis: string;
  spacing: string;
  printLayout: string;
  margins: string;
  fontSize: string;
  showRadiologistName: boolean;
  showDegree: boolean;
  showRegNumber: boolean;
  showDigitalSignature: boolean;
  showTimestamp: boolean;
  showQrVerification: boolean;
};

const PRESETS: Record<string, Partial<StyleSetting>> = {
  "Care Diagnostics Default": {
    presetName: "Care Diagnostics Default",
    sectionOrder: "Technique,Findings,Impression",
    showClinicalHistory: true,
    showComparison: true,
    showRecommendation: true,
    showCriticalCommunication: true,
    showMeasurements: true,
    headingStyle: "underlined",
    abnormalEmphasis: "bold_abnormal",
    spacing: "standard",
    printLayout: "letterhead",
    margins: "standard",
    fontSize: "standard",
    showRadiologistName: true,
    showDegree: true,
    showRegNumber: true,
    showDigitalSignature: true,
    showTimestamp: true,
    showQrVerification: true,
  },
  "Compact Radiology": {
    presetName: "Compact Radiology",
    sectionOrder: "Technique,Findings,Impression",
    showClinicalHistory: false,
    showComparison: false,
    showRecommendation: true,
    showCriticalCommunication: true,
    showMeasurements: false,
    headingStyle: "bold",
    abnormalEmphasis: "bold_both",
    spacing: "compact",
    printLayout: "half_page",
    margins: "narrow",
    fontSize: "small",
    showRadiologistName: true,
    showDegree: true,
    showRegNumber: false,
    showDigitalSignature: true,
    showTimestamp: false,
    showQrVerification: false,
  },
  "Formal Letterpad": {
    presetName: "Formal Letterpad",
    sectionOrder: "Technique,Findings,Impression",
    showClinicalHistory: true,
    showComparison: true,
    showRecommendation: true,
    showCriticalCommunication: true,
    showMeasurements: true,
    headingStyle: "bold_underlined",
    abnormalEmphasis: "bold_impression",
    spacing: "comfortable",
    printLayout: "letterhead",
    margins: "standard",
    fontSize: "standard",
    showRadiologistName: true,
    showDegree: true,
    showRegNumber: true,
    showDigitalSignature: true,
    showTimestamp: true,
    showQrVerification: true,
  },
  "Plain A4": {
    presetName: "Plain A4",
    sectionOrder: "Technique,Findings,Impression",
    showClinicalHistory: true,
    showComparison: true,
    showRecommendation: true,
    showCriticalCommunication: true,
    showMeasurements: true,
    headingStyle: "plain",
    abnormalEmphasis: "none",
    spacing: "standard",
    printLayout: "a4_plain",
    margins: "standard",
    fontSize: "standard",
    showRadiologistName: true,
    showDegree: true,
    showRegNumber: true,
    showDigitalSignature: true,
    showTimestamp: true,
    showQrVerification: true,
  }
};

export function RadiologyStylePanel() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: styleSetting, isLoading } = useQuery<StyleSetting>({
    queryKey: ["institutional-style"],
    queryFn: () => api.get("/api/radiology/institutional-style"),
  });

  const [formState, setFormState] = useState<Partial<StyleSetting>>({});

  useEffect(() => {
    if (styleSetting) {
      setFormState(styleSetting);
    }
  }, [styleSetting]);

  const updateMutation = useMutation({
    mutationFn: (values: Partial<StyleSetting>) =>
      api.put("/api/radiology/institutional-style", values),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["institutional-style"] });
      toast({ title: "Institutional Report Style Saved Successfully", description: "All new report previews and exports will adopt this layout." });
    },
    onError: (err: any) => {
      toast({ variant: "destructive", title: "Failed to Update Settings", description: err.message });
    }
  });

  const handleApplyPreset = (presetKey: string) => {
    const preset = PRESETS[presetKey];
    if (preset) {
      setFormState(prev => ({
        ...prev,
        ...preset,
        presetName: presetKey
      }));
      toast({ title: `Preset Applied: ${presetKey}`, description: "Click Save Changes to apply hospital-wide." });
    }
  };

  const handleFieldChange = (field: keyof StyleSetting, value: any) => {
    setFormState(prev => ({
      ...prev,
      [field]: value
    }));
  };

  if (isLoading) {
    return <div className="text-center py-6 text-slate-500">Loading style configurations...</div>;
  }

  return (
    <div className="space-y-6">
      <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
        <CardHeader className="border-b border-slate-100 dark:border-slate-900 pb-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Palette className="h-5 w-5 text-indigo-500" /> Institutional Style Customizer
              </CardTitle>
              <CardDescription>
                Configure the typography, layout order, abnormal findings emphasis, and print margins.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Select
                value={formState.presetName || ""}
                onValueChange={handleApplyPreset}
              >
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Load Quick Preset" />
                </SelectTrigger>
                <SelectContent>
                  {Object.keys(PRESETS).map(key => (
                    <SelectItem key={key} value={key}>{key}</SelectItem>
                  ))}
                  <SelectItem value="Custom" disabled>Custom / Modifications</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6 space-y-6 text-sm">
          {/* Section 1: Ordering & Inclusion */}
          <div className="space-y-4">
            <h4 className="font-bold text-slate-800 dark:text-slate-200">1. Report Section Order & Inclusion</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="section-order">Section Order (Comma separated)</Label>
                <Input
                  id="section-order"
                  value={formState.sectionOrder || ""}
                  onChange={(e) => handleFieldChange("sectionOrder", e.target.value)}
                  placeholder="Technique,Findings,Impression"
                />
                <span className="text-[11px] text-muted-foreground">Order of primary parts in final print view.</span>
              </div>
              <div className="grid grid-cols-2 gap-3 pt-2">
                <div className="flex items-center space-x-2">
                  <Switch
                    id="show-clinical-history"
                    checked={!!formState.showClinicalHistory}
                    onCheckedChange={(v) => handleFieldChange("showClinicalHistory", v)}
                  />
                  <Label htmlFor="show-clinical-history" className="text-xs">Clinical History</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Switch
                    id="show-comparison"
                    checked={!!formState.showComparison}
                    onCheckedChange={(v) => handleFieldChange("showComparison", v)}
                  />
                  <Label htmlFor="show-comparison" className="text-xs">Comparison</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Switch
                    id="show-recommendation"
                    checked={!!formState.showRecommendation}
                    onCheckedChange={(v) => handleFieldChange("showRecommendation", v)}
                  />
                  <Label htmlFor="show-recommendation" className="text-xs">Recommendation</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Switch
                    id="show-critical-communication"
                    checked={!!formState.showCriticalCommunication}
                    onCheckedChange={(v) => handleFieldChange("showCriticalCommunication", v)}
                  />
                  <Label htmlFor="show-critical-communication" className="text-xs">Critical Alerts</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Switch
                    id="show-measurements"
                    checked={!!formState.showMeasurements}
                    onCheckedChange={(v) => handleFieldChange("showMeasurements", v)}
                  />
                  <Label htmlFor="show-measurements" className="text-xs">Measurements</Label>
                </div>
              </div>
            </div>
          </div>

          <hr className="border-slate-100 dark:border-slate-900" />

          {/* Section 2: Heading Styles & Formatting */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-2">
              <Label htmlFor="heading-style">Heading Style</Label>
              <Select
                value={formState.headingStyle || "plain"}
                onValueChange={(v) => handleFieldChange("headingStyle", v)}
              >
                <SelectTrigger id="heading-style">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="plain">Plain Text</SelectItem>
                  <SelectItem value="bold">Bold Headings</SelectItem>
                  <SelectItem value="underlined">Underlined Headings</SelectItem>
                  <SelectItem value="bold_underlined">Bold &amp; Underlined</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="abnormal-emphasis">Abnormal Findings Emphasis</Label>
              <Select
                value={formState.abnormalEmphasis || "none"}
                onValueChange={(v) => handleFieldChange("abnormalEmphasis", v)}
              >
                <SelectTrigger id="abnormal-emphasis">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Bold / Standard Wording</SelectItem>
                  <SelectItem value="bold_abnormal">Bold Abnormal Findings Only</SelectItem>
                  <SelectItem value="bold_impression">Bold Impression Points Only</SelectItem>
                  <SelectItem value="bold_both">Bold Abnormalities &amp; Impression</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="spacing">Report Spacing</Label>
              <Select
                value={formState.spacing || "standard"}
                onValueChange={(v) => handleFieldChange("spacing", v)}
              >
                <SelectTrigger id="spacing">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="compact">Compact / Tight gaps</SelectItem>
                  <SelectItem value="standard">Standard spacing</SelectItem>
                  <SelectItem value="comfortable">Comfortable / Relaxed gaps</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <hr className="border-slate-100 dark:border-slate-900" />

          {/* Section 3: Paper Size, Margins & Typography */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-2">
              <Label htmlFor="print-layout">Paper &amp; Print Layout</Label>
              <Select
                value={formState.printLayout || "letterhead"}
                onValueChange={(v) => handleFieldChange("printLayout", v)}
              >
                <SelectTrigger id="print-layout">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="a4_plain">A4 Plain Paper (Include Headers)</SelectItem>
                  <SelectItem value="letterhead">Hospital Letterhead (Leaves Top Gap)</SelectItem>
                  <SelectItem value="half_page">Half-page Compact Layout</SelectItem>
                  <SelectItem value="screen_only">Screen-only Preview</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="margins">Margins</Label>
              <Select
                value={formState.margins || "standard"}
                onValueChange={(v) => handleFieldChange("margins", v)}
              >
                <SelectTrigger id="margins">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="narrow">Narrow (0.5 in)</SelectItem>
                  <SelectItem value="standard">Standard (1.0 in)</SelectItem>
                  <SelectItem value="wide">Wide (1.5 in)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="font-size">Font Sizing</Label>
              <Select
                value={formState.fontSize || "standard"}
                onValueChange={(v) => handleFieldChange("fontSize", v)}
              >
                <SelectTrigger id="font-size">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="small">Small (10pt)</SelectItem>
                  <SelectItem value="standard">Standard (12pt)</SelectItem>
                  <SelectItem value="large">Large (14pt)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <hr className="border-slate-100 dark:border-slate-900" />

          {/* Section 4: Signature Blocks */}
          <div className="space-y-4">
            <h4 className="font-bold text-slate-800 dark:text-slate-200">2. Signatures &amp; Footer Layout</h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
              <div className="flex items-center space-x-2">
                <Switch
                  id="show-rad-name"
                  checked={!!formState.showRadiologistName}
                  onCheckedChange={(v) => handleFieldChange("showRadiologistName", v)}
                />
                <Label htmlFor="show-rad-name" className="text-xs">Rad Name</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="show-degree"
                  checked={!!formState.showDegree}
                  onCheckedChange={(v) => handleFieldChange("showDegree", v)}
                />
                <Label htmlFor="show-degree" className="text-xs">Degrees</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="show-reg"
                  checked={!!formState.showRegNumber}
                  onCheckedChange={(v) => handleFieldChange("showRegNumber", v)}
                />
                <Label htmlFor="show-reg" className="text-xs">Reg Number</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="show-digital"
                  checked={!!formState.showDigitalSignature}
                  onCheckedChange={(v) => handleFieldChange("showDigitalSignature", v)}
                />
                <Label htmlFor="show-digital" className="text-xs">Digital Signature</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="show-timestamp"
                  checked={!!formState.showTimestamp}
                  onCheckedChange={(v) => handleFieldChange("showTimestamp", v)}
                />
                <Label htmlFor="show-timestamp" className="text-xs">Timestamp</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="show-qr"
                  checked={!!formState.showQrVerification}
                  onCheckedChange={(v) => handleFieldChange("showQrVerification", v)}
                />
                <Label htmlFor="show-qr" className="text-xs">QR Verification</Label>
              </div>
            </div>
          </div>

          <hr className="border-slate-100 dark:border-slate-900" />

          {/* Save / Reset actions */}
          <div className="flex justify-end gap-3 pt-2">
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => styleSetting && setFormState(styleSetting)}
            >
              <RotateCcw className="h-4 w-4" /> Reset Settings
            </Button>
            <Button
              className="gap-2 bg-indigo-600 hover:bg-indigo-700 text-white"
              onClick={() => updateMutation.mutate(formState)}
              disabled={updateMutation.isPending}
            >
              <Save className="h-4 w-4" /> Save Changes
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
