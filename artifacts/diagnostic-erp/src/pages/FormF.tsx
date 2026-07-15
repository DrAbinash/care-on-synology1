import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Search, Printer, RefreshCcw, FileText, List, User, Phone, Users, BookOpen,
  Upload, Camera, CheckCircle2, AlertTriangle, MessageCircle, Stethoscope, X,
  ChevronDown, ExternalLink
} from "lucide-react";
import IdCardScanPanel from "@/components/IdCardScanPanel";
import UnifiedScanCapture from "@/components/UnifiedScanCapture";
import { decodeQrFromBlob } from "@/lib/aadhaarQr";
import { readStaffSession } from "@/lib/staffSession";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";

type DoctorOption = { id: number; name: string; registrationNumber: string | null };

// ── OCR confidence tiering ──
// 95-100%: auto-populate form fields (still never overwrites a value the
//          user already typed — see the `prev.field ||` guard at call sites).
// 80-94%:  populate the review panel only; staff must click "Use this" to
//          apply it — no silent auto-fill.
// <80%:    OCR result stays visible for reference, but is never offered as
//          a one-click apply; staff is expected to type the field manually.
type OcrConfidenceTier = "auto" | "confirm" | "manual";
function ocrConfidenceTier(confidencePercent: number | undefined): OcrConfidenceTier {
  const pct = confidencePercent ?? 0;
  if (pct >= 95) return "auto";
  if (pct >= 80) return "confirm";
  return "manual";
}

// ── ID card OCR response shape (see /api/form-f/upload-id) ──
type IdCardOcr = {
  guardianName?: string; address?: string; documentType?: string; confidence?: string; confidencePercent?: number;
  ocrProvider?: "gemini" | "ollama"; dob?: string; yearOfBirth?: string; age?: number; gender?: string; idNumber?: string;
};
type OcrOutcome = "success" | "no_provider_configured" | "ollama_unreachable" | "ollama_model_not_vision_capable" | "ollama_model_not_configured";
type IdCardUploadResponse = {
  ocr?: IdCardOcr | null;
  ocrError?: string | null;
  ocrOutcome?: OcrOutcome;
  recordId?: number;
};

// Context-sensitive OCR messaging — replaces a single large red "OCR
// unavailable" toast with a message matched to what actually happened. Only
// genuine failures (couldn't read the uploaded file at all) use the
// destructive/red styling; every OCR-degraded-gracefully case below uses
// the neutral default toast, since the upload itself always still succeeds
// and manual entry always remains available.
function ocrOutcomeToast(outcome: OcrOutcome | undefined, ocrError: string | null | undefined): { title: string; description?: string; variant?: "default" | "destructive" } {
  switch (outcome) {
    case "success":
      return { title: "ID details extracted", description: "Please verify highlighted fields." };
    case "ollama_unreachable":
      return { title: "ID uploaded", description: "The local AI service is unavailable. Enter the details manually or retry." };
    case "ollama_model_not_vision_capable":
    case "ollama_model_not_configured":
      return { title: "ID uploaded", description: "The selected Ollama model does not support image OCR. Select a vision-capable model in AI Provider Settings." };
    case "no_provider_configured":
      return { title: "ID uploaded successfully", description: "Automatic OCR is not configured; please enter the details manually." };
    default:
      return { title: "ID uploaded", description: ocrError || "OCR could not process this image. Enter details manually.", variant: "destructive" };
  }
}

// ── Admin-only OCR provider diagnostics (item 13) — shows which provider ID
// scans will actually use right now and why, without ever exposing secrets
// (the backend masks the Ollama endpoint and never returns API keys). Only
// rendered for admin/super_admin roles since it surfaces infra config. ──
type OcrStatus = {
  ok: boolean;
  selectedProvider?: "ollama" | "gemini" | "none";
  ollama?: { configured: boolean; enabled: boolean; endpointUrl: string | null; model: string | null; visionSupport: string; reachable: boolean | null; reachabilityError?: string };
  gemini?: { configured: boolean };
  unavailableReason?: string | null;
};
function OcrDiagnosticsPanel() {
  const { data, isLoading, refetch, isFetching } = useQuery<OcrStatus>({
    queryKey: ["form-f-ocr-status"],
    queryFn: () => api.get("/api/form-f/ocr-status"),
    staleTime: 15_000,
  });
  return (
    <details className="border border-gray-200 rounded-lg text-xs">
      <summary className="px-3 py-2 cursor-pointer text-muted-foreground font-medium select-none">
        OCR provider diagnostics (admin)
      </summary>
      <div className="px-3 pb-3 space-y-1.5">
        {isLoading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : !data?.ok ? (
          <p className="text-red-600">Failed to load diagnostics.</p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <span className="font-medium">Active provider:</span>
              <Badge variant="outline" className={data.selectedProvider === "none" ? "border-red-300 text-red-700 bg-red-50" : "border-green-300 text-green-700 bg-green-50"}>
                {data.selectedProvider === "none" ? "None (manual entry)" : data.selectedProvider === "ollama" ? "Ollama (local)" : "Gemini"}
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 pt-1">
              <div><span className="text-muted-foreground">Ollama endpoint:</span> {data.ollama?.endpointUrl ?? "not configured"}</div>
              <div><span className="text-muted-foreground">Ollama model:</span> {data.ollama?.model ?? "not set"}</div>
              <div><span className="text-muted-foreground">Vision support:</span> {data.ollama?.visionSupport ?? "unknown"}</div>
              <div><span className="text-muted-foreground">Reachable:</span> {data.ollama?.reachable == null ? "not checked" : data.ollama.reachable ? "yes" : "no"}</div>
              <div><span className="text-muted-foreground">Gemini configured:</span> {data.gemini?.configured ? "yes" : "no"}</div>
            </div>
            {data.ollama?.reachabilityError && (
              <p className="text-red-600 pt-1">Last Ollama error: {data.ollama.reachabilityError}</p>
            )}
            {data.unavailableReason && (
              <p className="text-amber-700 pt-1">Reason no provider is active: {data.unavailableReason}</p>
            )}
          </>
        )}
        <Button size="sm" variant="ghost" className="h-6 text-xs px-2 mt-1" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCcw size={11} className={`mr-1 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>
    </details>
  );
}

// ── Draggable bookmarklet link (raw HTML so React doesn't strip javascript: href) ──
function BookmarkletLink({ billNumber }: { billNumber: string }) {
  const erpUrl = window.location.origin;
  const js = `(function(){const b='${erpUrl}/api/form-f/export-for-portal/${encodeURIComponent(billNumber)}';fetch(b,{headers:{'Authorization':'Bearer '+localStorage.getItem('erp_session')}}).then(r=>r.json()).then(d=>{const f=document.forms[0];if(!f)return alert('No form found');const set=(n,v)=>{const e=f.querySelector('[name*="'+n+'" i]')||f.querySelector('[id*="'+n+'" i]')||Array.from(f.elements).find(x=>x.name&&x.name.toLowerCase().includes(n.toLowerCase()));if(e)e.value=v||'';};set('centre',d.centreName);set('registration',d.registrationNo);set('patient',d.patientName);set('age',d.age);set('husband',d.husbandFatherName);set('address',d.address);set('mobile',d.mobile);set('referred',d.referredBy);set('lmp',d.lmpWeeks);set('doctor',d.doctorName);set('procedure',d.procedure);set('gestationalAge',(d.gestationalAgeWeeks||'')+'w '+(d.gestationalAgeDays||'')+'d');set('ultrasound',d.ultrasoundResult);set('abnormality',d.abnormality);set('date',d.procedureDate);alert('Form F fields filled. Please review and click Submit.')}).catch(e=>alert('Failed: '+e.message))})();`;
  const href = `javascript:${encodeURIComponent(js)}`;
  return (
    <div
      className="inline-block"
      dangerouslySetInnerHTML={{
        __html: `<a href="${href}" class="inline-block px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 cursor-move" draggable="true">Fill PCPNDT – ${billNumber || "Form F"}</a>`,
      }}
    />
  );
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(d: string) {
  if (!d) return "___________";
  const dt = new Date(d);
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// The live editing form only ever stores the literal category "normal" | "abnormal"
// in `ultrasoundResult` (see FormFData below) — the descriptive wire-format strings
// ("Normal (CRL: 65mm, ...)" / "Abnormal: <finding> (...)") only exist in API
// payloads (fetch-billing response, saved records, workspace prefill text). This
// parses one of those wire-format strings back into the category, the same way
// loadRecord() already does for saved records. Returns null when the text doesn't
// unambiguously start with "normal" or "abnormal" — callers must NOT default an
// unparseable result to "normal", since this is PCPNDT compliance data.
function categorizeUsgResult(text: string | null | undefined): "normal" | "abnormal" | null {
  const t = (text ?? "").trim().toLowerCase();
  if (t.startsWith("abnormal")) return "abnormal";
  if (t.startsWith("normal")) return "normal";
  return null;
}

type FormFData = {
  centreName: string;
  registrationNo: string;
  billNumber: string;
  patientName: string;
  age: string;
  boyCount: string;
  girlCount: string;
  husbandFatherName: string;
  address: string;
  mobile: string;
  referredBy: string;   // "Self" | "Doctor" | other
  referredByName: string;
  lmpType: string;        // "weeks" | "date" | "other"
  lmpWeeks: string;
  geneticHistory: string;   // "none" | "specify"
  geneticHistoryDetail: string;
  basisDiagnosisClinical: boolean;
  basisDiagnosisUsg: boolean;
  basisDiagnosisOther: string;
  indicationType: string;   // "routine" | "specify"
  indicationDetail: string;
  previousChildIssue: string;
  doctorName: string;
  doctorRegNo: string;
  procedure: string;
  procedurePurpose: string;
  invasiveProcedure: string;  // "notdone" | "done"
  invasiveProcedureDetail: string;
  complication: string;       // "nil" | "specify"
  complicationDetail: string;
  labTests: string;           // "notadvised" | "advised"
  labTestsDetail: string;
  gestationalAgeWeeks: string;
  gestationalAgeDays: string;
  ultrasoundResult: string;   // "normal" | "abnormal"
  abnormality: string;
  procedureDate: string;
  consentDate: string;
  resultConveyed: string;
  mtpAdvised: string;         // "no" | "yes"
  mtpDate: string;
  date: string;
  place: string;
  billId?: number;
  patientId?: number;
  fetalUsgStudyId?: number | null;
};

function defaultForm(): FormFData {
  return {
    centreName: "CARE DIAGNOSTICS\nSubhash Chowk, Castair's Town, Near Bajla Mahila College, Deoghar\u2013814112",
    registrationNo: "34/2020",
    billNumber: "",
    patientName: "",
    billId: undefined,
    patientId: undefined,
    fetalUsgStudyId: null,
    age: "",
    boyCount: "",
    girlCount: "",
    husbandFatherName: "",
    address: "",
    mobile: "",
    referredBy: "Self",
    referredByName: "",
    lmpType: "weeks",
    lmpWeeks: "",
    geneticHistory: "none",
    geneticHistoryDetail: "",
    basisDiagnosisClinical: true,
    basisDiagnosisUsg: true,
    basisDiagnosisOther: "",
    indicationType: "routine",
    indicationDetail: "",
    previousChildIssue: "",
    doctorName: "Dr. Sugandha Priyadarshini",
    doctorRegNo: "MCI/27962",
    procedure: "Ultrasound - ULTRASONOGRAPHY",
    procedurePurpose: "Obstetric ultrasonography",
    invasiveProcedure: "notdone",
    invasiveProcedureDetail: "",
    complication: "nil",
    complicationDetail: "",
    labTests: "notadvised",
    labTestsDetail: "",
    gestationalAgeWeeks: "",
    gestationalAgeDays: "",
    ultrasoundResult: "normal",
    abnormality: "",
    procedureDate: today(),
    consentDate: "",
    resultConveyed: "Patient / attendant — same day",
    mtpAdvised: "no",
    mtpDate: "",
    date: today(),
    place: "DEOGHAR",
  };
}

function Tick({ checked }: { checked: boolean }) {
  return (
    <span style={{ display: "inline-block", width: 11, height: 11, border: "1px solid #333", marginRight: 3, textAlign: "center", lineHeight: "11px", fontSize: 8, verticalAlign: "middle" }}>
      {checked ? "✓" : ""}
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr style={{ borderBottom: "1px solid #ccc" }}>
      <td style={{ padding: "2px 4px", fontWeight: 700, fontSize: 9, width: "30%", verticalAlign: "top", whiteSpace: "nowrap" }}>{label}</td>
      <td style={{ padding: "2px 4px", fontSize: 9, fontWeight: 700, verticalAlign: "top" }}>{children}</td>
    </tr>
  );
}

function BlankLine({ val, width = 120 }: { val: string; width?: number }) {
  return (
    <span style={{ display: "inline-block", borderBottom: "1px solid #333", minWidth: width, fontSize: 10, fontWeight: 800, paddingLeft: 2, verticalAlign: "bottom" }}>
      {val || "\u00A0"}
    </span>
  );
}

function LabelRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-[11px] font-semibold w-40 flex-shrink-0 text-gray-600 pt-1">{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function BigLabelRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-sm font-semibold w-44 flex-shrink-0 text-gray-700 pt-2">{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function FormRadio({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <label className="inline-flex items-center gap-1 cursor-pointer mr-3">
      <input type="radio" checked={checked} onChange={onChange} className="w-3 h-3" />
      <span className="text-xs">{label}</span>
    </label>
  );
}

function FormCheck({ checked, onChange, label }: { checked: boolean; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; label: string }) {
  return (
    <label className="inline-flex items-center gap-1 cursor-pointer mr-3">
      <input type="checkbox" checked={checked} onChange={onChange} className="w-3 h-3" />
      <span className="text-xs">{label}</span>
    </label>
  );
}

interface FormFPrintProps {
  form: FormFData;
  idCardFrontUrl?: string;
  idCardBackUrl?: string;
}

function FormFPrint({ form, idCardFrontUrl, idCardBackUrl }: FormFPrintProps) {
  return (
    <div
      id="formf-print"
      style={{
        width: "210mm",
        minHeight: "297mm",
        padding: "10mm 12mm 10mm 12mm",
        boxSizing: "border-box",
        fontFamily: "Arial, sans-serif",
        fontSize: 10,
        color: "#000",
        backgroundColor: "#fff",
        lineHeight: 1.5,
      }}
    >
      {/* ── HEADER ── */}
      <div style={{ textAlign: "center", borderBottom: "2px solid #000", paddingBottom: 6, marginBottom: 8 }}>
        <div style={{ fontSize: 18, fontWeight: 700, textDecoration: "underline", letterSpacing: 1 }}>FORM F</div>
        <div style={{ fontSize: 9, color: "#444", marginTop: 2 }}>[See Proviso to Section 4(3), Rule 9(4) and Rule 10(1A)]</div>
        <div style={{ fontSize: 11, fontWeight: 600, marginTop: 3 }}>
          FORM FOR MAINTENANCE OF RECORD IN RESPECT OF PREGNANT WOMAN<br />
          BY GENETIC CLINIC / ULTRASOUND CLINIC / IMAGING CENTRE
        </div>
      </div>

      {/* ── COLUMNS A + B ── */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 8 }}>
        <tbody>
          {/* Row 1: Centre + Reg No */}
          <tr style={{ borderBottom: "1px solid #ccc" }}>
            <td style={{ width: "55%", padding: "4px 6px", verticalAlign: "top", fontSize: 10 }}>
              <span style={{ fontWeight: 600 }}>1. Name &amp; address of Centre:&nbsp;</span>
              <span style={{ fontSize: 11, fontWeight: 700 }}>{form.centreName.replace(/\n/g, ", ")}</span>
            </td>
            <td style={{ padding: "4px 6px", verticalAlign: "top", fontSize: 10 }}>
              <span style={{ fontWeight: 600 }}>2. Reg. No.:&nbsp;</span>
              <BlankLine val={form.registrationNo} width={120} />
            </td>
          </tr>

          {/* Row 2: Patient + Age */}
          <tr style={{ borderBottom: "1px solid #ccc" }}>
            <td style={{ padding: "4px 6px", fontSize: 10 }}>
              <span style={{ fontWeight: 600 }}>3. Patient Name: </span>
              <BlankLine val={form.patientName} width={200} />
            </td>
            <td style={{ padding: "4px 6px", fontSize: 10 }}>
              <span style={{ fontWeight: 600 }}>Age: </span>
              <BlankLine val={form.age} width={70} />
              <span style={{ fontWeight: 600 }}> Yrs</span>
            </td>
          </tr>

          {/* Row 3: Husband/Father + Children */}
          <tr style={{ borderBottom: "1px solid #ccc" }}>
            <td style={{ padding: "4px 6px", fontSize: 10 }}>
              <span style={{ fontWeight: 600 }}>5. Husband's/Father's name: </span>
              <BlankLine val={form.husbandFatherName} width={180} />
            </td>
            <td style={{ padding: "4px 6px", fontSize: 10 }}>
              <span style={{ fontWeight: 600 }}>4. Children:&nbsp;</span>
              <span style={{ marginRight: 10 }}>
                Boy:&nbsp;
                <span style={{ display: "inline-block", border: "1px solid #333", width: 26, height: 18, textAlign: "center", fontSize: 11, lineHeight: "18px", verticalAlign: "middle" }}>
                  {form.boyCount || ""}
                </span>
              </span>
              <span>
                Girl:&nbsp;
                <span style={{ display: "inline-block", border: "1px solid #333", width: 26, height: 18, textAlign: "center", fontSize: 11, lineHeight: "18px", verticalAlign: "middle" }}>
                  {form.girlCount || ""}
                </span>
              </span>
            </td>
          </tr>

          {/* Row 4: Address + Phone */}
          <tr style={{ borderBottom: "1px solid #ccc" }}>
            <td style={{ padding: "4px 6px", fontSize: 10 }}>
              <span style={{ fontWeight: 600 }}>6. Address: </span>
              <BlankLine val={form.address} width={240} />
            </td>
            <td style={{ padding: "4px 6px", fontSize: 10 }}>
              <span style={{ fontWeight: 600 }}>Tel: </span>
              <BlankLine val={form.mobile} width={120} />
            </td>
          </tr>

          {/* Row 5: Referred by + LMP */}
          <tr style={{ borderBottom: "1px solid #ccc" }}>
            <td style={{ padding: "4px 6px", fontSize: 10 }}>
              <span style={{ fontWeight: 600 }}>7. Referred by:&nbsp;</span>
              <Tick checked={form.referredBy === "Self"} /> Self&nbsp;&nbsp;
              <Tick checked={form.referredBy === "Doctor"} /> Doctor: <BlankLine val={form.referredByName} width={100} />
            </td>
            <td style={{ padding: "4px 6px", fontSize: 10 }}>
              <span style={{ fontWeight: 600 }}>8. LMP/weeks: </span>
              <BlankLine val={form.lmpWeeks} width={120} />
            </td>
          </tr>

          {/* Row 6: Genetic history */}
          <tr style={{ borderBottom: "1px solid #ccc" }}>
            <td colSpan={2} style={{ padding: "4px 6px", fontSize: 10 }}>
              <span style={{ fontWeight: 600 }}>9. Genetic/medical history:&nbsp;</span>
              <Tick checked={form.geneticHistory === "none"} /> No significant history&nbsp;&nbsp;
              <Tick checked={form.geneticHistory === "specify"} /> Specify: <BlankLine val={form.geneticHistoryDetail} width={160} />
              &nbsp;&nbsp;<span style={{ fontWeight: 600 }}>Basis:&nbsp;</span>
              <Tick checked={form.basisDiagnosisClinical} /> Clinical&nbsp;
              <Tick checked={form.basisDiagnosisUsg} /> USG&nbsp;
              <Tick checked={!!form.basisDiagnosisOther} /> Other: <BlankLine val={form.basisDiagnosisOther} width={80} />
            </td>
          </tr>
        </tbody>
      </table>

      {/* ── SECTION 10 ── */}
      <div style={{ fontWeight: 700, fontSize: 10, textDecoration: "underline", marginBottom: 4 }}>
        10. Indication for pre-natal diagnosis
      </div>
      <div style={{ fontSize: 10, marginBottom: 6 }}>
        <Tick checked={form.indicationType === "routine"} /> Routine antenatal / clinical indication&nbsp;&nbsp;
        <Tick checked={form.indicationType === "age"} /> Advanced maternal age&nbsp;&nbsp;
        <Tick checked={form.indicationType === "genetic"} /> Genetic disease&nbsp;&nbsp;
        <Tick checked={form.indicationType === "previous"} /> Previous child issue: <BlankLine val={form.previousChildIssue} width={100} />
        &nbsp;&nbsp;<Tick checked={form.indicationType === "other"} /> Other: <BlankLine val={form.indicationDetail} width={100} />
      </div>

      {/* ── SECTION 11 ── */}
      <div style={{ fontWeight: 700, fontSize: 10, textDecoration: "underline", marginBottom: 4 }}>
        11. Procedures carried out
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 6 }}>
        <tbody>
          <tr style={{ borderBottom: "1px solid #ccc" }}>
            <td style={{ padding: "4px 6px", fontSize: 10, width: "50%" }}>
              <span style={{ fontWeight: 600 }}>Doctor/Radiologist: </span>
              <BlankLine val={form.doctorName} width={180} />
            </td>
            <td style={{ padding: "4px 6px", fontSize: 10 }}>
              <span style={{ fontWeight: 600 }}>Non-invasive procedure: </span>
              <BlankLine val={form.procedure} width={140} />
            </td>
          </tr>
          <tr style={{ borderBottom: "1px solid #ccc" }}>
            <td style={{ padding: "4px 6px", fontSize: 10 }}>
              <span style={{ fontWeight: 600 }}>Purpose: </span>
              <BlankLine val={form.procedurePurpose} width={200} />
            </td>
            <td style={{ padding: "4px 6px", fontSize: 10 }}>
              <span style={{ fontWeight: 600 }}>Invasive procedure:&nbsp;</span>
              <Tick checked={form.invasiveProcedure === "notdone"} /> Not done&nbsp;
              <Tick checked={form.invasiveProcedure === "done"} /> Done: <BlankLine val={form.invasiveProcedureDetail} width={80} />
            </td>
          </tr>
        </tbody>
      </table>

      {/* ── SECTIONS 12-19 ── */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 6 }}>
        <tbody>
          <Row label="12. Complication">
            <Tick checked={form.complication === "nil"} /> Nil&nbsp;&nbsp;
            <Tick checked={form.complication === "specify"} /> Specify: <BlankLine val={form.complicationDetail} width={140} />
          </Row>
          <Row label="13. Lab tests recommended">
            <Tick checked={form.labTests === "notadvised"} /> Not advised&nbsp;&nbsp;
            <Tick checked={form.labTests === "advised"} /> Advised: <BlankLine val={form.labTestsDetail} width={140} />
          </Row>
          <Row label="14(a). Gestational Age">
            <span style={{ fontSize: 11 }}>{form.gestationalAgeWeeks || "___"} weeks,&nbsp;{form.gestationalAgeDays || "___"} days</span>
          </Row>
          <Row label="14(b). USG result">
            <Tick checked={form.ultrasoundResult === "normal"} /> Normal&nbsp;&nbsp;
            <Tick checked={form.ultrasoundResult === "abnormal"} /> Abnormal: <BlankLine val={form.abnormality} width={160} />
          </Row>
          <Row label="15. Date of procedure">
            <BlankLine val={formatDate(form.procedureDate)} width={100} />
          </Row>
          <Row label="16. Consent date (invasive)">
            <BlankLine val={form.consentDate ? formatDate(form.consentDate) : "N/A"} width={100} />
          </Row>
          <Row label="17. Result conveyed to/date">
            <BlankLine val={form.resultConveyed} width={240} />
          </Row>
          <Row label="18. MTP advised/conducted">
            <Tick checked={form.mtpAdvised === "no"} /> No&nbsp;&nbsp;
            <Tick checked={form.mtpAdvised === "yes"} /> Yes
          </Row>
          <Row label="19. Date MTP carried out">
            <BlankLine val={form.mtpDate ? formatDate(form.mtpDate) : "N/A"} width={100} />
          </Row>
        </tbody>
      </table>

      {/* Date / Place / Signature */}
      <div style={{ display: "flex", gap: 20, marginBottom: 6, fontSize: 10 }}>
        <div><span style={{ fontWeight: 600 }}>Date: </span><BlankLine val={formatDate(form.date)} width={90} /></div>
        <div><span style={{ fontWeight: 600 }}>Place: </span><BlankLine val={form.place} width={100} /></div>
        <div style={{ flex: 1, textAlign: "right" }}>
          <span style={{ fontWeight: 600 }}>Signature &amp; Reg. No. of Doctor: </span>
          <BlankLine
            val={form.doctorRegNo ? `${form.doctorName} (Reg. ${form.doctorRegNo})` : form.doctorName}
            width={180}
          />
        </div>
      </div>

      {/* ── DECLARATION SECTION ── 2 columns side by side */}
      <div style={{ display: "flex", gap: 12, borderTop: "1.5px solid #666", paddingTop: 8 }}>
        {/* Declaration of pregnant woman */}
        <div style={{ flex: 1, border: "1px solid #aaa", padding: "6px 8px", borderRadius: 3 }}>
          <div style={{ fontWeight: 700, fontSize: 10, textAlign: "center", textDecoration: "underline", marginBottom: 5 }}>
            DECLARATION OF PREGNANT WOMAN
          </div>
          <p style={{ fontSize: 9, lineHeight: 1.5, margin: 0 }}>
            I, Ms. <BlankLine val={form.patientName} width={120} /> declare that by undergoing
            ultrasonography/image scanning etc. I do not want to know the sex of my foetus.
          </p>
          <div style={{ marginTop: 14, fontSize: 9 }}>
            Signature / Thumb impression: ______________________
          </div>
        </div>

        {/* Declaration of doctor */}
        <div style={{ flex: 1, border: "1px solid #aaa", padding: "6px 8px", borderRadius: 3 }}>
          <div style={{ fontWeight: 700, fontSize: 10, textAlign: "center", textDecoration: "underline", marginBottom: 5 }}>
            DECLARATION OF DOCTOR / PERSON CONDUCTING USG
          </div>
          <p style={{ fontSize: 9, lineHeight: 1.5, margin: 0 }}>
            I, <BlankLine val={form.doctorName} width={110} /> declare that while conducting
            ultrasonography on Ms. <BlankLine val={form.patientName} width={110} />, I have neither
            detected nor disclosed the sex of her foetus to anybody in any manner.
          </p>
          <div style={{ marginTop: 6, fontSize: 9, fontWeight: 700, textAlign: "center" }}>
            {form.doctorName}
          </div>
        </div>
      </div>

      {/* Footer note */}
      <div style={{ fontSize: 8, color: "#666", textAlign: "center", marginTop: 4 }}>
        *Strike out whichever is not applicable or not necessary* &nbsp;|&nbsp; Reg. No. {form.registrationNo}
        {form.billNumber ? ` | Bill No. ${form.billNumber}` : ""}
      </div>

      {/* ── ID Card Front & Back — sized to fit on same A4 page ── */}
      {(idCardFrontUrl || idCardBackUrl) && (
        <div style={{ marginTop: 8, borderTop: "1.5px dashed #999", paddingTop: 6 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: "#333", marginBottom: 4, textAlign: "center" }}>
            ID Proof attached — Original retained at clinic.
          </div>
          <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
            {idCardFrontUrl && (
              <div style={{ width: "85mm", height: "54mm", border: "1.5px solid #333", borderRadius: 3, overflow: "hidden", backgroundColor: "#f5f5f5" }}>
                <img
                  src={idCardFrontUrl}
                  alt="ID Front"
                  style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center" }}
                />
              </div>
            )}
            {idCardBackUrl && (
              <div style={{ width: "85mm", height: "54mm", border: "1.5px solid #333", borderRadius: 3, overflow: "hidden", backgroundColor: "#f5f5f5" }}>
                <img
                  src={idCardBackUrl}
                  alt="ID Back"
                  style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center" }}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

type RecordRow = {
  id: number;
  billId?: number;
  patientId?: number;
  billNumber?: string;
  patientName?: string;
  husbandFatherName?: string;
  mobile?: string;
  referredBy?: string;
  ultrasoundResult?: string;
  procedureDate?: string;
  date?: string;
  age?: string;
  address?: string;
  childrenDetails?: string;
  lmpWeeks?: string;
  geneticHistory?: string;
  basisDiagnosis?: string;
  indicationOther?: string;
  doctorName?: string;
  procedure?: string;
  procedurePurpose?: string;
  invasiveProcedure?: string;
  complication?: string;
  labTests?: string;
  gestationalAgeWeeks?: string;
  gestationalAgeDays?: string;
  abnormality?: string;
  consentDate?: string;
  resultConveyed?: string;
  mtpAdvised?: string;
  mtpDate?: string;
  place?: string;
  centreName?: string;
  registrationNo?: string;
  previousChildIssue?: string;
  idCardFrontUrl?: string | null;
  idCardBackUrl?: string | null;
  idCardImageUrl?: string | null;
  idCardExtractedName?: string | null;
  idCardExtractedAddress?: string | null;
  idCardVerified?: boolean | null;
  createdAt?: string;
};

type PendingItem = {
  billId: number;
  patientId: number;
  billNumber: string;
  billDate: string;
  patientName: string;
  mobile: string;
  address: string;
  age: string;
  referredBy: string;
  referredByName: string;
  formFTests: string[];
};

export default function FormF() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<"pending" | "form" | "records">("pending");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [form, setForm] = useState<FormFData>(defaultForm());

  // ── Explicit "prefill from Reporting Workspace" entry point ──
  // PCPNDT requirement: do NOT auto-fill Form F. A `?prefillUsgSummary=` (and
  // optional `?prefillFetalUsgStudyId=`) query param only stages the incoming
  // text here for radiologist review; nothing is written into `form` until
  // they explicitly click "Apply to Ultrasound Result" below.
  const [prefillSummary, setPrefillSummary] = useState<{ text: string; fetalUsgStudyId: number | null } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const summary = params.get("prefillUsgSummary");
    if (!summary) return;
    const studyIdRaw = params.get("prefillFetalUsgStudyId");
    const fetalUsgStudyId = studyIdRaw && /^\d+$/.test(studyIdRaw) ? Number(studyIdRaw) : null;
    setPrefillSummary({ text: summary, fetalUsgStudyId });
    setActiveTab("form");
  }, []);

  function applyPrefillSummary() {
    if (!prefillSummary) return;
    // The workspace hand-off (RadiologyReportingWorkspace.tsx's
    // reviewAndMapToFormF) deliberately sends a plain biometry summary
    // ("GA: 12w4d, CRL: 65 mm, ...") with NO "Normal"/"Abnormal" prefix —
    // categorizeUsgResult() can only recognize that prefix (the OTHER
    // producer, fetchFromBilling's legacy auto-populate text, always has
    // one). So `category` is normally null here by design: the radiologist
    // must still choose Normal/Abnormal themselves. What IS safe to lift
    // automatically is the objective Gestational Age figure (not a
    // diagnosis) — everything else stays exactly as typed by the user.
    const category = categorizeUsgResult(prefillSummary.text);
    const gaMatch = prefillSummary.text.match(/GA:\s*(\d+)\s*w\s*(\d+)\s*d/i);
    const appliedFields: string[] = [];
    if (category) appliedFields.push("Ultrasound Result");
    if (gaMatch) appliedFields.push("Gestational Age");
    if (prefillSummary.fetalUsgStudyId) appliedFields.push("Study link");

    setForm((prev) => ({
      ...prev,
      ultrasoundResult: category ?? prev.ultrasoundResult,
      abnormality:
        category === "abnormal"
          ? prefillSummary.text.replace(/^abnormal:?\s*/i, "").trim() || prev.abnormality
          : category === "normal"
            ? ""
            : prev.abnormality,
      gestationalAgeWeeks: gaMatch ? gaMatch[1] : prev.gestationalAgeWeeks,
      gestationalAgeDays: gaMatch ? gaMatch[2] : prev.gestationalAgeDays,
      fetalUsgStudyId: prefillSummary.fetalUsgStudyId ?? prev.fetalUsgStudyId,
    }));

    if (appliedFields.length > 0) {
      toast({
        title: `Applied: ${appliedFields.join(", ")}`,
        description: "Review the populated fields — you still need to select Normal/Abnormal and fill the rest before saving.",
      });
      setPrefillSummary(null);
    } else {
      // Nothing could be safely auto-extracted from this text (e.g. no GA
      // present) — say so honestly instead of a false "Applied" toast, and
      // keep the reference banner open so the text stays visible for
      // manual transcription.
      toast({
        title: "Nothing could be auto-filled from this summary",
        description: "Use the reference text above to fill in the Result and other fields manually, then dismiss the banner.",
        variant: "destructive",
      });
    }
  }

  // Gates the OCR provider diagnostics panel (item 13) — infra config, not
  // for general staff. readStaffSession() returns null when the ERP was
  // opened outside the staff-portal login flow, in which case we fail open
  // (show it) rather than hide diagnostics from an already-authenticated
  // direct session — requireStaffPermission("/form-f") on the backend route
  // is the real access control; this is just UI declutter.
  const staffRole = readStaffSession()?.user.role;
  const isFormFAdmin = !staffRole || staffRole === "admin" || staffRole === "super_admin";

  // ── Feature 2: ID Card Upload + AI OCR + Camera Scanner ──
  const [idCardFrontUrl, setIdCardFrontUrl] = useState("");
  const [idCardBackUrl, setIdCardBackUrl] = useState("");
  const [idCardExtractedName, setIdCardExtractedName] = useState("");
  const [idCardExtractedAddress, setIdCardExtractedAddress] = useState("");
  const [idCardVerified, setIdCardVerified] = useState(false);
  const [idCardUploading, setIdCardUploading] = useState(false);
  const [idCardOcrResult, setIdCardOcrResult] = useState<{
    guardianName?: string; address?: string; documentType?: string; confidence?: string; confidencePercent?: number;
    ocrProvider?: "gemini" | "ollama"; dob?: string; yearOfBirth?: string; age?: number; gender?: string; idNumber?: string;
  } | null>(null);
  // Last uploaded ID image, kept so "Retry OCR" can re-run without asking
  // staff to re-scan/re-upload the physical card.
  const [lastIdImage, setLastIdImage] = useState<{ base64: string; mimeType: string } | null>(null);
  const [ocrRetrying, setOcrRetrying] = useState(false);
  // Camera capture state (webcam only)
  const [cameraOpen, setCameraOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // OCR capture panel (new comprehensive capture modal)
  const [ocrPanelOpen, setOcrPanelOpen] = useState(false);
  // ID card scan editor panel (crop, rotate, adjust)
  const [scanPanelOpen, setScanPanelOpen] = useState(false);
  const [scanPanelBase64, setScanPanelBase64] = useState("");
  const [scanPanelMime, setScanPanelMime] = useState("image/jpeg");

  // ── PCPNDT Portal bookmarklet dialog ──
  const [portalOpen, setPortalOpen] = useState(false);

  async function runOcrOnImage(imageBase64: string, mimeType: string) {
    try {
      setLastIdImage({ base64: imageBase64, mimeType });
      await runIdCardOcr(imageBase64, mimeType);
    } catch {
      // OCR is optional; don't block the scan if it fails
    }
  }
  // ── Feature 5: Send WhatsApp to patient requesting ID card ──
  const [waSending, setWaSending] = useState(false);

  // Module B: PCPNDT Form F now auto-fills the conducting doctor's medical-council
  // registration number. We fetch the small doctor list once and expose it via a
  // <datalist> so staff can pick a saved doctor and have the reg no fill itself.
  const { data: doctorList } = useQuery<{ doctors: DoctorOption[]; total: number }>({
    queryKey: ["formf-doctors"],
    queryFn: () => api.get("/api/doctors?limit=200"),
    staleTime: 60_000,
  });

  // Clinic settings for Form F required-field toggles + scanner settings
  const { data: fSettings } = useQuery<{
    formFAddressRequired?: boolean;
    formFGuardianRequired?: boolean;
    autoCropIdScan?: boolean;
    autoRotateScan?: boolean;
    cropPadding?: number;
    jpegQuality?: number;
    maxScanWidth?: number;
  }>({
    queryKey: ["clinic-settings-formf"],
    queryFn: () => api.get("/api/clinic-settings"),
    staleTime: 60_000,
  });
  const guardianRequired = fSettings?.formFGuardianRequired !== false;
  const addressRequired = fSettings?.formFAddressRequired !== false;
  const doctorsForPick = doctorList?.doctors ?? [];
  const printRef = useRef<HTMLDivElement>(null);

  // Pending queue state
  const [pendingQueue, setPendingQueue] = useState<PendingItem[]>([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [pendingTestSearch, setPendingTestSearch] = useState("");
  const [pendingCategory, setPendingCategory] = useState("All Categories");
  const [pendingTests, setPendingTests] = useState<Array<{ id: number; name: string; code?: string | null; category?: string | null }>>([]);
  const [pendingTestsLoading, setPendingTestsLoading] = useState(false);
  const [pendingDateRange, setPendingDateRange] = useState<"today" | "yesterday" | "dayBefore" | "7days" | "all">("today");

  // Records tab state
  const [listSearch, setListSearch] = useState("");
  const [listSearchBy, setListSearchBy] = useState<"patientName"|"husbandFatherName"|"mobile"|"referredBy">("patientName");
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [listLoading, setListLoading] = useState(false);

  async function fetchFromBilling() {
    if (!search.trim()) {
      toast({ title: "Enter Bill No or UHID", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const data = await api.get<Record<string, string>>(
        `/api/form-f/fetch-billing/${encodeURIComponent(search.trim())}`
      );
      setForm((prev) => ({
        ...prev,
        billNumber: data.billNumber ?? prev.billNumber,
        patientName: data.patientName ?? prev.patientName,
        age: data.age ?? prev.age,
        husbandFatherName: data.husbandFatherName ?? prev.husbandFatherName,
        address: data.address ?? prev.address,
        mobile: data.mobile ?? prev.mobile,
        referredBy: data.referredBy ?? prev.referredBy,
        referredByName: data.referredByName ?? prev.referredByName,
        procedureDate: data.billDate ?? prev.procedureDate,
        date: data.billDate ?? prev.date,
        // data.ultrasoundResult is a descriptive wire-format string (e.g.
        // "Normal (CRL: 65mm, FHR: 140bpm)" or "Abnormal: <finding> (...)"),
        // never the literal "normal"/"abnormal" the radios below compare
        // against. Normalize it the same way loadRecord() does, so a
        // genuinely normal auto-populated scan can't silently save as
        // "Abnormal: " with an empty detail (see categorizeUsgResult above).
        ultrasoundResult: categorizeUsgResult(data.ultrasoundResult) ?? prev.ultrasoundResult,
        procedurePurpose: data.procedurePurpose ?? prev.procedurePurpose,
        lmpWeeks: data.lmpWeeks ?? prev.lmpWeeks,
        gestationalAgeWeeks: data.gestationalAgeWeeks ?? prev.gestationalAgeWeeks,
        gestationalAgeDays: data.gestationalAgeDays ?? prev.gestationalAgeDays,
        abnormality: data.abnormality ?? prev.abnormality,
        fetalUsgStudyId: data.fetalUsgStudyId ? Number(data.fetalUsgStudyId) : null,
      }));
      toast({ title: "Patient data loaded", description: `Bill: ${data.billNumber ?? search}` });
    } catch {
      toast({ title: "Not found", description: "No billing record matched", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  function set<K extends keyof FormFData>(key: K, value: FormFData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function inp(key: keyof FormFData) {
    return {
      value: form[key] as string,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(key, e.target.value as FormFData[typeof key]),
      className: "h-7 text-xs border-gray-300 px-2",
    };
  }

  // ── Runs OCR on an already-uploaded ID image and applies the result to
  // the review panel + (at high confidence) the form fields. Shared by the
  // initial scan/upload and the "Retry OCR" button, so both go through
  // identical field-population logic. ──
  async function runIdCardOcr(base64: string, mimeType: string) {
    const resp = await api.post<IdCardUploadResponse>("/api/form-f/upload-id", {
      formFId: 0,
      imageBase64: base64,
      mimeType,
    });
    setIdCardOcrResult(resp.ocr ?? null);
    if (resp.ocr?.guardianName) setIdCardExtractedName(resp.ocr.guardianName);
    if (resp.ocr?.address) setIdCardExtractedAddress(resp.ocr.address);
    // Auto-fill empty form fields from OCR only at the "auto" confidence
    // tier (>=95%) — see ocrConfidenceTier(). Below that, staff must
    // click "Use this" in the review panel; the `prev.field ||` guard
    // still ensures we never overwrite anything already typed.
    if (ocrConfidenceTier(resp.ocr?.confidencePercent) === "auto") {
      setForm((prev) => ({
        ...prev,
        husbandFatherName: prev.husbandFatherName || resp.ocr?.guardianName || prev.husbandFatherName,
        address: prev.address || resp.ocr?.address || prev.address,
      }));
    }
    toast(ocrOutcomeToast(resp.ocrOutcome, resp.ocrError));
    return resp;
  }

  // ── ID card image processing (shared by upload, UnifiedScanCapture, camera) ──
  async function processIdImage(file: Blob) {
    setIdCardUploading(true);
    try {
      // Preferred extraction order: Aadhaar QR data first (no server round
      // trip, no OCR cost), then OCR, then manual entry (existing editable
      // fields below are always available regardless of which path fires).
      const qr = await decodeQrFromBlob(file).catch(() => ({ format: "none" as const }));
      if (qr.format === "legacy-xml") {
        setIdCardExtractedName(qr.fields.name || "");
        setIdCardExtractedAddress(qr.fields.address || "");
        setForm((prev) => ({
          ...prev,
          husbandFatherName: prev.husbandFatherName || qr.fields.name || prev.husbandFatherName,
          address: prev.address || qr.fields.address || prev.address,
        }));
        setIdCardOcrResult({
          guardianName: qr.fields.name,
          address: qr.fields.address,
          documentType: "Aadhaar (QR)",
          confidence: "high",
          confidencePercent: 100, // deterministic QR decode, not a probabilistic OCR guess
        });
        const reader = new FileReader();
        reader.onload = () => {
          setIdCardFrontUrl(String(reader.result ?? ""));
          setIdCardUploading(false);
          toast({ title: "Aadhaar QR read successfully", description: `${qr.fields.name || "Details"} extracted from QR code — no OCR needed.` });
        };
        reader.readAsDataURL(file);
        return;
      }

      // A QR was detected but doesn't match the supported legacy-XML shape —
      // this is expected for UIDAI's newer "Secure QR" (compressed/signed
      // binary format, not yet implemented — see aadhaarSecureQr.ts). Tell
      // the user explicitly rather than silently proceeding to OCR, so
      // "why didn't the QR work?" has a visible answer instead of no signal
      // at all.
      if (qr.format === "unsupported") {
        toast({
          title: "QR code detected but not readable",
          description: "This looks like a newer Aadhaar Secure QR format, which isn't decoded yet — falling back to OCR text extraction instead.",
        });
      }

      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = String(reader.result ?? "");
        const base64 = dataUrl.split(",")[1];
        if (!base64) { toast({ title: "Failed to read image", variant: "destructive" }); setIdCardUploading(false); return; }
        setIdCardFrontUrl(dataUrl);
        setLastIdImage({ base64, mimeType: file.type });
        await runIdCardOcr(base64, file.type);
        setIdCardUploading(false);
      };
      reader.readAsDataURL(file);
    } catch { toast({ title: "Upload failed", variant: "destructive" }); setIdCardUploading(false); }
  }

  // ── Retry OCR — re-runs OCR on the already-uploaded ID image without
  // requiring staff to re-scan/re-upload the physical card. Useful when the
  // first attempt hit a transient Ollama-unreachable/timeout condition. ──
  async function retryOcr() {
    if (!lastIdImage) return;
    setOcrRetrying(true);
    try {
      await runIdCardOcr(lastIdImage.base64, lastIdImage.mimeType);
    } finally {
      setOcrRetrying(false);
    }
  }

  // ── ID card BACK side upload (no OCR, just stores image) ──
  async function processIdBackImage(file: File) {
    setIdCardUploading(true);
    try {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result ?? "");
        setIdCardBackUrl(dataUrl);
        toast({ title: "ID back side uploaded" });
        setIdCardUploading(false);
      };
      reader.readAsDataURL(file);
    } catch {
      setIdCardUploading(false);
      toast({ title: "Failed to process ID back image", variant: "destructive" });
    }
  }

  // ── Camera / scanner capture helpers ──
  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch {
      toast({ title: "Camera not available", description: "Check permissions or use Upload instead", variant: "destructive" });
      setCameraOpen(false);
    }
  }
  function stopCamera() {
    const stream = videoRef.current?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
  }
  function captureFromCamera() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.videoWidth === 0) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    // Route through scan panel for crop/enhance (same as scanner workflow)
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    const base64 = dataUrl.split(",")[1];
    stopCamera();
    setCameraOpen(false);
    setScanPanelBase64(base64);
    setScanPanelMime("image/jpeg");
    setScanPanelOpen(true);
    toast({ title: "Webcam image captured — adjust crop and enhancement before saving" });
  }

  const fetchPending = useCallback(async () => {
    setPendingLoading(true);
    try {
      const params = new URLSearchParams();
      if (pendingDateRange !== "all") params.set("dateRange", pendingDateRange);
      const data = await api.get<PendingItem[]>(`/api/form-f/pending?${params.toString()}`);
      setPendingQueue(data);
    } catch {
      setPendingQueue([]);
    } finally {
      setPendingLoading(false);
    }
  }, [pendingDateRange]);

  const fetchPendingTests = useCallback(async (q = "") => {
    setPendingTestsLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      const data = await api.get<Array<{ id: number; name: string; code?: string | null; category?: string | null }>>(`/api/form-f/pending-tests?${params.toString()}`);
      setPendingTests(
        pendingCategory === "All Categories"
          ? data
          : data.filter((t) => (t.category ?? "Uncategorized") === pendingCategory)
      );
    } catch {
      setPendingTests([]);
    } finally {
      setPendingTestsLoading(false);
    }
  }, [pendingCategory]);

  const fetchRecords = useCallback(async (q?: string, by?: string) => {
    setListLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) { params.set("search", q); params.set("searchBy", by ?? "patientName"); }
      const data = await api.get<RecordRow[]>(`/api/form-f/list?${params.toString()}`);
      setRecords(data);
    } catch {
      setRecords([]);
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "records") fetchRecords();
    if (activeTab === "pending") fetchPending();
  }, [activeTab, fetchRecords, fetchPending]);

  useEffect(() => { fetchPending(); }, [fetchPending]);
  useEffect(() => {
    if (activeTab === "pending") fetchPendingTests(pendingTestSearch);
  }, [activeTab, pendingTestSearch, fetchPendingTests]);

  // ── Start camera when scanner modal opens ──
  useEffect(() => {
    if (cameraOpen) {
      startCamera();
    }
    return () => { stopCamera(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOpen]);

  function openFromQueue(item: PendingItem) {
    setForm({
      ...defaultForm(),
      billNumber: item.billNumber,
      patientName: item.patientName,
      age: item.age,
      address: item.address,
      mobile: item.mobile,
      referredBy: item.referredBy,
      referredByName: item.referredByName,
      procedurePurpose: item.formFTests.join(", ") || "Obstetric ultrasonography",
      procedureDate: item.billDate,
      date: item.billDate,
      billId: item.billId,
      patientId: item.patientId,
    });
    setLastSaved(null);
    setActiveTab("form");
    toast({ title: `Form F opened for ${item.patientName}`, description: "Fill remaining fields and print to save." });
  }

  function loadRecord(r: RecordRow) {
    const ref = r.referredBy ?? "Self";
    const isDoctor = ref.startsWith("Doctor");
    const doctorName = isDoctor ? ref.replace(/^Doctor:\s*/, "") : "";
    const children = r.childrenDetails ?? "";
    const boyMatch = children.match(/Boy:\s*(\d+)/i);
    const girlMatch = children.match(/Girl:\s*(\d+)/i);
    setForm({
      ...defaultForm(),
      centreName: r.centreName ?? defaultForm().centreName,
      registrationNo: r.registrationNo ?? defaultForm().registrationNo,
      billNumber: r.billNumber ?? "",
      patientName: r.patientName ?? "",
      age: r.age ?? "",
      boyCount: boyMatch ? boyMatch[1] : "",
      girlCount: girlMatch ? girlMatch[1] : "",
      husbandFatherName: r.husbandFatherName ?? "",
      address: r.address ?? "",
      mobile: r.mobile ?? "",
      referredBy: isDoctor ? "Doctor" : "Self",
      referredByName: doctorName,
      ...(() => {
        const lmp = r.lmpWeeks ?? "";
        if (/^\d{4}-\d{2}-\d{2}$/.test(lmp)) return { lmpType: "date" as const, lmpWeeks: lmp };
        if (/ weeks?$/.test(lmp)) return { lmpType: "weeks" as const, lmpWeeks: lmp.replace(/ weeks?$/, "") };
        if (lmp) return { lmpType: "other" as const, lmpWeeks: lmp };
        return { lmpType: "weeks" as const, lmpWeeks: "" };
      })(),
      previousChildIssue: r.previousChildIssue ?? "",
      doctorName: r.doctorName ?? "",
      procedure: r.procedure ?? "",
      procedurePurpose: r.procedurePurpose ?? "",
      invasiveProcedure: r.invasiveProcedure === "Not done" ? "notdone" : "done",
      invasiveProcedureDetail: r.invasiveProcedure !== "Not done" ? (r.invasiveProcedure ?? "") : "",
      complication: r.complication === "Nil" ? "nil" : "specify",
      complicationDetail: r.complication !== "Nil" ? (r.complication ?? "") : "",
      labTests: r.labTests === "Not advised" ? "notadvised" : "advised",
      labTestsDetail: r.labTests !== "Not advised" ? (r.labTests ?? "") : "",
      gestationalAgeWeeks: r.gestationalAgeWeeks ?? "",
      gestationalAgeDays: r.gestationalAgeDays ?? "",
      ultrasoundResult: r.ultrasoundResult?.startsWith("Abnormal") ? "abnormal" : "normal",
      abnormality: r.abnormality ?? "",
      procedureDate: r.procedureDate ?? "",
      consentDate: r.consentDate ?? "",
      resultConveyed: r.resultConveyed ?? "",
      mtpAdvised: r.mtpAdvised === "Yes" ? "yes" : "no",
      mtpDate: r.mtpDate ?? "",
      date: r.date ?? "",
      place: r.place ?? "",
      billId: r.billId ?? undefined,
      patientId: r.patientId ?? undefined,
    });
    setIdCardFrontUrl(r.idCardFrontUrl ?? r.idCardImageUrl ?? "");
    setIdCardBackUrl(r.idCardBackUrl ?? "");
    setIdCardExtractedName(r.idCardExtractedName ?? "");
    setIdCardExtractedAddress(r.idCardExtractedAddress ?? "");
    setIdCardVerified(r.idCardVerified ?? false);
    setActiveTab("form");
    toast({ title: "Record loaded into form" });
  }

  async function saveFormF(silent = false) {
    setSaving(true);
    try {
      const payload = {
        billNumber: form.billNumber,
        centreName: form.centreName,
        registrationNo: form.registrationNo,
        patientName: form.patientName,
        age: form.age,
        childrenDetails: [form.boyCount ? `Boy: ${form.boyCount}` : "", form.girlCount ? `Girl: ${form.girlCount}` : ""].filter(Boolean).join(", ") || "Not specified",
        husbandFatherName: form.husbandFatherName,
        address: form.address,
        mobile: form.mobile,
        referredBy: form.referredBy === "Doctor" ? `Doctor: ${form.referredByName}` : "Self",
        lmpWeeks: form.lmpType === "weeks" ? `${form.lmpWeeks} weeks` : form.lmpType === "date" ? form.lmpWeeks : form.lmpWeeks,
        geneticHistory: form.geneticHistory === "none" ? "No significant history" : form.geneticHistoryDetail,
        basisDiagnosis: [form.basisDiagnosisClinical && "Clinical", form.basisDiagnosisUsg && "USG", form.basisDiagnosisOther].filter(Boolean).join(", "),
        previousChildIssue: form.previousChildIssue || "Not applicable",
        indicationOther: form.indicationType === "routine" ? "Routine antenatal" : form.indicationDetail,
        doctorName: form.doctorName,
        procedure: form.procedure,
        procedurePurpose: form.procedurePurpose,
        invasiveProcedure: form.invasiveProcedure === "notdone" ? "Not done" : form.invasiveProcedureDetail,
        complication: form.complication === "nil" ? "Nil" : form.complicationDetail,
        labTests: form.labTests === "notadvised" ? "Not advised" : form.labTestsDetail,
        gestationalAgeWeeks: form.gestationalAgeWeeks,
        gestationalAgeDays: form.gestationalAgeDays,
        ultrasoundResult: form.ultrasoundResult === "normal" ? "Normal" : `Abnormal: ${form.abnormality}`,
        abnormality: form.abnormality,
        procedureDate: form.procedureDate,
        consentDate: form.consentDate,
        resultConveyed: form.resultConveyed,
        mtpAdvised: form.mtpAdvised === "no" ? "No" : "Yes",
        mtpDate: form.mtpDate,
        date: form.date,
        place: form.place,
        idCardFrontUrl: idCardFrontUrl || null,
        idCardBackUrl: idCardBackUrl || null,
        idCardExtractedName: idCardExtractedName || null,
        idCardExtractedAddress: idCardExtractedAddress || null,
        idCardVerified: idCardVerified || false,
        fetalUsgStudyId: form.fetalUsgStudyId ?? null,
        billId: form.billId,
        patientId: form.patientId,
      };
      await api.post("/api/form-f/save", payload);
      const now = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
      setLastSaved(now);
      if (!silent) toast({ title: "Form F saved to database" });
      void fetchPending();
    } catch {
      if (!silent) toast({ title: "Failed to save Form F", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function printAndSave() {
    await saveFormF(true);
    printForm();
  }

  function printForm() {
    const printArea = document.getElementById("formf-print");
    if (!printArea) return;
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) { window.print(); return; }
    w.document.write(`
      <!DOCTYPE html><html><head>
      <title>Form F - PCPNDT</title>
      <style>
        @page { size: A4; margin: 0; }
        body { margin: 0; padding: 0; }
        * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      </style>
      </head><body>
      ${printArea.outerHTML}
      <script>window.onload=()=>{window.print();window.close();}<\/script>
      </body></html>`);
    w.document.close();
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-gray-50">
      {/* Top bar */}
      <div className="flex-shrink-0 bg-white border-b border-gray-200 px-4 py-2 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <FileText size={18} className="text-blue-600" />
          <div>
            <div className="font-bold text-sm">Form F — PCPNDT</div>
            <div className="text-[10px] text-gray-500">Record for Pregnant Woman (Ultrasound / Imaging Centre)</div>
          </div>
        </div>

        {/* Tab buttons */}
        <div className="flex rounded-lg border border-gray-200 overflow-hidden">
          <button
            onClick={() => setActiveTab("pending")}
            className={`px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors ${activeTab === "pending" ? "bg-orange-500 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
          >
            <Users size={12} />
            Pending Queue
            {pendingQueue.length > 0 && (
              <span className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold ${activeTab === "pending" ? "bg-white text-orange-600" : "bg-orange-500 text-white"}`}>
                {pendingQueue.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("form")}
            className={`px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors border-l border-gray-200 ${activeTab === "form" ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
          >
            <FileText size={12} /> Fill Form
          </button>
          <button
            onClick={() => setActiveTab("records")}
            className={`px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors border-l border-gray-200 ${activeTab === "records" ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
          >
            <List size={12} /> Saved Records
          </button>
        </div>

        {activeTab === "form" && (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
              <span className="text-[10px] text-amber-700 font-medium">Incidental finding?</span>
            </div>
            <div className="flex items-center gap-2">
              <Input
                placeholder="Bill No / UHID / Name to fetch…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && fetchFromBilling()}
                className="h-8 text-xs w-52"
              />
              <Button size="sm" onClick={fetchFromBilling} disabled={loading} className="h-8 text-xs flex-shrink-0">
                <Search size={12} className="mr-1" />{loading ? "…" : "Fetch"}
              </Button>
            </div>
          </div>
        )}

        {activeTab === "form" && (
          <div className="ml-auto flex items-center gap-2">
            {lastSaved && (
              <span className="text-[10px] text-green-600 bg-green-50 border border-green-200 rounded px-2 py-1">
                ✓ Auto-saved {lastSaved}
              </span>
            )}
            {activeTab === "form" && form.mobile && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs border-green-300 bg-green-50 hover:bg-green-100 text-green-700"
                disabled={waSending}
                onClick={async () => {
                  setWaSending(true);
                  try {
                    const resp = await api.post<{ ok: boolean; messageId?: string }>("/api/form-f/send-whatsapp", {
                      mobile: form.mobile,
                      patientName: form.patientName,
                    });
                    if (resp.ok) {
                      toast({ title: "WhatsApp sent", description: `Message sent to ${form.mobile}. Patient can reply with ID card photo.` });
                    } else {
                      toast({ title: "Send failed", description: "Could not send WhatsApp message.", variant: "destructive" });
                    }
                  } catch {
                    toast({ title: "Send failed", description: "Could not send WhatsApp message.", variant: "destructive" });
                  } finally {
                    setWaSending(false);
                  }
                }}
              >
                <MessageCircle size={12} className="mr-1" />{waSending ? "Sending…" : "Request ID Card"}
              </Button>
            )}
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => { setForm(defaultForm()); setLastSaved(null); setIdCardFrontUrl(""); setIdCardBackUrl(""); setIdCardExtractedName(""); setIdCardExtractedAddress(""); setIdCardVerified(false); setIdCardOcrResult(null); }}>
              <RefreshCcw size={12} className="mr-1" /> Reset
            </Button>
            <Button size="sm" className="h-8 text-xs" onClick={printAndSave} disabled={saving}>
              <Printer size={12} className="mr-1" /> {saving ? "Saving…" : "Print A4"}
            </Button>
            <Button variant="secondary" size="sm" className="h-8 text-xs" onClick={() => setPortalOpen(true)} disabled={!form.billNumber}>
              <ExternalLink size={12} className="mr-1" /> PCPNDT Portal
            </Button>
          </div>
        )}
      </div>

      {/* ── PCPNDT Portal Bookmarklet Dialog ── */}
      <Dialog open={portalOpen} onOpenChange={setPortalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Upload to PCPNDT Government Portal</DialogTitle>
            <DialogDescription>
              This bookmarklet pre-fills the Jharkhand PCPNDT portal using your saved Form F data.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <div className="rounded-md border p-3 bg-amber-50 border-amber-200">
              <p className="font-medium text-amber-800 mb-1">How it works</p>
              <ol className="list-decimal list-inside text-amber-700 space-y-1">
                <li>Save your Form F record in the ERP first (click "Save" above).</li>
                <li>Drag the button below to your browser bookmarks bar.</li>
                <li>Open the PCPNDT portal: <a href="http://pcpndt.jharkhand.gov.in/secured/form-f/form-f-step1.jsp" target="_blank" rel="noopener noreferrer" className="underline text-blue-600">pcpndt.jharkhand.gov.in</a></li>
                <li>Log in to the portal, then click the bookmarklet — it fills the form automatically.</li>
                <li>Review the fields, then click <b>Submit</b> manually on the portal.</li>
              </ol>
            </div>

            <div>
              <p className="font-medium mb-2">1. Drag this button to your bookmarks bar:</p>
              <BookmarkletLink billNumber={form.billNumber} />
            </div>

            <div className="rounded-md border p-3 bg-gray-50">
              <p className="font-medium text-gray-700 mb-1">2. Alternative: copy-paste script</p>
              <p className="text-xs text-gray-500 mb-2">
                If drag doesn't work, open the portal, press F12 → Console, paste this, and press Enter:
              </p>
              <pre className="text-xs bg-gray-900 text-green-400 p-3 rounded overflow-x-auto whitespace-pre-wrap break-all">
{(() => {
  const erpUrl = window.location.origin;
  const bill = form.billNumber;
  return `fetch('${erpUrl}/api/form-f/export-for-portal/${encodeURIComponent(bill)}',{headers:{'Authorization':'Bearer '+localStorage.getItem('erp_session')}}).then(r=>r.json()).then(d=>{const f=document.forms[0];const set=(n,v)=>{const e=f.querySelector('[name*="'+n+'" i]')||f.querySelector('[id*="'+n+'" i]')||Array.from(f.elements).find(x=>x.name&&x.name.toLowerCase().includes(n.toLowerCase()));if(e)e.value=v||'';};set('centre',d.centreName);set('registration',d.registrationNo);set('patient',d.patientName);set('age',d.age);set('husband',d.husbandFatherName);set('address',d.address);set('mobile',d.mobile);set('referred',d.referredBy);set('doctor',d.doctorName);set('procedure',d.procedure);set('date',d.procedureDate);alert('Filled! Review and Submit.')}).catch(e=>alert('Error: '+e.message))`;
})()}
              </pre>
            </div>

            <p className="text-xs text-gray-500">
              Note: The government portal has no API. This bookmarklet only fills fields — you must still click Submit manually for compliance.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── PENDING QUEUE TAB ── */}
      {activeTab === "pending" && (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="max-w-4xl mx-auto space-y-4">
            {/* Header */}
            <div className="flex flex-wrap items-end gap-3 justify-between">
              <div>
                <h2 className="text-base font-bold text-gray-800">Pending Form F Queue</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Patients billed for PCPNDT-required tests who need a Form F filled. Click any row to open the form.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {/* Date range filter */}
                <div className="flex rounded-md border border-gray-200 overflow-hidden text-[11px]">
                  {[
                    { key: "today" as const, label: "Today" },
                    { key: "yesterday" as const, label: "Yesterday" },
                    { key: "dayBefore" as const, label: "Day Before" },
                    { key: "7days" as const, label: "7 Days" },
                    { key: "all" as const, label: "All" },
                  ].map((btn) => (
                    <button
                      key={btn.key}
                      onClick={() => setPendingDateRange(btn.key)}
                      className={`px-2.5 py-1.5 font-medium transition-colors ${
                        pendingDateRange === btn.key
                          ? "bg-blue-600 text-white"
                          : "bg-white text-gray-600 hover:bg-gray-50"
                      } border-r border-gray-200 last:border-r-0`}
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>
                <Button size="sm" variant="outline" className="h-8 text-xs" onClick={fetchPending} disabled={pendingLoading}>
                  <RefreshCcw size={12} className={`mr-1 ${pendingLoading ? "animate-spin" : ""}`} />
                  {pendingLoading ? "Refreshing…" : "Refresh"}
                </Button>
              </div>
            </div>

            {pendingLoading ? (
              <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-sm text-gray-400">
                Loading pending patients…
              </div>
            ) : pendingTestsLoading ? (
              <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-sm text-gray-400">
                Loading tests…
              </div>
            ) : pendingTests.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-sm text-gray-400">
                No tests match.
              </div>
            ) : pendingQueue.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                <div className="text-4xl mb-3">✓</div>
                <div className="font-semibold text-gray-700 text-sm">All caught up!</div>
                <div className="text-xs text-gray-400 mt-1">No pending Form F patients found.</div>
                <div className="text-xs text-gray-400 mt-1">
                  Make sure PCPNDT tests are marked in Settings → Form F Tests.
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="bg-orange-50 border-b border-orange-100 px-4 py-2 flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-orange-500 text-white text-[10px] font-bold">{pendingQueue.length}</span>
                  <span className="text-xs font-semibold text-orange-700">patients awaiting Form F</span>
                </div>
                <div className="border-b border-gray-100 px-4 py-3 flex flex-wrap gap-2">
                  {pendingTests.map((t) => (
                    <button
                      key={t.id}
                      className="px-3 py-1 rounded-full border border-gray-200 text-xs bg-white hover:bg-gray-50"
                    >
                      {t.code ? `${t.code} — ` : ""}
                      {t.name}
                    </button>
                  ))}
                </div>
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-semibold text-gray-600">Billing Date</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-gray-600">Patient Name</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-gray-600">Mobile</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-gray-600">PCPNDT Test(s)</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-gray-600">Bill No.</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-gray-600">Referred By</th>
                      <th className="px-4 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingQueue.map((item, i) => (
                      <tr
                        key={item.billId}
                        onClick={() => openFromQueue(item)}
                        className={`border-b border-gray-50 hover:bg-blue-50 cursor-pointer transition-colors group ${i % 2 === 0 ? "bg-white" : "bg-gray-50/40"}`}
                      >
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                          {item.billDate ? new Date(item.billDate).toLocaleDateString("en-IN") : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-gray-800">{item.patientName || "—"}</div>
                          {item.age && <div className="text-[10px] text-gray-400">Age: {item.age} yrs</div>}
                        </td>
                        <td className="px-4 py-3 text-gray-600">{item.mobile || "—"}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {item.formFTests.map((t) => (
                              <span key={t} className="bg-purple-100 text-purple-700 text-[10px] font-medium px-1.5 py-0.5 rounded-full border border-purple-200">
                                {t}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-500 font-mono text-[11px]">{item.billNumber}</td>
                        <td className="px-4 py-3 text-gray-500">
                          {item.referredBy === "Doctor" ? (
                            <span className="bg-blue-50 text-blue-700 text-[10px] px-1.5 py-0.5 rounded border border-blue-100">Dr. {item.referredByName}</span>
                          ) : (
                            <span className="text-gray-400 text-[10px]">Self / Walk-in</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-blue-600 font-semibold text-xs group-hover:underline whitespace-nowrap">Fill Form →</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Incidental finding notice */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-3">
              <span className="text-lg mt-0.5">💡</span>
              <div>
                <div className="text-xs font-semibold text-amber-800">Incidental pregnancy finding?</div>
                <div className="text-xs text-amber-700 mt-0.5">
                  If pregnancy was discovered during a routine test (e.g. USG Whole Abdomen) not in the list above,
                  click <button onClick={() => setActiveTab("form")} className="underline font-semibold">Fill Form</button> and use the Fetch option to load the patient by bill number or name.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── RECORDS TAB ── */}
      {activeTab === "records" && (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="max-w-5xl mx-auto">
            {/* Search bar */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-semibold text-gray-700">Search records by:</span>
                <div className="flex gap-1">
                  {([
                    { val: "patientName",      label: "Patient",  icon: <User size={11} /> },
                    { val: "husbandFatherName",label: "Husband",  icon: <Users size={11} /> },
                    { val: "mobile",           label: "Mobile",   icon: <Phone size={11} /> },
                    { val: "referredBy",       label: "Ref. By",  icon: <BookOpen size={11} /> },
                  ] as const).map(({ val, label, icon }) => (
                    <button
                      key={val}
                      onClick={() => setListSearchBy(val)}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${listSearchBy === val ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"}`}
                    >
                      {icon} {label}
                    </button>
                  ))}
                </div>
                <div className="flex-1 flex items-center gap-2 min-w-48">
                  <Input
                    placeholder={`Search by ${listSearchBy === "patientName" ? "patient name" : listSearchBy === "husbandFatherName" ? "husband/father name" : listSearchBy === "mobile" ? "mobile number" : "referred by"}…`}
                    value={listSearch}
                    onChange={(e) => setListSearch(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && fetchRecords(listSearch, listSearchBy)}
                    className="h-8 text-xs"
                  />
                  <Button size="sm" className="h-8 text-xs" onClick={() => fetchRecords(listSearch, listSearchBy)} disabled={listLoading}>
                    <Search size={12} className="mr-1" />{listLoading ? "…" : "Search"}
                  </Button>
                  {listSearch && (
                    <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { setListSearch(""); fetchRecords(); }}>
                      Clear
                    </Button>
                  )}
                </div>
                <span className="text-xs text-gray-400">{records.length} record{records.length !== 1 ? "s" : ""}</span>
              </div>
            </div>

            {/* Table */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              {listLoading ? (
                <div className="p-8 text-center text-sm text-gray-400">Loading…</div>
              ) : records.length === 0 ? (
                <div className="p-8 text-center text-sm text-gray-400">No records found. {listSearch ? "Try a different search." : "Save a Form F to see it here."}</div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="text-left px-3 py-2.5 font-semibold text-gray-600">Date</th>
                      <th className="text-left px-3 py-2.5 font-semibold text-gray-600">Patient Name</th>
                      <th className="text-left px-3 py-2.5 font-semibold text-gray-600">Husband/Father</th>
                      <th className="text-left px-3 py-2.5 font-semibold text-gray-600">Mobile</th>
                      <th className="text-left px-3 py-2.5 font-semibold text-gray-600">Bill No.</th>
                      <th className="text-left px-3 py-2.5 font-semibold text-gray-600">USG Result</th>
                      <th className="text-left px-3 py-2.5 font-semibold text-gray-600">Referred By</th>
                      <th className="px-3 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((r, i) => (
                      <tr
                        key={r.id}
                        className={`border-b border-gray-50 hover:bg-blue-50 cursor-pointer transition-colors ${i % 2 === 0 ? "bg-white" : "bg-gray-50/50"}`}
                        onClick={() => loadRecord(r)}
                      >
                        <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                          {r.procedureDate ? new Date(r.procedureDate).toLocaleDateString("en-IN") : r.date ? new Date(r.date).toLocaleDateString("en-IN") : "—"}
                        </td>
                        <td className="px-3 py-2 font-medium text-gray-800">{r.patientName || "—"}</td>
                        <td className="px-3 py-2 text-gray-600">{r.husbandFatherName || "—"}</td>
                        <td className="px-3 py-2 text-gray-600">{r.mobile || "—"}</td>
                        <td className="px-3 py-2 text-gray-500">{r.billNumber || "—"}</td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${r.ultrasoundResult?.startsWith("Abnormal") ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>
                            {r.ultrasoundResult || "Normal"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-gray-600">{r.referredBy || "Self"}</td>
                        <td className="px-3 py-2 text-right">
                          <span className="text-blue-600 font-medium hover:underline">Open →</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === "form" && <div className="flex-1 overflow-y-auto p-4">
        {prefillSummary && (
          <div className="mb-4 bg-blue-50 border border-blue-200 rounded-xl p-4 shadow-sm flex flex-col gap-3 max-w-full">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2">
                <FileText size={16} className="text-blue-600 mt-0.5 flex-shrink-0" />
                <div>
                  <div className="text-sm font-bold text-blue-900">Measurement summary from Reporting Workspace</div>
                  <div className="text-xs text-blue-700">A measurement summary was passed from the Reporting Workspace. Review and apply it below before saving.</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPrefillSummary(null)}
                className="text-blue-400 hover:text-blue-700 flex-shrink-0"
                aria-label="Dismiss"
              >
                <X size={16} />
              </button>
            </div>
            <div className="bg-white border border-blue-100 rounded-lg px-3 py-2 text-xs text-gray-700 whitespace-pre-wrap">
              {prefillSummary.text}
            </div>
            <div>
              <Button size="sm" onClick={applyPrefillSummary} className="h-8 text-xs bg-blue-600 hover:bg-blue-700">
                Apply to Ultrasound Result
              </Button>
            </div>
          </div>
        )}
        <div className="flex gap-4 max-w-full">

          {/* ── LEFT: Edit Form (two sections) ── */}
          <div className="flex-1 space-y-3">
            {/* Section 0: PATIENT FROM BILL — auto-filled, mobile editable */}
            <div className="bg-indigo-50/60 border border-indigo-100 rounded-xl p-4 shadow-sm">
              <div className="flex items-center gap-2 pb-2 border-b border-indigo-100 mb-3">
                <User size={14} className="text-indigo-600" />
                <span className="text-sm font-bold text-indigo-800">Patient from Bill</span>
                <span className="text-[10px] bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">Auto-filled from bill · Editable</span>
              </div>
              <div className="space-y-3">
                <div className="flex gap-3">
                  <LabelRow label="Patient Name *">
                    <Input {...inp("patientName")} placeholder="Auto-filled from bill — editable for spelling correction" className="text-sm h-9" />
                  </LabelRow>
                  <LabelRow label="Age *">
                    <Input {...inp("age")} placeholder="Auto-filled — editable if wrong" className="text-sm h-9 w-28" />
                  </LabelRow>
                </div>
                <LabelRow label="Mobile *">
                  <div className="flex gap-2">
                    <Input {...inp("mobile")} placeholder="Mobile (editable — staff may enter dummy numbers)" className="text-sm h-9 flex-1" />
                    {form.mobile && !/^\d{10}$/.test(form.mobile.replace(/\D/g, "")) && (
                      <span className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1 self-center whitespace-nowrap">
                        Looks like dummy — verify
                      </span>
                    )}
                  </div>
                </LabelRow>
              </div>
            </div>

            {/* Section 1: DETAILS TO FILL — BIG BOX, BIG FONTS */}
            <div className="bg-white border-2 border-orange-200 rounded-xl p-6 shadow-md">
              <div className="flex items-center gap-2 pb-3 border-b-2 border-orange-100 mb-4">
                <span className="text-base font-extrabold text-gray-900">Details to Fill</span>
                <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-semibold">Type these fields</span>
              </div>
              <div className="space-y-5">
                <BigLabelRow label={`Husband / Father Name ${guardianRequired ? "*" : ""}`}>
                  <div className="flex flex-col gap-2">
                    {/* Row 1: Full-width input */}
                    <Input
                      {...inp("husbandFatherName")}
                      placeholder={guardianRequired ? "Required for PCPNDT" : "Optional — enter if available"}
                      className="w-full text-base h-11"
                    />
                    {/* Row 2: ID-capture — unified scan dialog (TVS PDS 8M / Existing
                        Scanner / Upload / Mobile Scan / Webcam) replaces the old
                        6-button menu (Wireless/Smart Scan, Upload ID, Capture ID
                        Direct Scan, Webcam, Import Latest Scan, Open Scanner App).
                        Back-side capture stays a plain upload — it has no OCR and
                        never needed the full option set. */}
                    <div className="flex flex-wrap items-center gap-2">
                      <UnifiedScanCapture
                        module="form-f"
                        docType="id-card"
                        triggerLabel={idCardUploading ? "Scanning…" : "Scan ID Front"}
                        onCapture={async (result) => { await processIdImage(result.file); }}
                        onError={(msg) => toast({ title: "Scan failed", description: msg, variant: "destructive" })}
                      />
                      {/* ── Upload ID Back (file picker) — back side has no OCR ── */}
                      <label className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-md border border-dashed border-orange-300 bg-orange-50 cursor-pointer text-sm font-medium transition-colors ${idCardUploading ? "opacity-60 cursor-wait" : "hover:bg-orange-100 text-orange-700"} ${idCardBackUrl ? "border-orange-400 bg-orange-100" : ""}`}>
                        <Upload size={14} className={idCardUploading ? "animate-pulse" : ""} />
                        <span>{idCardBackUrl ? "Back ✓" : idCardUploading ? "Scanning…" : "Upload Back"}</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            await processIdBackImage(file);
                          }}
                        />
                      </label>
                    </div>
                    {isFormFAdmin && <OcrDiagnosticsPanel />}
                  </div>
                </BigLabelRow>

                {/* ── AI-extracted ID card data review ── */}
                {(idCardOcrResult || idCardExtractedName || idCardExtractedAddress) && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 space-y-2">
                    <div className="flex items-center gap-1.5">
                      <AlertTriangle size={14} className="text-blue-600" />
                      <span className="text-sm font-semibold text-blue-800">AI-extracted ID card data — please verify</span>
                      {idCardOcrResult && (
                        <Badge
                          variant="outline"
                          className={`text-xs h-5 ml-auto ${
                            ocrConfidenceTier(idCardOcrResult.confidencePercent) === "auto"
                              ? "border-green-300 text-green-700 bg-green-50"
                              : ocrConfidenceTier(idCardOcrResult.confidencePercent) === "confirm"
                                ? "border-amber-300 text-amber-700 bg-amber-50"
                                : "border-red-300 text-red-700 bg-red-50"
                          }`}
                        >
                          {idCardOcrResult.confidencePercent != null ? `${idCardOcrResult.confidencePercent}% confidence` : `${idCardOcrResult.confidence} confidence`}
                        </Badge>
                      )}
                    </div>
                    {ocrConfidenceTier(idCardOcrResult?.confidencePercent) === "manual" && (
                      <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
                        Low OCR confidence — please verify against the physical card and enter details manually rather than relying on this extraction.
                      </p>
                    )}
                    {idCardExtractedName && (
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-blue-700 flex-1 truncate">
                          <span className="font-semibold">Guardian:</span> {idCardExtractedName}
                        </span>
                        <Button
                          size="sm" variant="ghost" className="h-7 text-xs px-3 py-0"
                          onClick={() => { set("husbandFatherName", idCardExtractedName); setIdCardVerified(true); toast({ title: "Guardian name accepted" }); }}
                        >
                          <CheckCircle2 size={12} className="mr-1" /> Use this
                        </Button>
                      </div>
                    )}
                    {idCardExtractedAddress && (
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-blue-700 flex-1 truncate">
                          <span className="font-semibold">Address:</span> {idCardExtractedAddress}
                        </span>
                        <Button
                          size="sm" variant="ghost" className="h-7 text-xs px-3 py-0"
                          onClick={() => { set("address", idCardExtractedAddress); setIdCardVerified(true); toast({ title: "Address accepted" }); }}
                        >
                          <CheckCircle2 size={12} className="mr-1" /> Use this
                        </Button>
                      </div>
                    )}
                    {/* Extra fields Form F has no dedicated input for — shown
                        read-only for staff to cross-check against the
                        physical card, not applied anywhere automatically. */}
                    {(idCardOcrResult?.dob || idCardOcrResult?.age != null || idCardOcrResult?.gender || idCardOcrResult?.idNumber) && (
                      <div className="text-xs text-blue-600 flex flex-wrap gap-x-3 gap-y-0.5 pt-1 border-t border-blue-100">
                        {idCardOcrResult?.dob && <span>DOB: {idCardOcrResult.dob}</span>}
                        {idCardOcrResult?.age != null && <span>Age: {idCardOcrResult.age}</span>}
                        {idCardOcrResult?.gender && <span>Gender: {idCardOcrResult.gender}</span>}
                        {idCardOcrResult?.idNumber && <span>ID No.: {idCardOcrResult.idNumber}</span>}
                      </div>
                    )}
                    {idCardOcrResult?.ocrProvider && (
                      <p className="text-[10px] text-blue-500">Extracted via {idCardOcrResult.ocrProvider === "ollama" ? "local AI (Ollama)" : "Gemini"}</p>
                    )}
                  </div>
                )}

                {/* ── ID Card Preview (front + back) ── */}
                {(idCardFrontUrl || idCardBackUrl) && (
                  <BigLabelRow label="Uploaded ID">
                    <div className="flex items-start gap-3 flex-wrap">
                      {idCardFrontUrl && (
                        <div className="relative">
                          <div className="text-[11px] text-muted-foreground mb-1">Front</div>
                          <img src={idCardFrontUrl} alt="ID Front" className="w-40 h-24 object-cover border rounded" />
                          <button
                            type="button"
                            onClick={() => setIdCardFrontUrl("")}
                            className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-[10px] hover:bg-red-600"
                            title="Remove front"
                          >
                            ✕
                          </button>
                        </div>
                      )}
                      {idCardBackUrl && (
                        <div className="relative">
                          <div className="text-[11px] text-muted-foreground mb-1">Back</div>
                          <img src={idCardBackUrl} alt="ID Back" className="w-40 h-24 object-cover border rounded" />
                          <button
                            type="button"
                            onClick={() => setIdCardBackUrl("")}
                            className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-[10px] hover:bg-red-600"
                            title="Remove back"
                          >
                            ✕
                          </button>
                        </div>
                      )}
                      {lastIdImage && (
                        <Button
                          type="button" size="sm" variant="outline"
                          className="h-8 text-xs mt-4"
                          disabled={ocrRetrying}
                          onClick={retryOcr}
                        >
                          <RefreshCcw size={12} className={`mr-1 ${ocrRetrying ? "animate-spin" : ""}`} />
                          {ocrRetrying ? "Retrying…" : "Retry OCR"}
                        </Button>
                      )}
                    </div>
                  </BigLabelRow>
                )}

                <BigLabelRow label={`Full Address ${addressRequired ? "*" : ""}`}>
                  <Input {...inp("address")} placeholder={addressRequired ? "Patient's full address" : "Optional — enter if available"} className="text-base h-11" />
                </BigLabelRow>
                <BigLabelRow label="No. of children">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded px-3 py-1.5">Boy</span>
                      <Input type="number" min={0} max={20} value={form.boyCount} onChange={(e) => set("boyCount", e.target.value)} className="h-11 text-base w-20 text-center" placeholder="0" />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-pink-700 bg-pink-50 border border-pink-200 rounded px-3 py-1.5">Girl</span>
                      <Input type="number" min={0} max={20} value={form.girlCount} onChange={(e) => set("girlCount", e.target.value)} className="h-11 text-base w-20 text-center" placeholder="0" />
                    </div>
                    <span className="text-sm text-muted-foreground">(enter count per gender)</span>
                  </div>
                </BigLabelRow>
                <BigLabelRow label="Referred by">
                  <div className="flex items-center gap-3 flex-wrap">
                    <label className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-md border text-sm font-medium cursor-pointer transition-colors ${form.referredBy === "Self" ? "border-teal-300 bg-teal-50 text-teal-700" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}>
                      <input
                        type="radio"
                        name="referredBy"
                        value="Self"
                        checked={form.referredBy === "Self"}
                        onChange={() => setForm((prev) => ({ ...prev, referredBy: "Self", referredByName: "" }))}
                        className="accent-teal-600"
                      />
                      <span>Self / Walk-in</span>
                    </label>
                    <label className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-md border text-sm font-medium cursor-pointer transition-colors ${form.referredBy === "Doctor" ? "border-teal-300 bg-teal-50 text-teal-700" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}>
                      <input
                        type="radio"
                        name="referredBy"
                        value="Doctor"
                        checked={form.referredBy === "Doctor"}
                        onChange={() => setForm((prev) => ({ ...prev, referredBy: "Doctor", referredByName: prev.referredByName || "" }))}
                        className="accent-teal-600"
                      />
                      <span>Doctor</span>
                    </label>
                    {form.referredBy === "Doctor" && (
                      <div className="relative">
                        <Input
                          value={form.referredByName}
                          onChange={(e) => {
                            setForm((prev) => ({
                              ...prev,
                              referredByName: e.target.value,
                            }));
                          }}
                          list="formf-referredby-doctor-options"
                          placeholder="Search doctor name..."
                          className="h-11 text-base w-72 pr-8"
                        />
                        <datalist id="formf-referredby-doctor-options">
                          {doctorsForPick.map((d) => (
                            <option key={d.id} value={d.name}>
                              {d.registrationNumber ? `Reg. ${d.registrationNumber}` : "No reg. no on file"}
                            </option>
                          ))}
                        </datalist>
                        <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                      </div>
                    )}
                  </div>
                </BigLabelRow>
                <BigLabelRow label="LMP / weeks">
                  <div className="flex items-center gap-3 flex-wrap">
                    <FormRadio checked={form.lmpType === "weeks"} onChange={() => set("lmpType", "weeks")} label="Weeks:" />
                    {form.lmpType === "weeks" && (
                      <Input {...inp("lmpWeeks")} placeholder="e.g. 32" className="text-base h-11 w-24 text-center" />
                    )}
                    <FormRadio checked={form.lmpType === "date"} onChange={() => set("lmpType", "date")} label="Date:" />
                    {form.lmpType === "date" && (
                      <Input type="date" {...inp("lmpWeeks")} className="text-base h-11 w-48" />
                    )}
                    <FormRadio checked={form.lmpType === "other"} onChange={() => set("lmpType", "other")} label="Other:" />
                    {form.lmpType === "other" && (
                      <Input {...inp("lmpWeeks")} placeholder="e.g. 8 months" className="text-base h-11 w-56" />
                    )}
                  </div>
                </BigLabelRow>
                <BigLabelRow label="Gestational Age (14a)">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={0}
                        max={42}
                        value={form.gestationalAgeWeeks}
                        onChange={(e) => set("gestationalAgeWeeks", e.target.value)}
                        placeholder="Weeks"
                        className="h-11 text-base w-24 text-center"
                      />
                      <span className="text-sm font-medium text-gray-600">weeks</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={0}
                        max={6}
                        value={form.gestationalAgeDays}
                        onChange={(e) => set("gestationalAgeDays", e.target.value)}
                        placeholder="Days"
                        className="h-11 text-base w-24 text-center"
                      />
                      <span className="text-sm font-medium text-gray-600">days</span>
                    </div>
                  </div>
                </BigLabelRow>
                <BigLabelRow label="Indication">
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      <FormRadio checked={form.indicationType === "routine"} onChange={() => set("indicationType", "routine")} label="Routine antenatal" />
                      <FormRadio checked={form.indicationType === "age"} onChange={() => set("indicationType", "age")} label="Adv. maternal age" />
                      <FormRadio checked={form.indicationType === "genetic"} onChange={() => set("indicationType", "genetic")} label="Genetic disease" />
                      <FormRadio checked={form.indicationType === "previous"} onChange={() => set("indicationType", "previous")} label="Prev. child issue" />
                      <FormRadio checked={form.indicationType === "other"} onChange={() => set("indicationType", "other")} label="Other" />
                    </div>
                    {(form.indicationType === "previous" || form.indicationType === "other") && (
                      <Input {...inp("indicationDetail")} placeholder="Specify details" className="h-11 text-base" />
                    )}
                    {form.indicationType === "previous" && (
                      <Input {...inp("previousChildIssue")} placeholder="Previous child details" className="h-11 text-base" />
                    )}
                  </div>
                </BigLabelRow>
                <BigLabelRow label="Invasive procedure">
                  <div className="space-y-3">
                    <div className="flex gap-3">
                      <FormRadio checked={form.invasiveProcedure === "notdone"} onChange={() => set("invasiveProcedure", "notdone")} label="Not done" />
                      <FormRadio checked={form.invasiveProcedure === "done"} onChange={() => set("invasiveProcedure", "done")} label="Done:" />
                    </div>
                    {form.invasiveProcedure === "done" && (
                      <Input {...inp("invasiveProcedureDetail")} placeholder="Specify" className="h-11 text-base" />
                    )}
                  </div>
                </BigLabelRow>
                <BigLabelRow label="Complication">
                  <div className="space-y-3">
                    <div className="flex gap-3">
                      <FormRadio checked={form.complication === "nil"} onChange={() => set("complication", "nil")} label="Nil" />
                      <FormRadio checked={form.complication === "specify"} onChange={() => set("complication", "specify")} label="Specify:" />
                    </div>
                    {form.complication === "specify" && (
                      <Input {...inp("complicationDetail")} placeholder="Details" className="h-11 text-base" />
                    )}
                  </div>
                </BigLabelRow>
                <BigLabelRow label="Lab tests">
                  <div className="space-y-3">
                    <div className="flex gap-3">
                      <FormRadio checked={form.labTests === "notadvised"} onChange={() => set("labTests", "notadvised")} label="Not advised" />
                      <FormRadio checked={form.labTests === "advised"} onChange={() => set("labTests", "advised")} label="Advised:" />
                    </div>
                    {form.labTests === "advised" && (
                      <Input {...inp("labTestsDetail")} placeholder="Tests advised" className="h-11 text-base" />
                    )}
                  </div>
                </BigLabelRow>
                <BigLabelRow label="USG result">
                  <div className="space-y-3">
                    <div className="flex gap-3">
                      <FormRadio checked={form.ultrasoundResult === "normal"} onChange={() => set("ultrasoundResult", "normal")} label="Normal" />
                      <FormRadio checked={form.ultrasoundResult === "abnormal"} onChange={() => set("ultrasoundResult", "abnormal")} label="Abnormal:" />
                    </div>
                    {form.ultrasoundResult === "abnormal" && (
                      <Input {...inp("abnormality")} placeholder="Abnormality details" className="h-11 text-base" />
                    )}
                  </div>
                </BigLabelRow>
                <BigLabelRow label="Procedure date">
                  <Input type="date" {...inp("procedureDate")} className="text-base h-11" />
                </BigLabelRow>
                <BigLabelRow label="Result conveyed">
                  <Input {...inp("resultConveyed")} className="text-base h-11" />
                </BigLabelRow>
                <BigLabelRow label="MTP advised">
                  <div className="space-y-3">
                    <div className="flex gap-3">
                      <FormRadio checked={form.mtpAdvised === "no"} onChange={() => set("mtpAdvised", "no")} label="No" />
                      <FormRadio checked={form.mtpAdvised === "yes"} onChange={() => set("mtpAdvised", "yes")} label="Yes" />
                    </div>
                    {form.mtpAdvised === "yes" && (
                      <Input type="date" {...inp("mtpDate")} className="h-11 text-base w-56" />
                    )}
                  </div>
                </BigLabelRow>
              </div>
            </div>

            {/* Section 2: CONDUCTING DOCTOR — separate card */}
            <div className="bg-teal-50/60 border border-teal-100 rounded-xl p-4 shadow-sm">
              <div className="flex items-center gap-2 pb-2 border-b border-teal-100 mb-3">
                <Stethoscope size={14} className="text-teal-600" />
                <span className="text-sm font-bold text-teal-800">Conducting Doctor</span>
                <span className="text-[10px] bg-teal-100 text-teal-700 px-2 py-0.5 rounded-full">Auto-filled from bill · Editable</span>
              </div>
              <div className="space-y-3">
                <LabelRow label="Doctor Name">
                  <Input
                    value={form.doctorName}
                    list="formf-doctor-options"
                    onChange={(e) => {
                      const name = e.target.value;
                      const match = doctorsForPick.find((d) => d.name === name);
                      setForm((prev) => ({
                        ...prev,
                        doctorName: name,
                        doctorRegNo: match?.registrationNumber ?? prev.doctorRegNo,
                      }));
                    }}
                    placeholder="Type or pick a doctor"
                    className="text-sm h-9"
                  />
                  <datalist id="formf-doctor-options">
                    {doctorsForPick.map((d) => (
                      <option key={d.id} value={d.name}>
                        {d.registrationNumber ? `Reg. ${d.registrationNumber}` : "No reg. no on file"}
                      </option>
                    ))}
                  </datalist>
                </LabelRow>
                <LabelRow label="Doctor Reg. No.">
                  <Input {...inp("doctorRegNo")} placeholder="Auto-filled from selected doctor; editable" className="text-sm h-9" />
                </LabelRow>
              </div>
            </div>

            {/* Section B: AUTO-FILLED from Billing / Defaults — compact, muted */}
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 shadow-sm">
              <div className="flex items-center gap-2 pb-1 border-b border-gray-200 mb-2">
                <span className="text-xs font-bold text-gray-600">Auto-filled from Billing</span>
                <span className="text-[10px] bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">Pre-filled</span>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-start gap-2">
                  <span className="text-[11px] font-semibold text-gray-500 w-24 flex-shrink-0 pt-1">Bill No.</span>
                  <Input {...inp("billNumber")} placeholder="Auto-filled on Fetch" className="h-7 text-xs flex-1 bg-white" />
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-[11px] font-semibold text-gray-500 w-24 flex-shrink-0 pt-1">Centre Name</span>
                  <textarea
                    value={form.centreName}
                    onChange={(e) => set("centreName", e.target.value)}
                    rows={2}
                    className="flex-1 text-xs border rounded-md px-2 py-1 bg-white resize-none focus:ring-1 focus:ring-primary focus:border-primary"
                  />
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-[11px] font-semibold text-gray-500 w-24 flex-shrink-0 pt-1">Reg. No.</span>
                  <Input {...inp("registrationNo")} className="h-7 text-xs w-40 bg-white" />
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-[11px] font-semibold text-gray-500 w-24 flex-shrink-0 pt-1">Procedure</span>
                  <Input {...inp("procedure")} placeholder="e.g. Ultrasound - ULTRASONOGRAPHY" className="h-7 text-xs flex-1 bg-white" />
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-[11px] font-semibold text-gray-500 w-24 flex-shrink-0 pt-1">Purpose</span>
                  <Input {...inp("procedurePurpose")} placeholder="e.g. Obstetric ultrasonography" className="h-7 text-xs flex-1 bg-white" />
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-[11px] font-semibold text-gray-500 w-24 flex-shrink-0 pt-1">Genetic Hx</span>
                  <div className="flex-1 space-y-1">
                    <div className="flex gap-1">
                      <FormRadio checked={form.geneticHistory === "none"} onChange={() => set("geneticHistory", "none")} label="None" />
                      <FormRadio checked={form.geneticHistory === "specify"} onChange={() => set("geneticHistory", "specify")} label="Specify:" />
                    </div>
                    {form.geneticHistory === "specify" && (
                      <Input {...inp("geneticHistoryDetail")} placeholder="Details" className="h-7 text-xs" />
                    )}
                    <div className="flex items-center gap-1 text-[11px] text-gray-500">
                      <span>Basis:</span>
                      <FormCheck checked={!!form.basisDiagnosisClinical} onChange={(e) => set("basisDiagnosisClinical", e.target.checked)} label="Clinical" />
                      <FormCheck checked={!!form.basisDiagnosisUsg} onChange={(e) => set("basisDiagnosisUsg", e.target.checked)} label="USG" />
                      <span>Other:</span>
                      <Input {...inp("basisDiagnosisOther")} placeholder="" className="h-7 text-xs w-24" />
                    </div>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-[11px] font-semibold text-gray-500 w-24 flex-shrink-0 pt-1">Date / Place</span>
                  <div className="flex gap-2 flex-1">
                    <Input type="date" {...inp("date")} className="h-7 text-xs flex-1 bg-white" />
                    <Input {...inp("place")} className="h-7 text-xs flex-1 bg-white" placeholder="Place" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── RIGHT: A4 Preview ── */}
          <div className="flex-shrink-0" style={{ width: "220mm" }}>
            <div className="text-xs text-gray-500 mb-2 text-center font-medium">
              A4 Print Preview — fits one page
            </div>
            <div
              ref={printRef}
              style={{
                boxShadow: "0 2px 12px rgba(0,0,0,0.15)",
                borderRadius: 4,
                overflow: "hidden",
                border: "1px solid #ddd",
              }}
            >
              <FormFPrint form={form} idCardFrontUrl={idCardFrontUrl} idCardBackUrl={idCardBackUrl} />
            </div>
            <div className="mt-3 flex gap-2 justify-center">
              <Button className="h-8 text-xs" onClick={printAndSave} disabled={saving}>
                <Printer size={12} className="mr-1" /> {saving ? "Saving…" : "Print A4 (auto-saves)"}
              </Button>
            </div>
          </div>

        </div>
      </div>}

      {/* ── Old Camera / Scanner Modal (kept for backward compat, but now redirect to new panel) ── */}
      {cameraOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => { stopCamera(); setCameraOpen(false); }}>
          <div className="bg-white rounded-xl shadow-2xl p-4 max-w-lg w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-bold text-gray-900">Camera — Capture ID Card</h3>
              <button type="button" onClick={() => { stopCamera(); setCameraOpen(false); }} className="text-gray-400 hover:text-gray-700">
                <X size={18} />
              </button>
            </div>
            <div className="relative bg-black rounded-lg overflow-hidden aspect-video">
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
              <canvas ref={canvasRef} className="hidden" />
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-2">
                <Button size="sm" onClick={captureFromCamera} className="bg-white text-black hover:bg-gray-100 font-semibold">
                  <Camera size={14} className="mr-1" /> Capture
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2 text-center">Position the ID card in front of the camera and click Capture. For physical scanners, use the Scanner button above.</p>
          </div>
        </div>
      )}

      {/* ── ID Card Scan Editor (crop, rotate, adjust) ── */}
      {scanPanelOpen && scanPanelBase64 && (
        <IdCardScanPanel
          imageBase64={scanPanelBase64}
          mimeType={scanPanelMime}
          autoCropEnabled={fSettings?.autoCropIdScan !== false}
          cropPadding={fSettings?.cropPadding ?? 12}
          jpegQuality={fSettings?.jpegQuality ?? 85}
          maxWidth={fSettings?.maxScanWidth ?? 1200}
          onSave={async (result) => {
            // Prefer enhanced → cropped → original for Form F display
            const displayB64 = result.enhancedBase64 || result.croppedBase64 || result.originalBase64;
            const dataUrl = `data:${result.mimeType};base64,${displayB64}`;
            setIdCardFrontUrl(dataUrl);
            // Keep original available as a second slot for audit
            if (result.originalBase64 && result.originalBase64 !== displayB64) {
              // Store original in back URL slot for audit trail (non-destructive)
              setIdCardBackUrl(`data:${result.mimeType};base64,${result.originalBase64}`);
            }
            setScanPanelOpen(false);
            setScanPanelBase64("");
            // Run OCR on the enhanced/cropped image for better text extraction
            await runOcrOnImage(displayB64, result.mimeType);
            const modeLabel = result.enhancementMode && result.enhancementMode !== "original"
              ? ` · ${result.enhancementMode} enhancement`
              : "";
            toast({ title: `ID card saved${modeLabel}` });
          }}
          onCancel={() => {
            setScanPanelOpen(false);
            setScanPanelBase64("");
          }}
        />
      )}
    </div>
  );
}
