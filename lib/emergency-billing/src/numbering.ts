const EMG_RE = /^EMG-(\d{8})-(\d{5})$/;

/** IST calendar YYYYMMDD for emergency bill numbers. */
export function istYyyymmdd(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at).replace(/-/g, "");
}

export function formatEmgBillNumber(yyyymmdd: string, seq: number): string {
  if (!/^\d{8}$/.test(yyyymmdd)) throw new Error("EMG date must be YYYYMMDD");
  if (!Number.isInteger(seq) || seq < 1 || seq > 99999) {
    throw new Error("EMG sequence must be 1–99999");
  }
  return `EMG-${yyyymmdd}-${String(seq).padStart(5, "0")}`;
}

export function parseEmgBillNumber(value: string): { yyyymmdd: string; seq: number } | null {
  const m = EMG_RE.exec(value.trim());
  if (!m) return null;
  return { yyyymmdd: m[1]!, seq: Number(m[2]) };
}

export function isValidEmgBillNumber(value: string): boolean {
  return parseEmgBillNumber(value) != null;
}

export function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}
