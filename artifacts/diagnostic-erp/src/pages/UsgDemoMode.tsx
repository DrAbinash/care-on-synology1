import { useState } from "react";
import { useLocation } from "wouter";
import { ellipsoidVolumeMl } from "@workspace/measurements";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, RotateCcw, ShieldAlert } from "lucide-react";

/**
 * UsgDemoMode — self-contained synthetic USG Companion showcase (GAP 9).
 *
 * SAFE BY CONSTRUCTION: this page makes NO write API calls. It uses only
 * synthetic identifiers and in-memory data — no real patient/worklist/PACS/
 * Form-F/AI/message writes ever happen. A prominent DEMO banner is always shown
 * and the state is resettable. The prostate-volume card runs the REAL shared
 * ellipsoid-volume engine on synthetic dimensions (a genuine calculation on fake
 * numbers); every other card is a clearly-labelled illustrative sample.
 */

const DEMO = "SYNTHETIC-DEMO";

function Sample({ title, tag, children }: { title: string; tag?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2">{title}{tag && <Badge variant="outline">{tag}</Badge>}</CardTitle></CardHeader>
      <CardContent className="text-xs space-y-1">{children}</CardContent>
    </Card>
  );
}

export default function UsgDemoMode() {
  const [, navigate] = useLocation();
  const [resetKey, setResetKey] = useState(0);

  // A genuine calculation on synthetic dimensions (3.4 × 3.1 × 2.4 cm).
  const prostateMl = ellipsoidVolumeMl(34, 31, 24, "mm");

  return (
    <div key={resetKey} className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      {/* Always-on DEMO banner */}
      <div className="rounded-md bg-amber-500/15 border border-amber-500/40 text-amber-800 dark:text-amber-300 px-3 py-2 text-sm font-medium flex items-center gap-2">
        <ShieldAlert className="w-4 h-4" />
        DEMO MODE — synthetic data only. Nothing here is written to any patient, worklist, PACS, Form F, or message. Identifiers are fake ({DEMO}).
      </div>

      <div className="flex items-center justify-between">
        <PageHeader title="USG Companion — Demo" subtitle="Synthetic showcase of the reporting flows. No production data is touched." />
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setResetKey((k) => k + 1)}><RotateCcw className="w-4 h-4 mr-1" />Reset</Button>
          <Button size="sm" variant="outline" onClick={() => navigate("/radiology")}><ArrowLeft className="w-4 h-4 mr-1" />Back</Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Sample title="Whole abdomen — normal">
          <p>Liver normal in size and echotexture; no focal lesion. GB, CBD, pancreas, spleen, both kidneys, urinary bladder — unremarkable. No free fluid.</p>
          <p className="text-muted-foreground">Impression: No significant abnormality.</p>
        </Sample>

        <Sample title="Renal calculus">
          <p>Right kidney: a 6 mm echogenic focus with posterior acoustic shadowing in the lower pole calyx. No hydronephrosis.</p>
          <p className="text-muted-foreground">Impression: Right renal calculus (6 mm), non-obstructive.</p>
        </Sample>

        <Sample title="Cholelithiasis">
          <p>Gallbladder: a 9 mm mobile echogenic focus with posterior shadowing in the lumen; wall not thickened; no pericholecystic fluid.</p>
          <p className="text-muted-foreground">Impression: Cholelithiasis (single 9 mm calculus).</p>
        </Sample>

        <Sample title="Prostate volume" tag="real calc">
          <p>Dimensions 3.4 × 3.1 × 2.4 cm → ellipsoid volume <strong>{prostateMl != null ? `${prostateMl} ml` : "—"}</strong>.</p>
          <p className="text-muted-foreground">Computed by the shared measurements engine (genuine calculation on synthetic dimensions).</p>
        </Sample>

        <Sample title="Measurement conflict" tag="illustrative">
          <p>CBD — DICOM SR: <strong>4.0 mm</strong>; OCR: <strong>5.0 mm</strong> → <span className="text-amber-600">conflict flagged for review</span> (both candidates retained; nothing auto-approved).</p>
        </Sample>

        <Sample title="Prior comparison" tag="illustrative">
          <table className="w-full"><tbody className="[&>tr>td]:pr-2">
            <tr className="text-muted-foreground"><td>Measure</td><td>Prior→Current</td><td>Δ%</td></tr>
            <tr><td>BPD</td><td>45→70 mm</td><td className="text-amber-600">+56%</td></tr>
            <tr><td>EFW</td><td>600→1400 g</td><td className="text-amber-600">+133%</td></tr>
          </tbody></table>
          <p className="text-muted-foreground">Same-patient only; suggestion is editable and enters the draft only on acceptance.</p>
        </Sample>

        <Sample title="Pregnancy timeline" tag="illustrative">
          <p>Scan 1 (03-01): GA 20w, EFW 320 g, AFI 12 cm. Scan 2 (04-01): GA 24w, EFW 700 g, AFI 13 cm.</p>
          <p className="text-muted-foreground">Reference: EFW Hadlock (1985). Separate pregnancies never combined.</p>
        </Sample>

        <Sample title="Doppler" tag="illustrative">
          <p>Umbilical artery: PSV 40, EDV 10 cm/s → RI 0.75, S/D 4.0. Second sample EDV 0 → <span className="text-amber-600">absent end-diastolic flow — correlate clinically</span>.</p>
        </Sample>

        <Sample title="Cine" tag="illustrative">
          <p>Multi-frame US clip: 60 frames @ 30 fps (2.0 s). Suggested key frame 30. Stored as a DICOM reference (SOP + frame) — never a blob.</p>
        </Sample>

        <Sample title="AI assistant" tag="illustrative">
          <p>Suggestion: “Hepatomegaly (liver span 17 cm).” — accept-only; radiologist must approve. AI never signs/finalizes/writes the report and never outputs fetal sex.</p>
        </Sample>

        <Sample title="PCPNDT blocked-state simulation">
          <p className="text-red-600">Finalize blocked (409 pcpndt_compliance_required): Form F incomplete — ID card not verified.</p>
          <p className="text-muted-foreground">The real finalize gate is fail-closed server-side; this is a synthetic reproduction of the blocked state.</p>
        </Sample>
      </div>

      <p className="text-[10px] text-muted-foreground">Demo mode relies on no production records. Close this page to return to normal reporting.</p>
    </div>
  );
}
