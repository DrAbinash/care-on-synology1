/**
 * Privacy helpers for DeepSeek cloud trial payloads.
 * Never send patient demographics / identifiers to cloud.
 */
const PHI_KEY_RE =
  /^(patient|pt)_?(name|id|uhid|mrn|dob|birth|phone|mobile|address|email)$|^(uhid|mrn|dob|accession|accession_?number|referr(er|ing)|physician|doctor_?name|institution|hospital)/i;

const PHI_VALUE_RE =
  /\b(UHID|MRN|DOB|Acc(ession)?\s*#?|Patient\s*ID)\b\s*[:#]?\s*\S+/gi;

export function scrubPhiObject<T extends Record<string, unknown>>(input: T): T {
  const out: Record<string, unknown> = { ...input };
  for (const [k, v] of Object.entries(out)) {
    if (PHI_KEY_RE.test(k)) {
      out[k] = null;
      continue;
    }
    if (typeof v === "string") {
      out[k] = v.replace(PHI_VALUE_RE, "[REDACTED]");
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = scrubPhiObject(v as Record<string, unknown>);
    } else if (Array.isArray(v)) {
      out[k] = v.map((item) =>
        item && typeof item === "object" && !Array.isArray(item)
          ? scrubPhiObject(item as Record<string, unknown>)
          : item,
      );
    }
  }
  return out as T;
}

export function assertNoRawDicomPayload(opts: {
  mimeTypes?: Array<string | null | undefined>;
  filenames?: Array<string | null | undefined>;
}): { ok: true } | { ok: false; safeError: string } {
  for (const m of opts.mimeTypes ?? []) {
    const t = (m ?? "").toLowerCase();
    if (t.includes("dicom") || t === "application/dicom") {
      return { ok: false, safeError: "raw_dicom_upload_forbidden" };
    }
  }
  for (const f of opts.filenames ?? []) {
    const name = (f ?? "").toLowerCase();
    if (name.endsWith(".dcm") || name.endsWith(".dicom")) {
      return { ok: false, safeError: "raw_dicom_upload_forbidden" };
    }
  }
  return { ok: true };
}

/** Heuristic flag when screenshot text may contain burned-in identifiers. */
export function flagPossibleBurnedInPhi(textSamples: string[]): string[] {
  const flags: string[] = [];
  for (const t of textSamples) {
    if (/\b(UHID|MRN|Patient\s*Name|DOB|Acc(ession)?)\b/i.test(t)) {
      flags.push("possible_burned_in_identifier_text");
      break;
    }
  }
  return flags;
}
