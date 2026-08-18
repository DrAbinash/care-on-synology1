/**
 * CARE letter-pad chrome shared by Word/PDF export and the Settings template editor.
 * Mirrors artifacts/api-server/src/lib/careLetterheadChrome.ts — keep copy in sync.
 */

export type CareLetterpadChrome = {
  kind?: "care-letterpad" | "clinic";
  clinicName?: string;
  addressLine1?: string;
  addressLine2?: string;
  phones?: string;
  email?: string;
  website?: string;
  logoHeight?: string;
  addressFontSize?: string;
  radiologist?: string;
  credentials?: string;
  servicesRow1?: string;
  servicesRow2?: string;
  disclaimer?: string;
};

export const DEFAULT_CARE_LETTERPAD: Required<Pick<
  CareLetterpadChrome,
  | "kind"
  | "clinicName"
  | "addressLine1"
  | "addressLine2"
  | "phones"
  | "email"
  | "website"
  | "logoHeight"
  | "addressFontSize"
  | "radiologist"
  | "credentials"
  | "servicesRow1"
  | "servicesRow2"
  | "disclaimer"
>> = {
  kind: "care-letterpad",
  clinicName: "CARE DIAGNOSTICS",
  addressLine1: "Near Bajla Mahila College, St. Francis School Road, Castair's Town, DEOGHAR-814 112",
  addressLine2: "(JHARKHAND)",
  phones: "75490 99099, 99734 97200",
  email: "care.deoghar@gmail.com",
  website: "www.caredeoghar.com",
  logoHeight: "22mm",
  addressFontSize: "7.2pt",
  radiologist: "Dr. Sugandha Priyadarshini",
  credentials: "MD (Radiodiagnosis & Medical Imaging)",
  servicesRow1: "MULTI SLICE CT SCAN  |  3D/4D ULTRA SOUND  |  COLOUR DOPPLER  |  MAMMOGRAPHY  |  ECHO  |  DIGITAL X-RAY  |  ECG/EEG",
  servicesRow2: "PATHOLAB  |  OPG  |  TMT  |  NCV/EMG  |  ELASTOGRAPHY/ FIBROSCAN  |  UPPER GI ENDOSCOPY  |  HSG  |  BARIUM STUDY  |  TVS",
  disclaimer: "Radiological diagnosis is not always conclusive & often vary with clinical course of the disease or response to treatment. This report is not for medico-legal purpose.",
};

export function resolveCareLetterpadChrome(letterhead?: CareLetterpadChrome | null): typeof DEFAULT_CARE_LETTERPAD {
  const overlay = letterhead ?? {};
  return { ...DEFAULT_CARE_LETTERPAD, ...overlay, kind: overlay.kind ?? DEFAULT_CARE_LETTERPAD.kind };
}

export function parseMeasurementPt(value?: string | null): number | undefined {
  if (!value) return undefined;
  const m = String(value).trim().match(/^(\d{1,3}(?:\.\d{1,2})?)pt$/i);
  return m ? Number(m[1]) : undefined;
}

export function parseMeasurementMm(value?: string | null): number | undefined {
  if (!value) return undefined;
  const m = String(value).trim().match(/^(\d{1,3}(?:\.\d{1,2})?)mm$/i);
  return m ? Number(m[1]) : undefined;
}

export type PresentationTemplatesPayload = {
  active?: Partial<Record<string, string>>;
  templates?: Array<{
    templateKey: string;
    isLatest?: boolean;
    definition?: { letterhead?: CareLetterpadChrome };
  }>;
};

/** Latest published letterhead for the active standard template. */
export function activeStandardLetterhead(data?: PresentationTemplatesPayload | null): CareLetterpadChrome | undefined {
  const key = data?.active?.standard;
  if (!key || !data?.templates) return undefined;
  const matches = data.templates.filter((t) => t.templateKey === key);
  const latest = matches.find((t) => t.isLatest === true) ?? matches[matches.length - 1];
  return latest?.definition?.letterhead;
}
