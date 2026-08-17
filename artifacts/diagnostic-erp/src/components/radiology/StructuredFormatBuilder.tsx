import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Save, X, Plus, Trash2, ChevronDown, ChevronUp, Copy } from "lucide-react";
import {
  OPTION_BUNDLES,
  adaptSectionsJson,
  allNormalFindingsMap,
  emptyFormatDoc,
  generateFromValues,
  MRI_LS_SPINE_CARE_STANDARD,
  previewCopiedLevelUpgrade,
  slugId,
  v1AllNormalFindingsMap,
  type FieldType,
  type FormatField,
  type FormatOption,
  type FormatSection,
  type RepeatingGroupDef,
  type StructuredFormatDoc,
} from "@/lib/structuredFormat";

const MODALITIES = ["MRI", "CT", "USG", "X-RAY", "DOPPLER", "ECHO", "PET-CT", "FLUOROSCOPY", "OTHER"];
const BODY_PARTS = ["BRAIN", "SPINE_LS", "SPINE_CERVICAL", "SPINE_DORSAL", "CHEST", "ABDOMEN", "PELVIS", "CARDIAC", "NECK", "KNEE", "SHOULDER", "HIP", "CAROTID", "OTHER"];
const FIELD_TYPES: FieldType[] = [
  "single_select", "multi_select", "checkbox", "radio", "toggle",
  "text", "textarea", "number", "measurement", "laterality", "grade", "normal_abnormal",
];
const SEVERITIES = ["normal", "mild", "moderate", "severe", "critical"] as const;

export type TemplateMeta = {
  id?: number;
  templateName: string;
  modality: string;
  bodyPart: string;
  studyType: string;
  defaultFindings: string;
  defaultImpression: string;
  isActive: boolean;
  isDefault: boolean;
  tags: string;
  schemaVersion: number;
  formatVersion: number;
  previousVersions: string;
  sectionsJson: string | null;
  macrosJson: string | null;
  isPreset?: boolean;
};

type Props = {
  template?: TemplateMeta;
  onSave: (data: Record<string, unknown>) => void;
  onClose: () => void;
};

type Tab = "meta" | "groups" | "sections" | "preview";

function newSection(label: string, index: number): FormatSection {
  return {
    id: slugId(label, `section-${index}`),
    label,
    headingVisible: true,
    required: false,
    collapsedByDefault: false,
    contributesTo: ["findings"],
    defaultText: "",
    normalText: "",
    fields: [],
  };
}

export function StructuredFormatBuilder({ template, onSave, onClose }: Props) {
  const initial = useMemo(() => adaptSectionsJson(template?.sectionsJson), [template?.sectionsJson]);
  const [tab, setTab] = useState<Tab>("meta");
  const [name, setName] = useState(template?.templateName ?? "");
  const [modality, setModality] = useState(template?.modality ?? "MRI");
  const [bodyPart, setBodyPart] = useState(template?.bodyPart ?? "SPINE_LS");
  const [studyType, setStudyType] = useState(template?.studyType ?? "PLAIN");
  const [defaultFindings, setDefaultFindings] = useState(template?.defaultFindings ?? "");
  const [defaultImpression, setDefaultImpression] = useState(template?.defaultImpression ?? "");
  const [isActive, setIsActive] = useState(template?.isActive ?? true);
  const [isDefault, setIsDefault] = useState(template?.isDefault ?? false);
  const [tags, setTags] = useState(template?.tags ?? "");
  const [doc, setDoc] = useState<StructuredFormatDoc>(initial);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(initial.sections[0]?.id ?? null);
  const [upgradeDismissed, setUpgradeDismissed] = useState(false);
  const [showUpgradeDiff, setShowUpgradeDiff] = useState(false);

  const upgrade = useMemo(() => {
    try {
      return previewCopiedLevelUpgrade(JSON.parse(template?.sectionsJson || "{}"));
    } catch {
      return previewCopiedLevelUpgrade({});
    }
  }, [template?.sectionsJson]);
  const selected = doc.sections.find((s) => s.id === selectedSectionId) ?? null;
  const previewMap = useMemo(() => allNormalFindingsMap(doc), [doc]);

  function patchSection(id: string, patch: Partial<FormatSection>) {
    setDoc((d) => ({ ...d, sections: d.sections.map((s) => s.id === id ? { ...s, ...patch } : s) }));
  }

  function handleSave() {
    const newSectionsJson = JSON.stringify(doc);
    const sectionsChanged = template?.sectionsJson !== newSectionsJson;
    const prev = template?.id && sectionsChanged && template.sectionsJson
      ? safePrev(template.previousVersions, template.sectionsJson, template.formatVersion)
      : (template?.previousVersions ?? "[]");
    onSave({
      templateName: name,
      modality,
      bodyPart,
      studyType: studyType || null,
      sectionsJson: newSectionsJson,
      defaultFindings,
      defaultImpression,
      macrosJson: template?.macrosJson ?? "[]",
      isActive,
      isDefault,
      tags,
      schemaVersion: 2,
      formatVersion: (template?.formatVersion ?? 1) + (template?.id && sectionsChanged ? 1 : 0),
      previousVersions: prev,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-4xl h-full bg-background border-l shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h2 className="text-base font-semibold">{template?.id ? "Edit format" : "New structured format"}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted"><X size={16} /></button>
        </div>
        <div className="flex gap-1 px-5 py-2 border-b text-xs">
          {(["meta", "groups", "sections", "preview"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`h-7 px-3 rounded-md capitalize ${tab === t ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            >
              {t}
            </button>
          ))}
          <Button size="sm" variant="outline" className="h-7 ml-auto text-[11px]" onClick={() => {
            setDoc(MRI_LS_SPINE_CARE_STANDARD);
            setName((n) => n || "MRI Lumbosacral Spine – CARE Standard");
            setModality("MRI");
            setBodyPart("SPINE_LS");
            setTab("sections");
          }}>
            Load LS Spine example
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {tab === "meta" && (
            <div className="grid grid-cols-2 gap-3">
              <label className="col-span-2 text-xs space-y-1">Name
                <input value={name} onChange={(e) => setName(e.target.value)} className="w-full h-9 px-3 rounded-lg border bg-background" />
              </label>
              <label className="text-xs space-y-1">Modality
                <select value={modality} onChange={(e) => setModality(e.target.value)} className="w-full h-9 px-3 rounded-lg border bg-background">
                  {MODALITIES.map((m) => <option key={m}>{m}</option>)}
                </select>
              </label>
              <label className="text-xs space-y-1">Body region
                <select value={bodyPart} onChange={(e) => setBodyPart(e.target.value)} className="w-full h-9 px-3 rounded-lg border bg-background">
                  {BODY_PARTS.map((b) => <option key={b}>{b}</option>)}
                </select>
              </label>
              <label className="col-span-2 text-xs space-y-1">Study / examination
                <input value={studyType} onChange={(e) => setStudyType(e.target.value)} className="w-full h-9 px-3 rounded-lg border bg-background" placeholder="PLAIN, CONTRAST…" />
              </label>
              <label className="col-span-2 text-xs space-y-1">Tags
                <input value={tags} onChange={(e) => setTags(e.target.value)} className="w-full h-9 px-3 rounded-lg border bg-background" placeholder="spine, mri, care-standard" />
              </label>
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Active</label>
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} /> Default for this region</label>
              <label className="col-span-2 text-xs space-y-1">Default normal findings
                <textarea value={defaultFindings} onChange={(e) => setDefaultFindings(e.target.value)} rows={3} className="w-full p-2 rounded-lg border bg-background" />
              </label>
              <label className="col-span-2 text-xs space-y-1">Default impression
                <textarea value={defaultImpression} onChange={(e) => setDefaultImpression(e.target.value)} rows={2} className="w-full p-2 rounded-lg border bg-background" />
              </label>
              <label className="col-span-2 text-xs space-y-1">Technique (generated into Technique when empty/merged)
                <textarea value={doc.technique ?? ""} onChange={(e) => setDoc((d) => ({ ...d, technique: e.target.value }))} rows={2} className="w-full p-2 rounded-lg border bg-background" />
              </label>
              {upgrade.copiedCount >= 3 && !upgradeDismissed && (
                <div className="col-span-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs space-y-2" data-testid="format-upgrade-banner">
                  <p className="font-semibold text-amber-900">{upgrade.reason}</p>
                  <p>Levels: {upgrade.itemLabels.join(", ")}</p>
                  {showUpgradeDiff && upgrade.proposed && (
                    <div className="grid grid-cols-2 gap-2 max-h-48 overflow-auto bg-white/80 rounded border p-2" data-testid="format-upgrade-diff">
                      <div>
                        <p className="font-semibold mb-1">Current (all-normal)</p>
                        {Object.entries(v1AllNormalFindingsMap(JSON.parse(template?.sectionsJson || "{}"))).map(([k, v]) => (
                          <p key={k}><span className="font-medium">{k}:</span> {v.text}</p>
                        ))}
                      </div>
                      <div>
                        <p className="font-semibold mb-1">Repeating-group (all-normal)</p>
                        {Object.entries(allNormalFindingsMap(upgrade.proposed)).map(([k, v]) => (
                          <p key={k}><span className="font-medium">{k}:</span> {v.text}</p>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => setShowUpgradeDiff((v) => !v)}>
                      {showUpgradeDiff ? "Hide Diff" : "Show Diff"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="h-7"
                      disabled={!upgrade.allNormalIdentical || !upgrade.proposed}
                      onClick={() => { if (upgrade.proposed && upgrade.allNormalIdentical) { setDoc(upgrade.proposed); setTab("groups"); } }}
                    >
                      Apply Upgrade
                    </Button>
                    <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => setUpgradeDismissed(true)}>
                      Keep Current
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "groups" && (
            <RepeatingGroupsEditor doc={doc} setDoc={setDoc} />
          )}

          {tab === "sections" && (
            <div className="grid grid-cols-[220px_1fr] gap-4 min-h-[480px]">
              <div className="space-y-1">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-semibold uppercase text-muted-foreground">Sections</span>
                  <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => {
                    const s = newSection("New section", doc.sections.length + 1);
                    setDoc((d) => ({ ...d, sections: [...d.sections, s] }));
                    setSelectedSectionId(s.id);
                  }}><Plus size={10} /> Add</Button>
                </div>
                {doc.sections.map((s, i) => (
                  <div key={s.id} className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${selectedSectionId === s.id ? "bg-primary/10 font-medium" : "hover:bg-muted"}`}>
                    <button className="flex-1 text-left truncate" onClick={() => setSelectedSectionId(s.id)}>{s.label}</button>
                    <button className="text-muted-foreground" disabled={i === 0} onClick={() => moveSection(doc, setDoc, i, -1)}><ChevronUp size={12} /></button>
                    <button className="text-muted-foreground" disabled={i === doc.sections.length - 1} onClick={() => moveSection(doc, setDoc, i, 1)}><ChevronDown size={12} /></button>
                    <button className="text-muted-foreground hover:text-red-500" onClick={() => {
                      setDoc((d) => ({ ...d, sections: d.sections.filter((x) => x.id !== s.id) }));
                      if (selectedSectionId === s.id) setSelectedSectionId(doc.sections[0]?.id ?? null);
                    }}><Trash2 size={12} /></button>
                  </div>
                ))}
              </div>
              {selected ? (
                <SectionEditor
                  section={selected}
                  groups={doc.repeatingGroupDefs}
                  onChange={(patch) => patchSection(selected.id, patch)}
                  onDuplicate={() => {
                    const copy = { ...selected, id: `${selected.id}-copy`, label: `${selected.label} (copy)` };
                    setDoc((d) => ({ ...d, sections: [...d.sections, copy] }));
                    setSelectedSectionId(copy.id);
                  }}
                />
              ) : <p className="text-xs text-muted-foreground">Add a section to begin.</p>}
            </div>
          )}

          {tab === "preview" && (
            <div className="space-y-2 text-xs">
              <p className="font-semibold">All-normal generated Findings (live)</p>
              {Object.entries(previewMap).map(([label, v]) => (
                <div key={label} className="rounded border p-2">
                  <p className="font-medium">{label}</p>
                  <p className="text-muted-foreground mt-0.5">{v.text || "—"}</p>
                </div>
              ))}
              <p className="text-muted-foreground">Tokens: {(doc.tokens ?? []).map((t) => `{${t}}`).join(" ")}</p>
              {generateFromValues(doc, {}).impressionCandidates.length === 0 && (
                <p className="italic text-muted-foreground">No impression candidates until abnormal options with weight &gt; 0 are selected in the workspace.</p>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-3 px-5 py-3 border-t">
          <Button onClick={handleSave} className="flex-1 gap-2"><Save size={14} /> Save format</Button>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}

function moveSection(doc: StructuredFormatDoc, setDoc: (fn: (d: StructuredFormatDoc) => StructuredFormatDoc) => void, index: number, dir: number) {
  const next = index + dir;
  if (next < 0 || next >= doc.sections.length) return;
  setDoc((d) => {
    const sections = [...d.sections];
    const [row] = sections.splice(index, 1);
    sections.splice(next, 0, row!);
    return { ...d, sections };
  });
}

function RepeatingGroupsEditor({ doc, setDoc }: { doc: StructuredFormatDoc; setDoc: (fn: (d: StructuredFormatDoc) => StructuredFormatDoc) => void }) {
  return (
    <div className="space-y-3">
      <div className="flex justify-between">
        <p className="text-xs font-semibold">Repeating anatomical groups</p>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setDoc((d) => ({
          ...d,
          repeatingGroupDefs: [...d.repeatingGroupDefs, { id: `group-${d.repeatingGroupDefs.length + 1}`, label: "New group", itemToken: "level", items: [] }],
        }))}><Plus size={10} /> Add group</Button>
      </div>
      {doc.repeatingGroupDefs.map((g) => (
        <div key={g.id} className="border rounded-lg p-3 space-y-2">
          <div className="flex gap-2">
            <input value={g.label} onChange={(e) => patchGroup(setDoc, g.id, { label: e.target.value })} className="flex-1 h-8 px-2 text-xs rounded border" />
            <input value={g.itemToken} onChange={(e) => patchGroup(setDoc, g.id, { itemToken: e.target.value })} className="w-28 h-8 px-2 text-xs rounded border" title="Token, e.g. level" />
            <button className="text-red-500" onClick={() => setDoc((d) => ({ ...d, repeatingGroupDefs: d.repeatingGroupDefs.filter((x) => x.id !== g.id) }))}><Trash2 size={13} /></button>
          </div>
          {g.items.map((item, i) => (
            <div key={item.id} className="flex gap-2">
              <input value={item.label} onChange={(e) => patchGroupItem(setDoc, g.id, i, e.target.value)} className="flex-1 h-7 px-2 text-xs rounded border" />
              <button className="text-red-500" onClick={() => setDoc((d) => ({
                ...d,
                repeatingGroupDefs: d.repeatingGroupDefs.map((x) => x.id === g.id ? { ...x, items: x.items.filter((_, j) => j !== i) } : x),
              }))}><Trash2 size={12} /></button>
            </div>
          ))}
          <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => setDoc((d) => ({
            ...d,
            repeatingGroupDefs: d.repeatingGroupDefs.map((x) => x.id === g.id
              ? { ...x, items: [...x.items, { id: slugId(`item-${x.items.length + 1}`, `i${x.items.length + 1}`), label: "" }] }
              : x),
          }))}><Plus size={10} /> Add item</Button>
        </div>
      ))}
      {doc.repeatingGroupDefs.length === 0 && <p className="text-xs text-muted-foreground">Optional. Use for disc levels, compartments, quadrants — define fields once.</p>}
    </div>
  );
}

function patchGroup(setDoc: (fn: (d: StructuredFormatDoc) => StructuredFormatDoc) => void, id: string, patch: Partial<RepeatingGroupDef>) {
  setDoc((d) => ({ ...d, repeatingGroupDefs: d.repeatingGroupDefs.map((g) => g.id === id ? { ...g, ...patch } : g) }));
}
function patchGroupItem(setDoc: (fn: (d: StructuredFormatDoc) => StructuredFormatDoc) => void, id: string, index: number, label: string) {
  setDoc((d) => ({
    ...d,
    repeatingGroupDefs: d.repeatingGroupDefs.map((g) => g.id === id
      ? { ...g, items: g.items.map((it, i) => i === index ? { ...it, label, id: slugId(label, it.id) } : it) }
      : g),
  }));
}

function SectionEditor({
  section, groups, onChange, onDuplicate,
}: {
  section: FormatSection;
  groups: RepeatingGroupDef[];
  onChange: (patch: Partial<FormatSection>) => void;
  onDuplicate: () => void;
}) {
  const [openField, setOpenField] = useState<string | null>(section.fields[0]?.id ?? null);
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input value={section.label} onChange={(e) => onChange({ label: e.target.value })} className="flex-1 h-8 px-2 text-sm rounded border" />
        <Button size="sm" variant="outline" className="h-8 text-[10px] gap-1" onClick={onDuplicate}><Copy size={10} /> Duplicate</Button>
      </div>
      <label className="text-xs space-y-1 block">Normal text
        <textarea value={section.normalText} onChange={(e) => onChange({ normalText: e.target.value, defaultText: e.target.value })} rows={2} className="w-full p-2 rounded border text-xs" />
      </label>
      <div className="flex flex-wrap gap-3 text-[11px]">
        <label className="flex gap-1 items-center"><input type="checkbox" checked={section.headingVisible} onChange={(e) => onChange({ headingVisible: e.target.checked })} /> Show heading</label>
        <label className="flex gap-1 items-center"><input type="checkbox" checked={section.required} onChange={(e) => onChange({ required: e.target.checked })} /> Mandatory</label>
        {(["findings", "technique", "impression", "recommendation"] as const).map((c) => (
          <label key={c} className="flex gap-1 items-center">
            <input
              type="checkbox"
              checked={section.contributesTo.includes(c)}
              onChange={(e) => {
                const next = e.target.checked
                  ? [...section.contributesTo, c]
                  : section.contributesTo.filter((x) => x !== c);
                onChange({ contributesTo: next });
              }}
            /> {c}
          </label>
        ))}
      </div>
      <label className="text-xs space-y-1 block">Repeat for group
        <select
          value={section.repeat?.groupId ?? ""}
          onChange={(e) => onChange({ repeat: e.target.value ? { groupId: e.target.value } : undefined })}
          className="w-full h-8 px-2 rounded border bg-background"
        >
          <option value="">— none —</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
        </select>
      </label>
      <div className="flex justify-between items-center">
        <p className="text-xs font-semibold">Fields</p>
        <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => {
          const f: FormatField = { id: `field-${section.fields.length + 1}`, label: "New field", type: "single_select", options: [] };
          onChange({ fields: [...section.fields, f] });
          setOpenField(f.id);
        }}><Plus size={10} /> Add field</Button>
      </div>
      {section.fields.map((field) => (
        <FieldEditor
          key={field.id}
          field={field}
          open={openField === field.id}
          onToggle={() => setOpenField(openField === field.id ? null : field.id)}
          onChange={(patch) => onChange({ fields: section.fields.map((x) => x.id === field.id ? { ...x, ...patch } : x) })}
          onDelete={() => onChange({ fields: section.fields.filter((x) => x.id !== field.id) })}
        />
      ))}
    </div>
  );
}

function FieldEditor({
  field, open, onToggle, onChange, onDelete,
}: {
  field: FormatField;
  open: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<FormatField>) => void;
  onDelete: () => void;
}) {
  return (
    <div className="border rounded-lg p-2 space-y-2">
      <div className="flex gap-2 items-center">
        <button className="text-xs font-medium flex-1 text-left" onClick={onToggle}>{field.label || field.id} · {field.type}</button>
        <button className="text-red-500" onClick={onDelete}><Trash2 size={12} /></button>
      </div>
      {open && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input value={field.label} onChange={(e) => onChange({ label: e.target.value })} className="h-7 px-2 text-xs rounded border" placeholder="Label" />
            <select value={field.type} onChange={(e) => onChange({ type: e.target.value as FieldType })} className="h-7 px-2 text-xs rounded border bg-background">
              {FIELD_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
            <input value={field.token ?? ""} onChange={(e) => onChange({ token: e.target.value || undefined })} className="h-7 px-2 text-xs rounded border" placeholder="Token e.g. severity" />
            <input value={field.unit ?? ""} onChange={(e) => onChange({ unit: e.target.value || undefined })} className="h-7 px-2 text-xs rounded border" placeholder="Unit e.g. mm" />
            <input value={field.mutexGroup ?? ""} onChange={(e) => onChange({ mutexGroup: e.target.value || undefined })} className="h-7 px-2 text-xs rounded border col-span-2" placeholder="Mutex group id e.g. disc-morphology" />
            <select value={field.combineMode ?? "separate_sentences"} onChange={(e) => onChange({ combineMode: e.target.value as FormatField["combineMode"] })} className="h-7 px-2 text-xs rounded border bg-background col-span-2">
              <option value="separate_sentences">multi-select: separate sentences</option>
              <option value="comma_list">multi-select: comma list</option>
              <option value="conjunction">multi-select: A, B, and C</option>
            </select>
            <select
              className="h-7 px-2 text-xs rounded border bg-background col-span-2"
              defaultValue=""
              onChange={(e) => {
                const b = OPTION_BUNDLES.find((x) => x.id === e.target.value);
                if (!b) return;
                onChange({ options: b.options, mutexGroup: b.mutexGroup, label: field.label || b.label });
              }}
            >
              <option value="">Apply option template…</option>
              {OPTION_BUNDLES.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>
          </div>
          {field.options.map((opt, i) => (
            <div key={opt.id} className="rounded bg-muted/30 p-2 space-y-1">
              <div className="flex gap-1">
                <input value={opt.label} onChange={(e) => updateOpt(field, i, { label: e.target.value }, onChange)} className="flex-1 h-6 px-1 text-[11px] rounded border" placeholder="Display label" />
                <select value={opt.severity ?? ""} onChange={(e) => updateOpt(field, i, { severity: (e.target.value || undefined) as FormatOption["severity"] }, onChange)} className="h-6 text-[11px] rounded border bg-background">
                  <option value="">severity</option>
                  {SEVERITIES.map((s) => <option key={s}>{s}</option>)}
                </select>
                <input type="number" step="0.05" min={0} max={1} value={opt.impressionWeight ?? 0} onChange={(e) => updateOpt(field, i, { impressionWeight: Number(e.target.value) }, onChange)} className="w-16 h-6 px-1 text-[11px] rounded border" title="impressionWeight" />
                <button className="text-red-500" onClick={() => onChange({ options: field.options.filter((_, j) => j !== i) })}><Trash2 size={11} /></button>
              </div>
              <input value={opt.outputSentence ?? ""} onChange={(e) => updateOpt(field, i, { outputSentence: e.target.value }, onChange)} className="w-full h-6 px-1 text-[11px] rounded border" placeholder='Finding output: "{severity} bulge at {level}."' />
              <input value={opt.impressionSentence ?? ""} onChange={(e) => updateOpt(field, i, { impressionSentence: e.target.value }, onChange)} className="w-full h-6 px-1 text-[11px] rounded border" placeholder="Impression sentence (weight &gt; 0)" />
              <input value={opt.canonicalKey ?? ""} onChange={(e) => updateOpt(field, i, { canonicalKey: e.target.value || undefined }, onChange)} className="w-full h-6 px-1 text-[11px] rounded border" placeholder="canonicalKey e.g. lumbar.loss_of_lordosis" />
            </div>
          ))}
          <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => onChange({
            options: [...field.options, { id: `opt-${field.options.length + 1}`, label: "", value: `opt-${field.options.length + 1}` }],
          })}><Plus size={10} /> Option</Button>
        </div>
      )}
    </div>
  );
}

function updateOpt(field: FormatField, index: number, patch: Partial<FormatOption>, onChange: (p: Partial<FormatField>) => void) {
  onChange({
    options: field.options.map((o, i) => i === index ? { ...o, ...patch, value: patch.label ? slugId(patch.label, o.id) : o.value } : o),
  });
}

export function safePrev(existing: string | undefined, sectionsJson: string, formatVersion: number | undefined): string {
  try {
    const arr = JSON.parse(existing || "[]") as unknown[];
    const lastEntry = arr[arr.length - 1] as Record<string, unknown> | undefined;
    if (lastEntry && lastEntry.sectionsJson === sectionsJson) {
      return existing || "[]";
    }
    arr.push({ archivedAt: new Date().toISOString(), formatVersion: formatVersion ?? 1, sectionsJson });
    return JSON.stringify(arr.slice(-20));
  } catch {
    return JSON.stringify([{ archivedAt: new Date().toISOString(), formatVersion: 1, sectionsJson }]);
  }
}

export { emptyFormatDoc };
