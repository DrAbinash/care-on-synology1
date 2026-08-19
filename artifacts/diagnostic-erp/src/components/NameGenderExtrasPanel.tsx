import { Label } from "@/components/ui/label";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { useToast } from "@/hooks/use-toast";
import { applyNameGenderExtras, parseNameGenderExtraList } from "@/lib/nameGender";

type Props = {
  maleStored: string;
  femaleStored: string;
  disabled?: boolean;
  /** pacs_settings category — use "general" in Main Settings; legacy rows may be "radiology". */
  category?: string;
};

function toLines(raw: string): string {
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) return parsed.map((x: unknown) => String(x)).join("\n");
  } catch { /* fall through */ }
  return raw;
}

export function NameGenderExtrasPanel({
  maleStored,
  femaleStored,
  disabled = false,
  category = "general",
}: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const upsert = useMutation({
    mutationFn: (body: { key: string; value: string; category: string }) =>
      api.post("/api/radiology/pacs-settings", body),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["pacs-settings"] });
      if (vars.key === "name_gender_male_extra" || vars.key === "name_gender_female_extra") {
        const cached = qc.getQueryData<Array<{ key: string; value: string | null; category?: string }>>(["pacs-settings"]);
        const maleRaw = vars.key === "name_gender_male_extra"
          ? vars.value
          : pickNameGenderExtra(cached, "name_gender_male_extra") || maleStored;
        const femaleRaw = vars.key === "name_gender_female_extra"
          ? vars.value
          : pickNameGenderExtra(cached, "name_gender_female_extra") || femaleStored;
        applyNameGenderExtras(parseNameGenderExtraList(maleRaw), parseNameGenderExtraList(femaleRaw));
      }
      toast({ title: "Saved", description: "Name → Sex suggestion list updated." });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Save failed", description: e.message }),
  });

  return (
    <div className="rounded-xl border bg-card p-5 space-y-3" data-testid="name-gender-extras-panel">
      <h3 className="text-sm font-bold">Patient name → Sex suggestion</h3>
      <p className="text-xs text-muted-foreground">
        Bill Desk / Register / Patients / Kiosk pre-fill Sex from a bundled Indian first-name list.
        Add clinic-specific names here (one per line) when a local name is missing — no code deploy needed.
        Unisex names should stay off both lists.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs font-semibold">Extra male names</Label>
          <textarea
            key={`male-${maleStored}-${category}`}
            defaultValue={toLines(maleStored)}
            disabled={disabled}
            rows={5}
            placeholder={"Raju\nChhotu"}
            className="w-full text-sm border rounded-md px-2 py-1.5 bg-background resize-y"
            onBlur={(e) => {
              const names = e.target.value.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
              upsert.mutate({
                key: "name_gender_male_extra",
                value: JSON.stringify(names),
                category,
              });
            }}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs font-semibold">Extra female names</Label>
          <textarea
            key={`female-${femaleStored}-${category}`}
            defaultValue={toLines(femaleStored)}
            disabled={disabled}
            rows={5}
            placeholder={"Munni\nGudiya"}
            className="w-full text-sm border rounded-md px-2 py-1.5 bg-background resize-y"
            onBlur={(e) => {
              const names = e.target.value.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
              upsert.mutate({
                key: "name_gender_female_extra",
                value: JSON.stringify(names),
                category,
              });
            }}
          />
        </div>
      </div>
    </div>
  );
}

/** Prefer general-category extras; fall back to legacy radiology category. */
export function pickNameGenderExtra(
  rows: Array<{ key: string; value: string | null; category?: string }> | undefined,
  key: "name_gender_male_extra" | "name_gender_female_extra",
): string {
  if (!rows?.length) return "";
  const general = rows.find((r) => r.key === key && r.category === "general")?.value;
  if (general != null) return general;
  const radiology = rows.find((r) => r.key === key && r.category === "radiology")?.value;
  return radiology ?? rows.find((r) => r.key === key)?.value ?? "";
}
