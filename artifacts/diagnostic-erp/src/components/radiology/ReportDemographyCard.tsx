import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Pencil, Check, X } from "lucide-react";
import type { ReportDemography } from "@/lib/reportDemography";

interface Props {
  value: ReportDemography;
  onChange: (patch: Partial<ReportDemography>) => void;
  /**
   * E-6 — fields carrying a report-local correction (the study-stamped
   * overrides the workspace holds). Rendered as a small marker on the read
   * row so the radiologist can see WHICH identity values are corrections and
   * not the registration desk's — the overrides outrank the patient master
   * and persist invisibly in the draft envelope.
   */
  overriddenFields?: Array<keyof ReportDemography>;
  disabled?: boolean;
}

const FIELDS: Array<{ key: keyof ReportDemography; label: string; uppercase?: boolean }> = [
  { key: "patientName", label: "Patient Name", uppercase: true },
  { key: "age", label: "Age" },
  { key: "sex", label: "Sex" },
  // The UHID the report prints is the patients.patient_id STRING. The old box
  // keyed `patientId` — the numeric primary key — so the prefilled number was
  // not the UHID, and a typed correction landed on a field every render reads
  // only when `uhid` is empty (mergeReportDemography suppresses the numeric PK
  // from the UHID line on purpose): an inert edit box that looked broken.
  { key: "uhid", label: "UHID" },
  { key: "studyDescription", label: "Study / Examination", uppercase: true },
  { key: "studyDate", label: "Study Date" },
  { key: "referringDoctor", label: "Referring Doctor", uppercase: true },
  { key: "dateOfBirth", label: "Date of Birth" },
];

/** E-6 — the marker for a report-local correction. Title carries the whole
 *  explanation; the dot itself is one character, not a layout shift. */
function CorrectedMark() {
  return (
    <span
      data-testid="demography-corrected-mark"
      title="Corrected for this report — this value is a report-local correction, not the registered value. Edits affect this report only."
      className="ml-1 text-[9px] text-amber-500"
      aria-label="Corrected for this report"
    >
      ●
    </span>
  );
}

/** First section of the Reporting Workspace — canonical editable demography. */
export default function ReportDemographyCard({ value, onChange, overriddenFields, disabled }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const overridden = new Set(overriddenFields ?? []);

  const startEdit = () => {
    setDraft(
      FIELDS.reduce<Record<string, string>>((acc, f) => {
        acc[f.key] = value[f.key] ?? "";
        return acc;
      }, {}),
    );
    setEditing(true);
  };

  // A-4 — blanking is a silent no-op in the merge (pinned by
  // demographyOverrideStudyIsolation.hardening.test.ts: the merge drops empty
  // strings, so a wrong value can never be blanked out of existence). The card
  // now says so instead of letting Apply look like it worked: a blank delta is
  // never sent, the input shows the reason while editing, and Apply disables
  // when there is no effective (non-blank) change to send.
  const isBlanked = (key: keyof ReportDemography): boolean => {
    const next = (draft[key] ?? "").trim();
    const cur = (value[key] ?? "").trim();
    return !next && !!cur;
  };

  const buildPatch = (): Partial<ReportDemography> => {
    const patch: Partial<ReportDemography> = {};
    for (const f of FIELDS) {
      const next = draft[f.key]?.trim() ?? "";
      const cur = value[f.key] ?? "";
      if (next && next !== cur) (patch as Record<string, string>)[f.key] = next;
    }
    return patch;
  };

  const apply = () => {
    const patch = buildPatch();
    if (Object.keys(patch).length > 0) onChange(patch);
    setEditing(false);
  };

  return (
    <Card data-testid="report-demography-card" className="border-primary/20">
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-semibold uppercase tracking-wide">Demography</CardTitle>
        {!disabled && !editing && (
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={startEdit}>
            <Pencil className="h-3 w-3 mr-1" /> Edit
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {!editing ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <div><span className="text-muted-foreground">Name:</span> <strong className="uppercase">{value.patientName || "—"}{overridden.has("patientName") ? <CorrectedMark /> : null}</strong></div>
            <div><span className="text-muted-foreground">Age / Sex:</span> <strong>{value.age || "—"}{value.sex ? ` / ${value.sex}` : ""}{overridden.has("age") || overridden.has("sex") ? <CorrectedMark /> : null}</strong></div>
            {/* The ID line stops at the UHID: `patientId` in this bag is the
                numeric worklist FK, and mergeReportDemography already refuses
                to print a Postgres sequence value as a clinic identifier. */}
            <div><span className="text-muted-foreground">ID:</span> {value.uhid || "—"}{overridden.has("uhid") ? <CorrectedMark /> : null}</div>
            <div><span className="text-muted-foreground">Study:</span> <span className="uppercase">{value.studyDescription || "—"}{overridden.has("studyDescription") ? <CorrectedMark /> : null}</span></div>
            <div><span className="text-muted-foreground">Date:</span> {value.studyDate || "—"}{overridden.has("studyDate") ? <CorrectedMark /> : null}</div>
            {/* E-1 — DOB is editable and the letterpad prints it in the
                STUDY | DOB identity row; the read view shows it so the
                verification happens at the surface where corrections are
                made, not only on paper. */}
            <div><span className="text-muted-foreground">DOB:</span> {value.dateOfBirth || "—"}{overridden.has("dateOfBirth") ? <CorrectedMark /> : null}</div>
            <div className="col-span-2"><span className="text-muted-foreground">Ref. by:</span> <span className="uppercase">{value.referringDoctor || "—"}{overridden.has("referringDoctor") ? <CorrectedMark /> : null}</span></div>
          </div>
        ) : (
          // E-4 — real form semantics: Enter applies (submit), Esc cancels.
          // The previous layout was a div grid, so Enter did nothing and every
          // change needed a mouse trip to the buttons.
          <form
            className="grid grid-cols-2 gap-2"
            data-testid="report-demography-edit-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (Object.keys(buildPatch()).length > 0) apply();
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setEditing(false);
              }
            }}
          >
            {FIELDS.map((f) => {
              const blanked = isBlanked(f.key);
              return (
                <div key={f.key} className={f.key === "studyDescription" || f.key === "referringDoctor" ? "col-span-2" : ""}>
                  <Label className="text-[10px] uppercase text-muted-foreground">{f.label}</Label>
                  <Input
                    value={draft[f.key] ?? ""}
                    onChange={(e) => setDraft((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    className={`h-8 text-xs ${f.uppercase ? "uppercase" : ""} ${blanked ? "border-amber-400" : ""}`}
                    data-testid={`demography-edit-${f.key}`}
                  />
                  {blanked ? (
                    // A-4 — the honest message: the merge keeps the old value.
                    <p
                      data-testid={`demography-blank-hint-${f.key}`}
                      className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5"
                    >
                      Blank is not kept — type a replacement. A field cannot be blanked out of the report.
                    </p>
                  ) : null}
                </div>
              );
            })}
            <div className="col-span-2 flex justify-end gap-2 pt-1">
              <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditing(false)}>
                <X className="h-3 w-3 mr-1" /> Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={Object.keys(buildPatch()).length === 0}
                title={Object.keys(buildPatch()).length === 0 ? "Nothing to apply — clearing a field is not supported; type a replacement." : undefined}
                data-testid="demography-apply"
              >
                <Check className="h-3 w-3 mr-1" /> Apply to report
              </Button>
            </div>
          </form>
        )}
        <p className="text-[10px] text-muted-foreground">
          Edits affect this report only — the patient master record is not changed.
          {" "}(Enter applies · Esc cancels)
        </p>
      </CardContent>
    </Card>
  );
}
