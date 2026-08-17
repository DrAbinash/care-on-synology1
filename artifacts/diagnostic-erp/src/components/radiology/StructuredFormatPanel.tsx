import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  adaptSectionsJson,
  allNormalFindingsMap,
  applyFieldValue,
  generateFromValues,
  serializeFieldPath,
  setNormalForMapKey,
  type FieldPath,
  type FieldValue,
  type FormatField,
  type StructuredFormatDoc,
  type StructuredValues,
} from "@/lib/structuredFormat";

type Props = {
  sectionsJson: string | null | undefined;
  values: StructuredValues;
  onValuesChange: (next: StructuredValues) => void;
  disabled?: boolean;
  onLoadAllNormals: () => void;
};

export function StructuredFormatPanel({
  sectionsJson,
  values,
  onValuesChange,
  disabled,
  onLoadAllNormals,
}: Props) {
  const doc = useMemo(() => adaptSectionsJson(sectionsJson), [sectionsJson]);
  const hasFields = doc.sections.some((s) => s.fields.length > 0);
  const groups = doc.repeatingGroupDefs;
  const [nav, setNav] = useState<"level" | "section">(groups.length > 0 ? "level" : "section");
  const [activeItemId, setActiveItemId] = useState<string | null>(groups[0]?.items[0]?.id ?? null);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(doc.sections[0]?.id ?? null);

  const gen = useMemo(() => generateFromValues(doc, values), [doc, values]);
  const previewEntries = Object.entries(gen.findingsMap).filter(([, v]) => !v.normal);

  if (!hasFields) return null;

  const primaryGroup = groups[0];
  const activeItem = primaryGroup?.items.find((i) => i.id === activeItemId) ?? primaryGroup?.items[0];

  const levelSections = activeItem
    ? doc.sections.filter((s) => s.repeat?.groupId === primaryGroup?.id)
    : [];
  const globalSections = doc.sections.filter((s) => !s.repeat);

  return (
    <div className="rounded-xl border border-indigo-200/80 bg-gradient-to-br from-indigo-50/50 via-white to-violet-50/30 p-2.5 shadow-sm" data-testid="structured-format-panel">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-gradient-to-br from-indigo-500 to-violet-600 text-[10px] font-black text-white">S</span>
        <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-900">Structured</div>
        {groups.length > 0 && (
          <div className="inline-flex rounded border overflow-hidden text-[10px]">
            <button type="button" className={`px-2 py-0.5 ${nav === "level" ? "bg-indigo-600 text-white" : "bg-white"}`} onClick={() => setNav("level")}>By level</button>
            <button type="button" className={`px-2 py-0.5 ${nav === "section" ? "bg-indigo-600 text-white" : "bg-white"}`} onClick={() => setNav("section")}>By section</button>
          </div>
        )}
        <Button type="button" size="sm" variant="outline" className="h-6 text-[10px] ml-auto" disabled={disabled} onClick={onLoadAllNormals}>
          Load all normals
        </Button>
      </div>

      {nav === "level" && primaryGroup && (
        <>
          <div className="flex flex-wrap gap-1 mb-2">
            {primaryGroup.items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveItemId(item.id)}
                className={`h-6 px-2 text-[10px] rounded-md border font-semibold ${activeItem?.id === item.id ? "bg-indigo-600 text-white border-indigo-700" : "bg-white hover:bg-indigo-50"}`}
              >
                {item.label}
              </button>
            ))}
          </div>
          {globalSections.map((s) => (
            <SectionFields
              key={s.id}
              doc={doc}
              sectionId={s.id}
              label={s.label}
              fields={s.fields}
              values={values}
              disabled={disabled}
              onChange={onValuesChange}
              onSetNormal={() => onValuesChange(setNormalForMapKey(doc, values, s.label))}
            />
          ))}
          {activeItem && levelSections.map((s) => (
            <SectionFields
              key={`${s.id}-${activeItem.id}`}
              doc={doc}
              sectionId={s.id}
              groupItemId={activeItem.id}
              label={`${s.label} · ${activeItem.label}`}
              fields={s.fields}
              values={values}
              disabled={disabled}
              onChange={onValuesChange}
              onSetNormal={() => onValuesChange(setNormalForMapKey(doc, values, activeItem.label))}
            />
          ))}
        </>
      )}

      {nav === "section" && (
        <>
          <div className="flex flex-wrap gap-1 mb-2">
            {doc.sections.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveSectionId(s.id)}
                className={`h-6 px-2 text-[10px] rounded-md border ${activeSectionId === s.id ? "bg-indigo-600 text-white" : "bg-white"}`}
              >
                {s.label}
              </button>
            ))}
          </div>
          {doc.sections.filter((s) => s.id === activeSectionId).map((s) => {
            if (s.repeat) {
              const g = groups.find((x) => x.id === s.repeat!.groupId);
              return (
                <div key={s.id} className="space-y-2">
                  {g?.items.map((item) => (
                    <SectionFields
                      key={item.id}
                      doc={doc}
                      sectionId={s.id}
                      groupItemId={item.id}
                      label={`${s.label} · ${item.label}`}
                      fields={s.fields}
                      values={values}
                      disabled={disabled}
                      onChange={onValuesChange}
                      onSetNormal={() => onValuesChange(setNormalForMapKey(doc, values, item.label))}
                    />
                  ))}
                </div>
              );
            }
            return (
              <SectionFields
                key={s.id}
                doc={doc}
                sectionId={s.id}
                label={s.label}
                fields={s.fields}
                values={values}
                disabled={disabled}
                onChange={onValuesChange}
                onSetNormal={() => onValuesChange(setNormalForMapKey(doc, values, s.label))}
              />
            );
          })}
        </>
      )}

      <div className="mt-2 rounded-md border bg-white/70 p-2" data-testid="structured-live-preview">
        <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">Generated findings</p>
        {previewEntries.length === 0 ? (
          <p className="text-[11px] italic text-muted-foreground">All sections normal — change a level to generate prose.</p>
        ) : previewEntries.map(([label, v]) => (
          <p key={label} className="text-[11px]"><span className="font-semibold">{label}:</span> {v.text}</p>
        ))}
      </div>
    </div>
  );
}

function SectionFields({
  doc,
  sectionId,
  groupItemId,
  label,
  fields,
  values,
  disabled,
  onChange,
  onSetNormal,
}: {
  doc: StructuredFormatDoc;
  sectionId: string;
  groupItemId?: string;
  label: string;
  fields: FormatField[];
  values: StructuredValues;
  disabled?: boolean;
  onChange: (next: StructuredValues) => void;
  onSetNormal: () => void;
}) {
  if (fields.length === 0) return null;
  return (
    <div className="rounded-md border bg-white/60 p-2 mb-2 space-y-1.5">
      <div className="flex items-center gap-2">
        <p className="text-[11px] font-bold flex-1">{label}</p>
        <Button type="button" size="sm" variant="outline" className="h-5 text-[9px]" disabled={disabled} onClick={onSetNormal}>
          Set Normal
        </Button>
      </div>
      {fields.map((field) => {
        const path: FieldPath = { sectionId, groupItemId, fieldId: field.id };
        const key = serializeFieldPath(path);
        return (
          <FieldControl
            key={key}
            field={field}
            value={values[key]}
            disabled={disabled}
            onChange={(v) => onChange(applyFieldValue(doc, values, path, v))}
          />
        );
      })}
    </div>
  );
}

function FieldControl({
  field, value, onChange, disabled,
}: {
  field: FormatField;
  value: FieldValue | undefined;
  onChange: (v: FieldValue) => void;
  disabled?: boolean;
}) {
  if (field.type === "text" || field.type === "textarea") {
    return (
      <label className="block text-[10px] space-y-0.5">
        {field.label}
        <textarea
          disabled={disabled}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          rows={field.type === "textarea" ? 2 : 1}
          className="w-full p-1 rounded border text-[11px]"
        />
      </label>
    );
  }
  if (field.type === "number" || field.type === "measurement") {
    return (
      <label className="flex items-center gap-1 text-[10px]">
        <span className="w-28 shrink-0">{field.label}</span>
        <input
          type="number"
          disabled={disabled}
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          className="h-6 w-24 px-1 rounded border text-[11px]"
        />
        {field.unit && <span className="text-muted-foreground">{field.unit}</span>}
      </label>
    );
  }
  if (field.type === "toggle" || field.type === "checkbox") {
    const on = value === true || value === "yes" || value === "true";
    return (
      <label className="flex items-center gap-2 text-[11px]">
        <input type="checkbox" disabled={disabled} checked={on} onChange={(e) => onChange(e.target.checked)} />
        {field.label}
      </label>
    );
  }
  if (field.type === "multi_select") {
    const selected = Array.isArray(value) ? value.map(String) : [];
    return (
      <div className="text-[10px] space-y-0.5">
        <p>{field.label}</p>
        <div className="flex flex-wrap gap-1">
          {field.options.map((o) => {
            const on = selected.includes(o.id) || selected.includes(o.value);
            return (
              <button
                key={o.id}
                type="button"
                disabled={disabled}
                onClick={() => {
                  const next = on ? selected.filter((x) => x !== o.id && x !== o.value) : [...selected, o.id];
                  onChange(next);
                }}
                className={`h-6 px-2 rounded border ${on ? "bg-indigo-600 text-white" : "bg-white"}`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </div>
    );
  }
  // single_select / radio / laterality / grade / normal_abnormal
  return (
    <div className="text-[10px] space-y-0.5">
      <p>{field.label}</p>
      <div className="flex flex-wrap gap-1">
        {field.options.map((o) => {
          const on = value === o.id || value === o.value;
          return (
            <button
              key={o.id}
              type="button"
              disabled={disabled}
              onClick={() => onChange(on ? null : o.id)}
              className={`h-6 px-2 rounded border ${on ? "bg-indigo-600 text-white" : "bg-white"}`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Debounce helper for repeating-group field bursts. */
export function useDebouncedCallback<Args extends unknown[]>(fn: (...args: Args) => void, ms: number): (...args: Args) => void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const t = useRef<number | null>(null);
  return useMemo(() => {
    return (...args: Args) => {
      if (t.current) window.clearTimeout(t.current);
      t.current = window.setTimeout(() => fnRef.current(...args), ms);
    };
  }, [ms]);
}

export function formatHasStructuredFields(sectionsJson: string | null | undefined): boolean {
  return adaptSectionsJson(sectionsJson).sections.some((s) => s.fields.length > 0);
}
