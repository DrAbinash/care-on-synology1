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
  disabled?: boolean;
}

const FIELDS: Array<{ key: keyof ReportDemography; label: string; uppercase?: boolean }> = [
  { key: "patientName", label: "Patient Name", uppercase: true },
  { key: "age", label: "Age" },
  { key: "sex", label: "Sex" },
  { key: "patientId", label: "Patient ID / UHID" },
  { key: "studyDescription", label: "Study / Examination", uppercase: true },
  { key: "studyDate", label: "Study Date" },
  { key: "referringDoctor", label: "Referring Doctor", uppercase: true },
  { key: "dateOfBirth", label: "Date of Birth" },
];

/** First section of the Reporting Workspace — canonical editable demography. */
export default function ReportDemographyCard({ value, onChange, disabled }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const startEdit = () => {
    setDraft(
      FIELDS.reduce<Record<string, string>>((acc, f) => {
        acc[f.key] = value[f.key] ?? "";
        return acc;
      }, {}),
    );
    setEditing(true);
  };

  const apply = () => {
    const patch: Partial<ReportDemography> = {};
    for (const f of FIELDS) {
      const next = draft[f.key]?.trim() ?? "";
      const cur = value[f.key] ?? "";
      if (next !== cur) (patch as Record<string, string>)[f.key] = next;
    }
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
            <div><span className="text-muted-foreground">Name:</span> <strong className="uppercase">{value.patientName || "—"}</strong></div>
            <div><span className="text-muted-foreground">Age / Sex:</span> <strong>{value.age || "—"}{value.sex ? ` / ${value.sex}` : ""}</strong></div>
            <div><span className="text-muted-foreground">ID:</span> {value.uhid || value.patientId || "—"}</div>
            <div><span className="text-muted-foreground">Study:</span> <span className="uppercase">{value.studyDescription || "—"}</span></div>
            <div><span className="text-muted-foreground">Date:</span> {value.studyDate || "—"}</div>
            <div className="col-span-2"><span className="text-muted-foreground">Ref. by:</span> <span className="uppercase">{value.referringDoctor || "—"}</span></div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {FIELDS.map((f) => (
              <div key={f.key} className={f.key === "studyDescription" || f.key === "referringDoctor" ? "col-span-2" : ""}>
                <Label className="text-[10px] uppercase text-muted-foreground">{f.label}</Label>
                <Input
                  value={draft[f.key] ?? ""}
                  onChange={(e) => setDraft((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  className={`h-8 text-xs ${f.uppercase ? "uppercase" : ""}`}
                />
              </div>
            ))}
            <div className="col-span-2 flex justify-end gap-2 pt-1">
              <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditing(false)}>
                <X className="h-3 w-3 mr-1" /> Cancel
              </Button>
              <Button type="button" size="sm" className="h-7 px-2 text-xs" onClick={apply}>
                <Check className="h-3 w-3 mr-1" /> Apply to report
              </Button>
            </div>
          </div>
        )}
        <p className="text-[10px] text-muted-foreground">
          Edits affect this report only — the patient master record is not changed.
        </p>
      </CardContent>
    </Card>
  );
}
