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
import { Palette, Save, RotateCcw } from "lucide-react";

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
  subheadingStyle: string;
  abnormalEmphasis: string;
  spacing: string;
  lineGap: string;
  printLayout: string;
  margins: string;
  fontSize: string;
  fontFamily: string;
  logoPosition: string;
  signaturePosition: string;
  imagePlacement: string;
  studyTitleStyle: string;
  logoScale: string;
  clinicNameScale: string;
  addressScale: string;
  nameAlign: string;
  addressAlign: string;
  headerRuleEnabled: boolean;
  headerRuleThickness: string;
  headerRuleColor: string;
  showRadiologistName: boolean;
  showDegree: boolean;
  showRegNumber: boolean;
  showDigitalSignature: boolean;
  showTimestamp: boolean;
  showQrVerification: boolean;
};

const FONT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "arial", label: "Arial" },
  { value: "helvetica", label: "Helvetica" },
  { value: "segoe", label: "Segoe UI" },
  { value: "georgia", label: "Georgia" },
  { value: "times", label: "Times New Roman" },
  { value: "palatino", label: "Palatino" },
  { value: "verdana", label: "Verdana" },
  { value: "tahoma", label: "Tahoma" },
  { value: "courier", label: "Courier New" },
];

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
    subheadingStyle: "underlined",
    abnormalEmphasis: "bold_abnormal",
    spacing: "standard",
    lineGap: "standard",
    printLayout: "letterhead",
    margins: "standard",
    fontSize: "standard",
    fontFamily: "arial",
    logoPosition: "left",
    signaturePosition: "right",
    imagePlacement: "inline",
    studyTitleStyle: "underlined",
    logoScale: "large",
    clinicNameScale: "large",
    addressScale: "large",
    nameAlign: "left",
    addressAlign: "center",
    headerRuleEnabled: true,
    headerRuleThickness: "medium",
    headerRuleColor: "accent",
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
    subheadingStyle: "bold",
    abnormalEmphasis: "bold_both",
    spacing: "compact",
    lineGap: "compact",
    printLayout: "half_page",
    margins: "narrow",
    fontSize: "small",
    fontFamily: "arial",
    logoPosition: "left",
    signaturePosition: "right",
    imagePlacement: "inline",
    studyTitleStyle: "plain",
    logoScale: "standard",
    clinicNameScale: "standard",
    addressScale: "standard",
    nameAlign: "left",
    addressAlign: "right",
    headerRuleEnabled: true,
    headerRuleThickness: "thin",
    headerRuleColor: "slate",
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
    subheadingStyle: "underlined",
    abnormalEmphasis: "bold_impression",
    spacing: "comfortable",
    lineGap: "comfortable",
    printLayout: "letterhead",
    margins: "standard",
    fontSize: "standard",
    fontFamily: "times",
    logoPosition: "left",
    signaturePosition: "right",
    imagePlacement: "end",
    studyTitleStyle: "underlined",
    logoScale: "xlarge",
    clinicNameScale: "xlarge",
    addressScale: "large",
    nameAlign: "left",
    addressAlign: "center",
    headerRuleEnabled: true,
    headerRuleThickness: "thick",
    headerRuleColor: "navy",
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
    subheadingStyle: "plain",
    abnormalEmphasis: "none",
    spacing: "standard",
    lineGap: "standard",
    printLayout: "a4_plain",
    margins: "standard",
    fontSize: "standard",
    fontFamily: "arial",
    logoPosition: "center",
    signaturePosition: "center",
    imagePlacement: "inline",
    studyTitleStyle: "plain",
    logoScale: "large",
    clinicNameScale: "large",
    addressScale: "large",
    nameAlign: "center",
    addressAlign: "center",
    headerRuleEnabled: true,
    headerRuleThickness: "medium",
    headerRuleColor: "black",
    showRadiologistName: true,
    showDegree: true,
    showRegNumber: true,
    showDigitalSignature: true,
    showTimestamp: true,
    showQrVerification: true,
  },
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
      setFormState({
        ...styleSetting,
        subheadingStyle: styleSetting.subheadingStyle || styleSetting.headingStyle || "underlined",
        lineGap: styleSetting.lineGap || styleSetting.spacing || "standard",
        fontFamily: styleSetting.fontFamily || "arial",
        logoPosition: styleSetting.logoPosition || "left",
        signaturePosition: styleSetting.signaturePosition || "right",
        imagePlacement: styleSetting.imagePlacement || "inline",
        studyTitleStyle: styleSetting.studyTitleStyle || "underlined",
        logoScale: styleSetting.logoScale || "large",
        clinicNameScale: styleSetting.clinicNameScale || "large",
        addressScale: styleSetting.addressScale || "large",
        nameAlign: styleSetting.nameAlign || "left",
        addressAlign: styleSetting.addressAlign || "center",
        headerRuleEnabled: styleSetting.headerRuleEnabled !== false,
        headerRuleThickness: styleSetting.headerRuleThickness || "medium",
        headerRuleColor: styleSetting.headerRuleColor || "accent",
      });
    }
  }, [styleSetting]);

  const updateMutation = useMutation({
    mutationFn: (values: Partial<StyleSetting>) =>
      api.put("/api/radiology/institutional-style", values),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["institutional-style"] });
      toast({
        title: "Report Output Style Saved",
        description: "Print, PDF, and workspace previews will use these settings.",
      });
    },
    onError: (err: any) => {
      toast({ variant: "destructive", title: "Failed to Update Settings", description: err.message });
    },
  });

  const handleApplyPreset = (presetKey: string) => {
    const preset = PRESETS[presetKey];
    if (preset) {
      setFormState((prev) => ({
        ...prev,
        ...preset,
        presetName: presetKey,
      }));
      toast({ title: `Preset Applied: ${presetKey}`, description: "Click Save Changes to apply hospital-wide." });
    }
  };

  const handleFieldChange = (field: keyof StyleSetting, value: any) => {
    setFormState((prev) => ({
      ...prev,
      [field]: value,
      // Keep lineGap in sync when spacing is changed and user hasn't set a distinct gap yet.
      ...(field === "spacing" && (!prev.lineGap || prev.lineGap === prev.spacing)
        ? { lineGap: value }
        : {}),
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
                <Palette className="h-5 w-5 text-indigo-500" /> Report Output Style
              </CardTitle>
              <CardDescription>
                Control letterhead logo size and side, clinic name/address size and alignment,
                the rule line under the header, fonts, heading underline, line gaps, DICOM image
                location, signature alignment, and findings emphasis for radiology print/PDF output.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Select value={formState.presetName || ""} onValueChange={handleApplyPreset}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Load Quick Preset" />
                </SelectTrigger>
                <SelectContent>
                  {Object.keys(PRESETS).map((key) => (
                    <SelectItem key={key} value={key}>
                      {key}
                    </SelectItem>
                  ))}
                  <SelectItem value="Custom" disabled>
                    Custom / Modifications
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6 space-y-6 text-sm">
          {/* Section 1: Ordering & Inclusion */}
          <div className="space-y-4">
            <h4 className="font-bold text-slate-800 dark:text-slate-200">1. Report Section Order &amp; Inclusion</h4>
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
                  <Label htmlFor="show-clinical-history" className="text-xs">
                    Clinical History
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Switch
                    id="show-comparison"
                    checked={!!formState.showComparison}
                    onCheckedChange={(v) => handleFieldChange("showComparison", v)}
                  />
                  <Label htmlFor="show-comparison" className="text-xs">
                    Comparison
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Switch
                    id="show-recommendation"
                    checked={!!formState.showRecommendation}
                    onCheckedChange={(v) => handleFieldChange("showRecommendation", v)}
                  />
                  <Label htmlFor="show-recommendation" className="text-xs">
                    Recommendation
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Switch
                    id="show-critical-communication"
                    checked={!!formState.showCriticalCommunication}
                    onCheckedChange={(v) => handleFieldChange("showCriticalCommunication", v)}
                  />
                  <Label htmlFor="show-critical-communication" className="text-xs">
                    Critical Alerts
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Switch
                    id="show-measurements"
                    checked={!!formState.showMeasurements}
                    onCheckedChange={(v) => handleFieldChange("showMeasurements", v)}
                  />
                  <Label htmlFor="show-measurements" className="text-xs">
                    Measurements
                  </Label>
                </div>
              </div>
            </div>
          </div>

          <hr className="border-slate-100 dark:border-slate-900" />

          {/* Section 2: Typography & spacing */}
          <div className="space-y-4">
            <h4 className="font-bold text-slate-800 dark:text-slate-200">2. Typography, Headings &amp; Spacing</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <Label htmlFor="font-family">Report Font</Label>
                <Select
                  value={formState.fontFamily || "arial"}
                  onValueChange={(v) => handleFieldChange("fontFamily", v)}
                >
                  <SelectTrigger id="font-family">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FONT_OPTIONS.map((f) => (
                      <SelectItem key={f.value} value={f.value}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="font-size">Font Size</Label>
                <Select
                  value={formState.fontSize || "standard"}
                  onValueChange={(v) => handleFieldChange("fontSize", v)}
                >
                  <SelectTrigger id="font-size">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="small">Small (10–11pt)</SelectItem>
                    <SelectItem value="standard">Standard (12–13pt)</SelectItem>
                    <SelectItem value="large">Large (14–15pt)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="line-gap">Gap Between Lines</Label>
                <Select
                  value={formState.lineGap || formState.spacing || "standard"}
                  onValueChange={(v) => handleFieldChange("lineGap", v)}
                >
                  <SelectTrigger id="line-gap">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="compact">Tight (compact)</SelectItem>
                    <SelectItem value="standard">Standard</SelectItem>
                    <SelectItem value="comfortable">Relaxed (comfortable)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="heading-style">Section Heading Style</Label>
                <Select
                  value={formState.headingStyle || "plain"}
                  onValueChange={(v) => handleFieldChange("headingStyle", v)}
                >
                  <SelectTrigger id="heading-style">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="plain">Plain (no underline)</SelectItem>
                    <SelectItem value="bold">Bold Headings</SelectItem>
                    <SelectItem value="underlined">Underlined Headings</SelectItem>
                    <SelectItem value="bold_underlined">Bold &amp; Underlined</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="subheading-style">Subheading Style</Label>
                <Select
                  value={formState.subheadingStyle || formState.headingStyle || "underlined"}
                  onValueChange={(v) => handleFieldChange("subheadingStyle", v)}
                >
                  <SelectTrigger id="subheading-style">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="plain">Plain (no underline)</SelectItem>
                    <SelectItem value="bold">Bold</SelectItem>
                    <SelectItem value="underlined">Underlined</SelectItem>
                    <SelectItem value="bold_underlined">Bold &amp; Underlined</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="study-title-style">Study Title Style</Label>
                <Select
                  value={formState.studyTitleStyle || "underlined"}
                  onValueChange={(v) => handleFieldChange("studyTitleStyle", v)}
                >
                  <SelectTrigger id="study-title-style">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="plain">Plain (no underline)</SelectItem>
                    <SelectItem value="underlined">Underlined</SelectItem>
                    <SelectItem value="bar">Accent bar</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="abnormal-emphasis">Findings Emphasis (Bold)</Label>
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
                <Label htmlFor="spacing">Section Spacing</Label>
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
          </div>

          <hr className="border-slate-100 dark:border-slate-900" />

          {/* Section 3: Letterhead — logo, name, address, rule */}
          <div className="space-y-4">
            <h4 className="font-bold text-slate-800 dark:text-slate-200">
              3. Letterhead — Logo, Clinic Name, Address &amp; Header Line
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <Label htmlFor="logo-position">Logo Location</Label>
                <Select
                  value={formState.logoPosition || "left"}
                  onValueChange={(v) => handleFieldChange("logoPosition", v)}
                >
                  <SelectTrigger id="logo-position">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="left">Left</SelectItem>
                    <SelectItem value="center">Center</SelectItem>
                    <SelectItem value="right">Right</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="logo-scale">Logo Size</Label>
                <Select
                  value={formState.logoScale || "large"}
                  onValueChange={(v) => handleFieldChange("logoScale", v)}
                >
                  <SelectTrigger id="logo-scale">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="standard">Standard</SelectItem>
                    <SelectItem value="large">Large</SelectItem>
                    <SelectItem value="xlarge">Extra Large</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="clinic-name-scale">Clinic Name Size</Label>
                <Select
                  value={formState.clinicNameScale || "large"}
                  onValueChange={(v) => handleFieldChange("clinicNameScale", v)}
                >
                  <SelectTrigger id="clinic-name-scale">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="standard">Standard</SelectItem>
                    <SelectItem value="large">Large</SelectItem>
                    <SelectItem value="xlarge">Extra Large</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="name-align">Clinic Name Alignment</Label>
                <Select
                  value={formState.nameAlign || "left"}
                  onValueChange={(v) => handleFieldChange("nameAlign", v)}
                >
                  <SelectTrigger id="name-align">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="left">Left</SelectItem>
                    <SelectItem value="center">Center</SelectItem>
                    <SelectItem value="right">Right</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="address-scale">Address / Contact Size</Label>
                <Select
                  value={formState.addressScale || "large"}
                  onValueChange={(v) => handleFieldChange("addressScale", v)}
                >
                  <SelectTrigger id="address-scale">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="standard">Standard</SelectItem>
                    <SelectItem value="large">Large</SelectItem>
                    <SelectItem value="xlarge">Extra Large</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="address-align">Address Alignment</Label>
                <Select
                  value={formState.addressAlign || "center"}
                  onValueChange={(v) => handleFieldChange("addressAlign", v)}
                >
                  <SelectTrigger id="address-align">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="left">Left</SelectItem>
                    <SelectItem value="center">Center</SelectItem>
                    <SelectItem value="right">Right</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center space-x-2 pt-6">
                <Switch
                  id="header-rule-enabled"
                  checked={formState.headerRuleEnabled !== false}
                  onCheckedChange={(v) => handleFieldChange("headerRuleEnabled", v)}
                />
                <Label htmlFor="header-rule-enabled" className="text-xs">
                  Line under header (before study name)
                </Label>
              </div>

              <div className="space-y-2">
                <Label htmlFor="header-rule-thickness">Header Line Thickness</Label>
                <Select
                  value={formState.headerRuleThickness || "medium"}
                  onValueChange={(v) => handleFieldChange("headerRuleThickness", v)}
                  disabled={formState.headerRuleEnabled === false}
                >
                  <SelectTrigger id="header-rule-thickness">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="thin">Thin (1px)</SelectItem>
                    <SelectItem value="medium">Medium (2px)</SelectItem>
                    <SelectItem value="thick">Thick (3px)</SelectItem>
                    <SelectItem value="extra">Extra thick (5px)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="header-rule-color">Header Line Color</Label>
                <Select
                  value={formState.headerRuleColor || "accent"}
                  onValueChange={(v) => handleFieldChange("headerRuleColor", v)}
                  disabled={formState.headerRuleEnabled === false}
                >
                  <SelectTrigger id="header-rule-color">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="accent">Accent (brand)</SelectItem>
                    <SelectItem value="black">Black</SelectItem>
                    <SelectItem value="slate">Slate grey</SelectItem>
                    <SelectItem value="navy">Navy</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="signature-position">Signature Location</Label>
                <Select
                  value={formState.signaturePosition || "right"}
                  onValueChange={(v) => handleFieldChange("signaturePosition", v)}
                >
                  <SelectTrigger id="signature-position">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="left">Left</SelectItem>
                    <SelectItem value="center">Center</SelectItem>
                    <SelectItem value="right">Right</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="image-placement">DICOM / Key Image Location</Label>
                <Select
                  value={formState.imagePlacement || "inline"}
                  onValueChange={(v) => handleFieldChange("imagePlacement", v)}
                >
                  <SelectTrigger id="image-placement">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inline">Inline with findings</SelectItem>
                    <SelectItem value="side-panel">Side panel (right)</SelectItem>
                    <SelectItem value="end">After findings (end of report)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

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
            </div>
          </div>

          <hr className="border-slate-100 dark:border-slate-900" />

          {/* Section 4: Signature Blocks */}
          <div className="space-y-4">
            <h4 className="font-bold text-slate-800 dark:text-slate-200">4. Signature &amp; Footer Fields</h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
              <div className="flex items-center space-x-2">
                <Switch
                  id="show-rad-name"
                  checked={!!formState.showRadiologistName}
                  onCheckedChange={(v) => handleFieldChange("showRadiologistName", v)}
                />
                <Label htmlFor="show-rad-name" className="text-xs">
                  Rad Name
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="show-degree"
                  checked={!!formState.showDegree}
                  onCheckedChange={(v) => handleFieldChange("showDegree", v)}
                />
                <Label htmlFor="show-degree" className="text-xs">
                  Degrees
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="show-reg"
                  checked={!!formState.showRegNumber}
                  onCheckedChange={(v) => handleFieldChange("showRegNumber", v)}
                />
                <Label htmlFor="show-reg" className="text-xs">
                  Reg Number
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="show-digital"
                  checked={!!formState.showDigitalSignature}
                  onCheckedChange={(v) => handleFieldChange("showDigitalSignature", v)}
                />
                <Label htmlFor="show-digital" className="text-xs">
                  Digital Signature
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="show-timestamp"
                  checked={!!formState.showTimestamp}
                  onCheckedChange={(v) => handleFieldChange("showTimestamp", v)}
                />
                <Label htmlFor="show-timestamp" className="text-xs">
                  Timestamp
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="show-qr"
                  checked={!!formState.showQrVerification}
                  onCheckedChange={(v) => handleFieldChange("showQrVerification", v)}
                />
                <Label htmlFor="show-qr" className="text-xs">
                  QR Verification
                </Label>
              </div>
            </div>
          </div>

          <hr className="border-slate-100 dark:border-slate-900" />

          <div className="flex justify-end gap-3 pt-2">
            <Button
              variant="outline"
              className="gap-2"
              onClick={() =>
                styleSetting &&
                setFormState({
                  ...styleSetting,
                  subheadingStyle: styleSetting.subheadingStyle || styleSetting.headingStyle || "underlined",
                  lineGap: styleSetting.lineGap || styleSetting.spacing || "standard",
                  fontFamily: styleSetting.fontFamily || "arial",
                  logoPosition: styleSetting.logoPosition || "left",
                  signaturePosition: styleSetting.signaturePosition || "right",
                  imagePlacement: styleSetting.imagePlacement || "inline",
                  studyTitleStyle: styleSetting.studyTitleStyle || "underlined",
                  logoScale: styleSetting.logoScale || "large",
                  clinicNameScale: styleSetting.clinicNameScale || "large",
                  addressScale: styleSetting.addressScale || "large",
                  nameAlign: styleSetting.nameAlign || "left",
                  addressAlign: styleSetting.addressAlign || "center",
                  headerRuleEnabled: styleSetting.headerRuleEnabled !== false,
                  headerRuleThickness: styleSetting.headerRuleThickness || "medium",
                  headerRuleColor: styleSetting.headerRuleColor || "accent",
                })
              }
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
