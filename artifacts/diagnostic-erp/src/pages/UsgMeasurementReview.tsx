import { useState, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2, XCircle, RefreshCw, ClipboardCopy, ImagePlus,
  Trash2, Activity, AlertCircle, Info, ChevronDown, ChevronUp,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { launchViewer } from "@/lib/viewerService";

// ── Types ─────────────────────────────────────────────────────────────────────

interface UsgMeasurement {
  id: number;
  studyInstanceUID: string | null;
  accessionNumber: string | null;
  source: string;
  overallConfidence: string;
  status: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  manufacturer: string | null;
  manufacturerModel: string | null;
  institutionName: string | null;
  studyDescription: string | null;
  studyDate: string | null;
  bpd: string | null; bpdConfidence: string | null;
  hc: string | null;  hcConfidence: string | null;
  ac: string | null;  acConfidence: string | null;
  fl: string | null;  flConfidence: string | null;
  crl: string | null; crlConfidence: string | null;
  efw: string | null; efwConfidence: string | null;
  ga: string | null;  gaConfidence: string | null;
  edd: string | null; eddConfidence: string | null;
  fhr: string | null; fhrConfidence: string | null;
  placentaPosition: string | null;
  liquorAfi: string | null;
  fetalPresentation: string | null;
  uterusSize: string | null;       uterusSizeConfidence: string | null;
  endometrium: string | null;      endometriumConfidence: string | null;
  rightOvary: string | null;       rightOvaryConfidence: string | null;
  leftOvary: string | null;        leftOvaryConfidence: string | null;
  follicles: string | null;
  adnexalLesion: string | null;
  liverSize: string | null;        liverSizeConfidence: string | null;
  spleenSize: string | null;       spleenSizeConfidence: string | null;
  rightKidney: string | null;      rightKidneyConfidence: string | null;
  leftKidney: string | null;       leftKidneyConfidence: string | null;
  cbd: string | null;              cbdConfidence: string | null;
  gbWall: string | null;           gbWallConfidence: string | null;
  prostateVolume: string | null;   prostateVolumeConfidence: string | null;
  extraMeasurementsJson: string;
  provenanceJson: string;
  engineVersion: string;
  createdAt: string;
}

interface UsgKeyImage {
  id: number;
  label: string;
  seriesNumber: string | null;
  imageNumber: string | null;
  wadoUrl: string | null;
  sortOrder: number;
  addedBy: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function ConfidenceBadge({ level }: { level: string | null | undefined }) {
  if (!level) return null;
  const map: Record<string, { label: string; className: string }> = {
    high:   { label: "SR",     className: "bg-green-100 text-green-800 border-green-300" },
    medium: { label: "OCR",    className: "bg-yellow-100 text-yellow-800 border-yellow-300" },
    low:    { label: "~OCR",   className: "bg-red-100 text-red-800 border-red-300" },
  };
  const { label, className } = map[level] ?? { label: level, className: "bg-slate-100 text-slate-600" };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${className}`}>
      {label}
    </span>
  );
}

interface MeasurementRowProps {
  label: string;
  field: string;
  value: string | null;
  confidence: string | null | undefined;
  editing: boolean;
  editValue: string;
  onEditChange: (v: string) => void;
  onSave: () => void;
  onTrace?: () => void;
}

function MeasurementRow({ label, field: _field, value, confidence, editing, editValue, onEditChange, onSave, onTrace }: MeasurementRowProps) {
  if (!value && !editing) return null;
  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-dashed last:border-0">
      <span className="text-xs text-muted-foreground w-40 shrink-0">{label}</span>
      {editing ? (
        <Input
          value={editValue}
          onChange={(e) => onEditChange(e.target.value)}
          onBlur={onSave}
          onKeyDown={(e) => e.key === "Enter" && onSave()}
          className="h-7 text-xs"
          autoFocus
        />
      ) : (
        <span className="text-sm font-medium flex-1">{value}</span>
      )}
      <ConfidenceBadge level={confidence} />
      {onTrace && value && !editing && (
        <Button
          variant="outline"
          size="sm"
          className="h-5 px-1.5 text-[9px] font-mono text-muted-foreground border-muted hover:border-foreground shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onTrace();
          }}
        >
          Trace
        </Button>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function UsgMeasurementReview() {
  const params = useParams<{ studyInstanceUID?: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  // studyInstanceUID can come from URL param or query string
  const search = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const studyUID = params.studyInstanceUID ?? search.get("studyUID") ?? "";

  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [reviewNotes, setReviewNotes] = useState("");
  const [showLogs, setShowLogs] = useState(false);
  const [showKeyImages, setShowKeyImages] = useState(true);
  const [newImageLabel, setNewImageLabel] = useState("");
  const [newImageWado, setNewImageWado] = useState("");
  const [traceField, setTraceField] = useState<{ field: string; label: string; value: string } | null>(null);

  const pacsSettingsQuery = useQuery<{ key: string; value: string; category: string }[]>({
    queryKey: ["pacs-settings"],
    queryFn: () => fetchApi("/api/radiology/pacs-settings"),
  });

  const pacsSettingsRecord = useMemo(() => {
    const record: Record<string, string> = {};
    if (pacsSettingsQuery.data) {
      for (const item of pacsSettingsQuery.data) {
        record[item.key] = item.value;
      }
    }
    return record;
  }, [pacsSettingsQuery.data]);

  // ── Queries ─────────────────────────────────────────────────────────────────

  const measQuery = useQuery<UsgMeasurement[]>({
    queryKey: ["usg-measurements", studyUID],
    queryFn: () => fetchApi(`/api/usg-extraction/study/${encodeURIComponent(studyUID)}`),
    enabled: !!studyUID,
    staleTime: 30_000,
  });

  const logsQuery = useQuery({
    queryKey: ["usg-logs", studyUID],
    queryFn: () => fetchApi(`/api/usg-extraction/study/${encodeURIComponent(studyUID)}/logs`),
    enabled: !!studyUID && showLogs,
  });

  const keyImagesQuery = useQuery<UsgKeyImage[]>({
    queryKey: ["usg-key-images", studyUID],
    queryFn: () => fetchApi(`/api/usg-extraction/study/${encodeURIComponent(studyUID)}/key-images`),
    enabled: !!studyUID,
    staleTime: 60_000,
  });

  const measurement = measQuery.data?.[0];

  // ── Mutations ────────────────────────────────────────────────────────────────

  const refetch = () => {
    void qc.invalidateQueries({ queryKey: ["usg-measurements", studyUID] });
    void qc.invalidateQueries({ queryKey: ["usg-logs", studyUID] });
  };

  const extractMutation = useMutation({
    mutationFn: () =>
      fetchApi("/api/usg-extraction/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studyInstanceUID: studyUID }),
      }),
    onSuccess: () => { toast({ title: "Extraction started", description: "Measurements will appear shortly" }); refetch(); },
    onError: (e: Error) => toast({ title: "Extraction failed", description: e.message, variant: "destructive" }),
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) =>
      fetchApi(`/api/usg-extraction/measurements/${id}/approve`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewNotes }),
      }),
    onSuccess: () => { toast({ title: "Measurements approved" }); refetch(); },
    onError: (e: Error) => toast({ title: "Approve failed", description: e.message, variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: number) =>
      fetchApi(`/api/usg-extraction/measurements/${id}/reject`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewNotes }),
      }),
    onSuccess: () => { toast({ title: "Measurements rejected" }); refetch(); },
    onError: (e: Error) => toast({ title: "Reject failed", description: e.message, variant: "destructive" }),
  });

  const fieldMutation = useMutation({
    mutationFn: ({ id, field, value }: { id: number; field: string; value: string }) =>
      fetchApi(`/api/usg-extraction/measurements/${id}/field`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      }),
    onSuccess: () => { refetch(); setEditingField(null); },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const addKeyImageMutation = useMutation({
    mutationFn: () =>
      fetchApi(`/api/usg-extraction/study/${encodeURIComponent(studyUID)}/key-images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: newImageLabel, wadoUrl: newImageWado }),
      }),
    onSuccess: () => {
      toast({ title: "Key image added" });
      setNewImageLabel(""); setNewImageWado("");
      void qc.invalidateQueries({ queryKey: ["usg-key-images", studyUID] });
    },
  });

  const deleteKeyImageMutation = useMutation({
    mutationFn: (id: number) => fetchApi(`/api/usg-extraction/key-images/${id}`, { method: "DELETE" }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["usg-key-images", studyUID] }); },
  });

  // ── Auto-fill helper ──────────────────────────────────────────────────────

  function copyMeasurementsToClipboard() {
    if (!measurement) return;
    const lines: string[] = [];
    const add = (label: string, val: string | null) => { if (val) lines.push(`${label}: ${val}`); };
    add("BPD", measurement.bpd); add("HC", measurement.hc); add("AC", measurement.ac);
    add("FL", measurement.fl); add("CRL", measurement.crl); add("EFW", measurement.efw);
    add("GA", measurement.ga); add("EDD", measurement.edd); add("FHR", measurement.fhr);
    add("Placenta", measurement.placentaPosition); add("Liquor/AFI", measurement.liquorAfi);
    add("Presentation", measurement.fetalPresentation);
    add("Uterus", measurement.uterusSize); add("Endometrium", measurement.endometrium);
    add("Right Ovary", measurement.rightOvary); add("Left Ovary", measurement.leftOvary);
    add("Liver", measurement.liverSize); add("Spleen", measurement.spleenSize);
    add("Right Kidney", measurement.rightKidney); add("Left Kidney", measurement.leftKidney);
    add("CBD", measurement.cbd); add("GB Wall", measurement.gbWall);
    add("Prostate Vol.", measurement.prostateVolume);
    try {
      const extras = JSON.parse(measurement.extraMeasurementsJson) as Record<string, string>;
      for (const [k, v] of Object.entries(extras)) if (v) add(k, v);
    } catch { /* ignore */ }
    void navigator.clipboard.writeText(lines.join("\n"));
    toast({ title: "Copied to clipboard", description: `${lines.length} measurements` });
  }

  // ── Field editing helpers ─────────────────────────────────────────────────

  function startEdit(field: string, current: string | null) {
    setEditingField(field);
    setEditValue(current ?? "");
  }

  function saveEdit(field: string) {
    if (!measurement) return;
    fieldMutation.mutate({ id: measurement.id, field, value: editValue });
  }

  function mkRow(label: string, field: string, value: string | null, confidence?: string | null) {
    return (
      <div
        key={field}
        onClick={() => editingField !== field && startEdit(field, value)}
        className={value || editingField === field ? "cursor-pointer" : ""}
      >
        <MeasurementRow
          label={label} field={field} value={value} confidence={confidence}
          editing={editingField === field} editValue={editValue}
          onEditChange={setEditValue} onSave={() => saveEdit(field)}
          onTrace={() => setTraceField({ field, label, value: value || "" })}
        />
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (!studyUID) {
    return (
      <div className="p-6">
        <PageHeader title="USG Measurement Review" subtitle="Auto-extracted ultrasound measurements" />
        <Card className="mt-6"><CardContent className="pt-6 text-center text-muted-foreground">
          No study selected. Open this page from the Radiology Worklist by clicking "Review USG Measurements" on a US modality study.
        </CardContent></Card>
      </div>
    );
  }

  const isLoading = measQuery.isLoading;
  const confidenceColor = measurement?.overallConfidence === "high" ? "text-green-600"
    : measurement?.overallConfidence === "medium" ? "text-yellow-600" : "text-red-600";

  const statusBadgeMap: Record<string, string> = {
    pending_review: "bg-yellow-100 text-yellow-800 border-yellow-300",
    approved:       "bg-green-100 text-green-800 border-green-300",
    rejected:       "bg-red-100 text-red-800 border-red-300",
    auto_filled:    "bg-blue-100 text-blue-800 border-blue-300",
  };

  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHeader
        title="USG Measurement Review"
        subtitle={`Study: ${studyUID.slice(0, 40)}${studyUID.length > 40 ? "…" : ""}`}
        actions={
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => extractMutation.mutate()} disabled={extractMutation.isPending}>
              <RefreshCw className={`h-4 w-4 mr-2 ${extractMutation.isPending ? "animate-spin" : ""}`} />
              {extractMutation.isPending ? "Extracting…" : "Re-Extract"}
            </Button>
            {measurement && (
              <Button variant="outline" size="sm" onClick={copyMeasurementsToClipboard}>
                <ClipboardCopy className="h-4 w-4 mr-2" /> Copy All
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => navigate("/radiology/worklist")}>
              ← Worklist
            </Button>
          </div>
        }
      />

      {/* Safety notice */}
      <Card className="border-amber-200 bg-amber-50">
        <CardContent className="pt-4 pb-3 flex gap-3">
          <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-800">
            <strong>Human verification required.</strong> Review all extracted values before approving.
            Measurements are never auto-finalized or inserted into reports without explicit approval.
            Click any value to correct it, then approve.
          </p>
        </CardContent>
      </Card>

      {isLoading && (
        <Card><CardContent className="pt-6 text-center text-muted-foreground">Loading measurements…</CardContent></Card>
      )}

      {!isLoading && !measurement && (
        <Card>
          <CardContent className="pt-6 text-center space-y-4">
            <p className="text-muted-foreground">No extracted measurements found for this study.</p>
            <Button onClick={() => extractMutation.mutate()} disabled={extractMutation.isPending}>
              <RefreshCw className={`h-4 w-4 mr-2 ${extractMutation.isPending ? "animate-spin" : ""}`} />
              {extractMutation.isPending ? "Extracting…" : "Extract Measurements Now"}
            </Button>
          </CardContent>
        </Card>
      )}

      {measurement && (
        <>
          {/* Status + metadata */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="text-base">Extraction Summary</CardTitle>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs font-semibold ${confidenceColor}`}>
                    ● {measurement.overallConfidence.toUpperCase()} confidence
                  </span>
                  <Badge variant="outline" className={statusBadgeMap[measurement.status] ?? ""}>
                    {measurement.status.replace(/_/g, " ")}
                  </Badge>
                  <Badge variant="outline" className="capitalize">{measurement.source.replace(/_/g, " ")}</Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              {measurement.manufacturer && <div><span className="text-muted-foreground">Machine:</span> {measurement.manufacturer} {measurement.manufacturerModel}</div>}
              {measurement.institutionName && <div><span className="text-muted-foreground">Institution:</span> {measurement.institutionName}</div>}
              {measurement.studyDate && <div><span className="text-muted-foreground">Study Date:</span> {measurement.studyDate}</div>}
              {measurement.studyDescription && <div><span className="text-muted-foreground">Description:</span> {measurement.studyDescription}</div>}
              <div className="col-span-2 text-xs text-muted-foreground">
                <Info className="h-3.5 w-3.5 inline mr-1" />
                Click any measurement to edit it manually before approving.
              </div>
            </CardContent>
          </Card>

          {/* Obstetric measurements */}
          {(measurement.bpd || measurement.hc || measurement.ac || measurement.fl ||
            measurement.crl || measurement.efw || measurement.ga || measurement.edd ||
            measurement.fhr || measurement.placentaPosition || measurement.liquorAfi || measurement.fetalPresentation) && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Obstetric / Fetal</CardTitle></CardHeader>
              <CardContent className="pt-0">
                {mkRow("BPD (Biparietal Dia.)", "bpd", measurement.bpd, measurement.bpdConfidence)}
                {mkRow("HC (Head Circumference)", "hc", measurement.hc, measurement.hcConfidence)}
                {mkRow("AC (Abdominal Circ.)", "ac", measurement.ac, measurement.acConfidence)}
                {mkRow("FL (Femur Length)", "fl", measurement.fl, measurement.flConfidence)}
                {mkRow("CRL (Crown-Rump)", "crl", measurement.crl, measurement.crlConfidence)}
                {mkRow("EFW (Est. Fetal Wt.)", "efw", measurement.efw, measurement.efwConfidence)}
                {mkRow("GA (Gestational Age)", "ga", measurement.ga, measurement.gaConfidence)}
                {mkRow("EDD (Est. Due Date)", "edd", measurement.edd, measurement.eddConfidence)}
                {mkRow("FHR (Fetal Heart Rate)", "fhr", measurement.fhr, measurement.fhrConfidence)}
                {mkRow("Placenta Position", "placentaPosition", measurement.placentaPosition)}
                {mkRow("Liquor / AFI", "liquorAfi", measurement.liquorAfi)}
                {mkRow("Fetal Presentation", "fetalPresentation", measurement.fetalPresentation)}
              </CardContent>
            </Card>
          )}

          {/* Pelvis */}
          {(measurement.uterusSize || measurement.endometrium || measurement.rightOvary ||
            measurement.leftOvary || measurement.follicles || measurement.adnexalLesion) && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Pelvis / Gynaecology</CardTitle></CardHeader>
              <CardContent className="pt-0">
                {mkRow("Uterus Size", "uterusSize", measurement.uterusSize, measurement.uterusSizeConfidence)}
                {mkRow("Endometrium", "endometrium", measurement.endometrium, measurement.endometriumConfidence)}
                {mkRow("Right Ovary", "rightOvary", measurement.rightOvary, measurement.rightOvaryConfidence)}
                {mkRow("Left Ovary", "leftOvary", measurement.leftOvary, measurement.leftOvaryConfidence)}
                {mkRow("Follicles", "follicles", measurement.follicles)}
                {mkRow("Adnexal Lesion", "adnexalLesion", measurement.adnexalLesion)}
              </CardContent>
            </Card>
          )}

          {/* Abdomen */}
          {(measurement.liverSize || measurement.spleenSize || measurement.rightKidney ||
            measurement.leftKidney || measurement.cbd || measurement.gbWall || measurement.prostateVolume) && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Abdomen</CardTitle></CardHeader>
              <CardContent className="pt-0">
                {mkRow("Liver Size", "liverSize", measurement.liverSize, measurement.liverSizeConfidence)}
                {mkRow("Spleen Size", "spleenSize", measurement.spleenSize, measurement.spleenSizeConfidence)}
                {mkRow("Right Kidney", "rightKidney", measurement.rightKidney, measurement.rightKidneyConfidence)}
                {mkRow("Left Kidney", "leftKidney", measurement.leftKidney, measurement.leftKidneyConfidence)}
                {mkRow("CBD (Common Bile Duct)", "cbd", measurement.cbd, measurement.cbdConfidence)}
                {mkRow("GB Wall Thickness", "gbWall", measurement.gbWall, measurement.gbWallConfidence)}
                {mkRow("Prostate Volume", "prostateVolume", measurement.prostateVolume, measurement.prostateVolumeConfidence)}
              </CardContent>
            </Card>
          )}

          {/* Extra measurements */}
          {(() => {
            try {
              const extras = JSON.parse(measurement.extraMeasurementsJson) as Record<string, string>;
              const entries = Object.entries(extras).filter(([, v]) => v);
              if (!entries.length) return null;
              return (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Other Visible Measurements</CardTitle></CardHeader>
                  <CardContent className="pt-0">
                    {entries.map(([k, v]) => (
                      <div key={k} className="flex items-center gap-2 py-1.5 border-b border-dashed last:border-0">
                        <span className="text-xs text-muted-foreground w-40 shrink-0">{k}</span>
                        <span className="text-sm font-medium">{v}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              );
            } catch { return null; }
          })()}

          {/* Review action */}
          {measurement.status === "pending_review" && (
            <Card className="border-blue-200 bg-blue-50">
              <CardHeader className="pb-2"><CardTitle className="text-base">Radiologist Review</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <Textarea
                  placeholder="Review notes (optional)…"
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  className="bg-white text-sm"
                  rows={2}
                />
                <div className="flex gap-3">
                  <Button
                    onClick={() => approveMutation.mutate(measurement.id)}
                    disabled={approveMutation.isPending}
                    className="bg-green-600 hover:bg-green-700 text-white"
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Approve & Enable Auto-Fill
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => rejectMutation.mutate(measurement.id)}
                    disabled={rejectMutation.isPending}
                  >
                    <XCircle className="h-4 w-4 mr-2" /> Reject
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Approving enables auto-fill of these values into the report template. The report still requires your signature to be finalized.
                </p>
              </CardContent>
            </Card>
          )}

          {measurement.status === "approved" && (
            <Card className="border-green-200 bg-green-50">
              <CardContent className="pt-4 flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                <div>
                  <p className="text-sm font-medium text-green-800">Approved by {measurement.reviewedBy}</p>
                  {measurement.reviewNotes && <p className="text-xs text-green-700 mt-0.5">{measurement.reviewNotes}</p>}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Key images */}
      <Card>
        <CardHeader className="pb-2 cursor-pointer" onClick={() => setShowKeyImages(!showKeyImages)}>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <ImagePlus className="h-4 w-4" /> Key Images for Report
              {keyImagesQuery.data?.length ? (
                <Badge variant="secondary">{keyImagesQuery.data.length}</Badge>
              ) : null}
            </CardTitle>
            {showKeyImages ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
        </CardHeader>
        {showKeyImages && (
          <CardContent className="space-y-3">
            {keyImagesQuery.data?.map((img) => (
              <div key={img.id} className="flex items-center gap-3 p-2 rounded border">
                {img.wadoUrl && (
                  <a href={img.wadoUrl} target="_blank" rel="noopener noreferrer" className="shrink-0">
                    <img src={img.wadoUrl} alt="key frame" className="h-16 w-16 object-cover rounded border" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  </a>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{img.label || "(unlabelled)"}</p>
                  <p className="text-xs text-muted-foreground">Series {img.seriesNumber ?? "?"} / Image {img.imageNumber ?? "?"}</p>
                  {img.addedBy && <p className="text-xs text-muted-foreground">Added by {img.addedBy}</p>}
                </div>
                <Button variant="ghost" size="icon" className="text-destructive" onClick={() => deleteKeyImageMutation.mutate(img.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Separator />
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Add key image by WADO URL:</p>
              <Input placeholder="Label (e.g. BPD measurement)" value={newImageLabel} onChange={(e) => setNewImageLabel(e.target.value)} className="text-sm" />
              <Input placeholder="WADO-URI URL (optional)" value={newImageWado} onChange={(e) => setNewImageWado(e.target.value)} className="text-sm font-mono text-xs" />
              <Button size="sm" onClick={() => addKeyImageMutation.mutate()} disabled={!newImageLabel || addKeyImageMutation.isPending}>
                <ImagePlus className="h-4 w-4 mr-2" /> Add Image
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Extraction logs */}
      <Card>
        <CardHeader className="pb-2 cursor-pointer" onClick={() => setShowLogs(!showLogs)}>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4" /> Extraction History
            </CardTitle>
            {showLogs ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
        </CardHeader>
        {showLogs && (
          <CardContent>
            {logsQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <div className="space-y-2">
                {(logsQuery.data as Array<Record<string, unknown>> | undefined)?.map((log) => (
                  <div key={String(log.id)} className="text-xs p-2 rounded border space-y-0.5">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={log.status === "completed" ? "text-green-700" : "text-red-700"}>
                        {String(log.status)}
                      </Badge>
                      <span className="text-muted-foreground">{String(log.extractionType)}</span>
                      <span className="text-muted-foreground ml-auto">{String(log.createdAt).slice(0, 16).replace("T", " ")}</span>
                    </div>
                    <div className="text-muted-foreground">
                      Frames: {String(log.framesProcessed)} processed / {String(log.framesFailed)} failed
                      {log.srFound ? " · SR found" : ""}
                      {log.aiNormalized ? " · AI normalized" : ""}
                      {log.durationMs ? ` · ${String(log.durationMs)}ms` : ""}
                    </div>
                    {log.errorMessage ? <div className="text-red-600">{String(log.errorMessage as string)}</div> : null}
                  </div>
                ))}
                {!(logsQuery.data as unknown[])?.length && <p className="text-sm text-muted-foreground">No extraction runs recorded yet.</p>}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      <Dialog open={!!traceField} onOpenChange={(open) => !open && setTraceField(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-bold">
              <Activity className="h-5 w-5 text-primary" />
              Measurement Provenance Traceability
            </DialogTitle>
            <DialogDescription>
              Tracing the precise DICOM acquisition or OCR origin of this measurement.
            </DialogDescription>
          </DialogHeader>

          {traceField && (() => {
            const getSourceBadge = (sourceType: string) => {
              const norm = (sourceType || "").toUpperCase();
              if (norm.includes("SR") || norm.includes("DICOM_SR")) {
                return <Badge className="bg-green-100 text-green-800 border-green-300 border hover:bg-green-100">DICOM SR</Badge>;
              }
              if (norm.includes("PRIVATE") || norm.includes("GE_PRIVATE_TAG")) {
                return <Badge className="bg-blue-100 text-blue-800 border-blue-300 border hover:bg-blue-100">GE Private Tag</Badge>;
              }
              if (norm.includes("OCR")) {
                return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300 border hover:bg-yellow-100">OCR</Badge>;
              }
              if (norm.includes("MANUAL")) {
                return <Badge className="bg-gray-100 text-gray-800 border-gray-300 border hover:bg-gray-100">Manual</Badge>;
              }
              return <Badge variant="outline">{sourceType}</Badge>;
            };

            const getConfidenceBadge = (confidence: string) => {
              const norm = (confidence || "").toLowerCase();
              if (norm === "low") {
                return <Badge className="bg-red-100 text-red-800 border-red-300 border hover:bg-red-100 font-bold">⚠️ Low Confidence</Badge>;
              }
              if (norm === "medium") {
                return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300 border hover:bg-yellow-100">Medium Confidence</Badge>;
              }
              if (norm === "high") {
                return <Badge className="bg-green-100 text-green-800 border-green-300 border hover:bg-green-100">High Confidence</Badge>;
              }
              return <Badge variant="outline">{confidence}</Badge>;
            };

            let provenanceItem: Record<string, unknown> | null = null;
            if (measurement?.provenanceJson) {
              try {
                const parsed = JSON.parse(measurement.provenanceJson);
                provenanceItem = parsed[traceField.field] || null;
              } catch { /* ignore */ }
            }

            const studyUid = String(provenanceItem?.studyInstanceUID || measurement?.studyInstanceUID || studyUID);
            const seriesUid = String(provenanceItem?.seriesInstanceUID || "N/A");
            const sopUid = String(provenanceItem?.sopInstanceUID || "N/A");
            const frameNum = Number(provenanceItem?.frameNumber ?? 1);
            const sourceType = String(provenanceItem?.sourceType || measurement?.source || "OCR");
            const confidence = String(provenanceItem?.sourceConfidence || (traceField.field ? (measurement as unknown as Record<string, unknown>)[traceField.field + "Confidence"] : null) || "medium");
            const rawVal = String(provenanceItem?.rawExtractedValue || traceField.value || "—");
            const normVal = String(provenanceItem?.normalizedValue || traceField.value || "—");
            const unit = String(provenanceItem?.unit || "N/A");
            const engineVer = String(provenanceItem?.extractedByEngineVersion || measurement?.engineVersion || "1.5.0");
            const extTime = provenanceItem?.extractedAt ? new Date(String(provenanceItem.extractedAt)).toLocaleString() : (measurement?.createdAt ? new Date(measurement.createdAt).toLocaleString() : "N/A");

            const handleLaunch = (viewer: "OHIF" | "WEASIS") => {
              launchViewer(studyUid, viewer, pacsSettingsRecord, toast);
            };

            const handleCopy = () => {
              if (!provenanceItem) {
                toast({ title: "No trace JSON available to copy", description: "Defaulting to fallback metadata" });
                navigator.clipboard.writeText(JSON.stringify({
                  studyInstanceUID: studyUid,
                  seriesInstanceUID: seriesUid,
                  sopInstanceUID: sopUid,
                  frameNumber: frameNum,
                  sourceType,
                  sourceLabel: traceField.field.toUpperCase(),
                  sourceConfidence: confidence,
                  sourcePath: "Default Trace fallback",
                  rawExtractedValue: rawVal,
                  normalizedValue: normVal,
                  unit,
                  extractedAt: measurement?.createdAt || new Date().toISOString(),
                  extractedByEngineVersion: engineVer
                }, null, 2));
                return;
              }
              navigator.clipboard.writeText(JSON.stringify(provenanceItem, null, 2));
              toast({ title: "Trace JSON copied to clipboard" });
            };

            return (
              <div className="space-y-4 pt-2">
                <div className="grid grid-cols-2 gap-4 border-b pb-4">
                  <div>
                    <label className="text-[10px] uppercase font-bold text-muted-foreground">Measurement</label>
                    <div className="text-sm font-semibold">{traceField.label}</div>
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold text-muted-foreground">Final Value</label>
                    <div className="text-sm font-semibold text-primary">{traceField.value}</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  <div>
                    <span className="text-muted-foreground block text-xs">Source Type</span>
                    <div className="mt-1">{getSourceBadge(sourceType)}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-xs">Confidence</span>
                    <div className="mt-1">{getConfidenceBadge(confidence)}</div>
                  </div>

                  <div className="col-span-2">
                    <span className="text-muted-foreground block text-xs">Source Path / Reference Tag</span>
                    <span className="font-mono text-xs break-all bg-muted p-1.5 rounded block mt-1">
                      {String(provenanceItem?.sourcePath || "N/A (Default / Manual Entry)")}
                    </span>
                  </div>

                  <div>
                    <span className="text-muted-foreground block text-xs">Raw Extracted Value</span>
                    <span className="font-mono font-medium">{rawVal}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-xs">Normalized Value</span>
                    <span className="font-mono font-medium">{normVal}</span>
                  </div>

                  <div>
                    <span className="text-muted-foreground block text-xs">Unit</span>
                    <span>{unit}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-xs">Engine Version</span>
                    <span className="font-mono text-xs">{engineVer}</span>
                  </div>

                  <div className="col-span-2 border-t pt-3 mt-1 space-y-2">
                    <label className="text-[10px] uppercase font-bold text-muted-foreground block">DICOM Identifiers</label>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-muted-foreground">Study UID:</span>
                        <div className="font-mono truncate select-all" title={studyUid}>
                          {studyUid}
                        </div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Series UID:</span>
                        <div className="font-mono truncate select-all" title={seriesUid}>
                          {seriesUid}
                        </div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">SOP UID:</span>
                        <div className="font-mono truncate select-all" title={sopUid}>
                          {sopUid}
                        </div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Frame / Time:</span>
                        <div>
                          Frame {frameNum} · {extTime}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex gap-2 justify-end border-t pt-4 mt-2">
                  <Button size="sm" variant="outline" onClick={() => handleLaunch("OHIF")}>
                    Open Source Image in OHIF
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => handleLaunch("WEASIS")}>
                    Open Source Image in Weasis
                  </Button>
                  <Button size="sm" variant="secondary" onClick={handleCopy}>
                    Copy Trace JSON
                  </Button>
                  <Button size="sm" onClick={() => setTraceField(null)}>
                    Close
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
