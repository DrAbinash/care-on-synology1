/**
 * Physician-managed personal snippet templates for the reporting cockpit.
 * Stored locally so radiologists can build a library from the UI without
 * touching code or waiting on the full report-format admin flow.
 */

export type PersonalTemplateTarget = "findings" | "impression";

export interface PersonalReportTemplate {
  id: string;
  name: string;
  text: string;
  /** Which field this snippet was saved from / prefers to insert into. */
  target: PersonalTemplateTarget;
  createdAt: string;
}

export const PERSONAL_TEMPLATES_STORAGE_KEY = "care_personal_report_templates_v1";

const SEED: PersonalReportTemplate[] = [
  {
    id: "seed-normal-chest-xr",
    name: "Normal Chest XR",
    text: "The lungs are clear. Heart size is within normal limits. No pleural effusion or pneumothorax.",
    target: "findings",
    createdAt: "1970-01-01T00:00:00.000Z",
  },
  {
    id: "seed-ct-brain-normal",
    name: "CT Brain Normal",
    text: "No acute intracranial hemorrhage, mass effect, or midline shift. Ventricles and basal cisterns are normal.",
    target: "findings",
    createdAt: "1970-01-01T00:00:00.000Z",
  },
];

function safeParse(raw: string | null): PersonalReportTemplate[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed
      .filter((row): row is PersonalReportTemplate => {
        return (
          !!row &&
          typeof row === "object" &&
          typeof (row as PersonalReportTemplate).id === "string" &&
          typeof (row as PersonalReportTemplate).name === "string" &&
          typeof (row as PersonalReportTemplate).text === "string" &&
          ((row as PersonalReportTemplate).target === "findings" ||
            (row as PersonalReportTemplate).target === "impression")
        );
      })
      .map((row) => ({
        id: row.id,
        name: row.name.trim() || "Untitled",
        text: row.text,
        target: row.target,
        createdAt: typeof row.createdAt === "string" ? row.createdAt : new Date().toISOString(),
      }));
  } catch {
    return null;
  }
}

export function readPersonalReportTemplates(
  storage: Pick<Storage, "getItem"> | null | undefined,
): PersonalReportTemplate[] {
  if (!storage) return [...SEED];
  const parsed = safeParse(storage.getItem(PERSONAL_TEMPLATES_STORAGE_KEY));
  if (parsed === null) return [...SEED];
  return parsed;
}

export function writePersonalReportTemplates(
  storage: Pick<Storage, "setItem"> | null | undefined,
  templates: PersonalReportTemplate[],
): void {
  if (!storage) return;
  try {
    storage.setItem(PERSONAL_TEMPLATES_STORAGE_KEY, JSON.stringify(templates));
  } catch {
    /* quota / private mode — ignore */
  }
}

export function createPersonalTemplate(input: {
  name: string;
  text: string;
  target: PersonalTemplateTarget;
  now?: Date;
}): PersonalReportTemplate {
  const now = input.now ?? new Date();
  return {
    id: `pt-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    name: input.name.trim() || "Untitled template",
    text: input.text,
    target: input.target,
    createdAt: now.toISOString(),
  };
}

/** Append a new template; returns the next list (newest first after seeds). */
export function appendPersonalTemplate(
  existing: PersonalReportTemplate[],
  next: PersonalReportTemplate,
): PersonalReportTemplate[] {
  return [next, ...existing.filter((t) => t.id !== next.id)];
}

export function removePersonalTemplate(
  existing: PersonalReportTemplate[],
  id: string,
): PersonalReportTemplate[] {
  return existing.filter((t) => t.id !== id);
}

/**
 * Insert template text into the current field value.
 * Empty field → replace; otherwise append with a blank line separator.
 */
export function insertTemplateText(current: string, snippet: string): string {
  const incoming = snippet.trim();
  if (!incoming) return current;
  const cur = current.trimEnd();
  if (!cur) return incoming;
  return `${cur}\n\n${incoming}`;
}
