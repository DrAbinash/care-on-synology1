import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { isFeatureEnabled } from "@/lib/staffSession";

/**
 * UsgObDopplerPanel — P5 OB & Doppler canonical-section panel (final-integration
 * wiring). Flag-gated (ff_radiology_usg_ob_canonical / _doppler_canonical).
 * Generates the section + impression from the canonical engine via the API and
 * lets the radiologist insert them into the CURRENT draft. Never auto-inserts,
 * never shows fetal sex; Form-F status is display-only (the finalize gate stays
 * the fail-closed enforcement point).
 */

interface SectionResult { section: { label: string; text: string; normal?: boolean }; impression: string[]; caveats?: string[] }
interface FormF { applicable: boolean; compliant: boolean; reason: string; errors: string[] }

export default function UsgObDopplerPanel({
  studyId, onInsertFindings, onInsertImpression,
}: { studyId: number | null; onInsertFindings: (t: string) => void; onInsertImpression: (t: string) => void }) {
  const obOn = isFeatureEnabled("ff_radiology_usg_ob_canonical") && !!studyId;
  const dopplerOn = isFeatureEnabled("ff_radiology_usg_doppler_canonical") && !!studyId;
  const [ob, setOb] = useState<SectionResult | null>(null);
  const [doppler, setDoppler] = useState<SectionResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const formF = useQuery<FormF>({
    queryKey: ["usg-formf", studyId],
    queryFn: () => api.get(`/api/usg-ob-doppler/studies/${studyId}/form-f-status`),
    enabled: obOn,
  });

  if (!obOn && !dopplerOn) return null;

  const generate = async (kind: "ob" | "doppler") => {
    setBusy(kind);
    try {
      const r = await api.get<SectionResult>(`/api/usg-ob-doppler/studies/${studyId}/${kind}-section`);
      if (kind === "ob") setOb(r); else setDoppler(r);
    } finally { setBusy(null); }
  };

  const renderSection = (r: SectionResult) => (
    <div className="space-y-1.5 mt-1.5">
      {r.section.text && <pre className="whitespace-pre-wrap text-xs bg-muted/40 rounded p-1.5">{r.section.text}</pre>}
      {r.caveats && r.caveats.length > 0 && r.caveats.map((c, i) => <p key={i} className="text-amber-600 text-xs">⚠ {c}</p>)}
      {r.impression.length > 0 && (
        <ul className="text-xs list-disc pl-4">{r.impression.map((i, k) => <li key={k}>{i}</li>)}</ul>
      )}
      <div className="flex gap-2">
        {r.section.text && <button className="px-2 py-0.5 rounded border text-xs" onClick={() => onInsertFindings(r.section.text)}>Insert findings</button>}
        {r.impression.length > 0 && <button className="px-2 py-0.5 rounded border text-xs" onClick={() => onInsertImpression(r.impression.join("\n"))}>Insert impression</button>}
      </div>
    </div>
  );

  return (
    <div className="text-xs space-y-2" data-testid="usg-ob-doppler-panel">
      <div className="font-medium text-sm">OB / Doppler sections</div>

      {obOn && formF.data?.applicable && (
        <div className={`px-2 py-1 rounded text-xs ${formF.data.compliant ? "bg-emerald-500/10 text-emerald-700" : "bg-red-500/10 text-red-700"}`}>
          PCPNDT Form F: {formF.data.compliant ? "compliant" : "incomplete"}
          {!formF.data.compliant && formF.data.errors.length > 0 && <span> — {formF.data.errors.join(" ")}</span>}
          <span className="block text-[10px] opacity-70">Finalization remains blocked server-side until compliant.</span>
        </div>
      )}

      {obOn && (
        <div>
          <button className="px-2 py-0.5 rounded bg-primary text-primary-foreground" disabled={busy === "ob"} onClick={() => generate("ob")}>
            {busy === "ob" ? "Generating…" : "Generate OB section"}
          </button>
          {ob && renderSection(ob)}
        </div>
      )}

      {dopplerOn && (
        <div>
          <button className="px-2 py-0.5 rounded bg-primary text-primary-foreground" disabled={busy === "doppler"} onClick={() => generate("doppler")}>
            {busy === "doppler" ? "Generating…" : "Generate Doppler section"}
          </button>
          {doppler && renderSection(doppler)}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">Built from approved measurements via the canonical obstetric engine. Nothing is inserted until you choose to.</p>
    </div>
  );
}
