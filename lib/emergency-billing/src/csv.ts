import { createHash } from "node:crypto";
import type { EmergencyTransaction } from "./types";
import { CSV_FORMAT } from "./types";
import { isValidEmgBillNumber, isValidUuid } from "./numbering";

export const CSV_COLUMNS = [
  "format",
  "emergency_transaction_uuid",
  "emergency_bill_number",
  "emergency_session_uuid",
  "status",
  "created_at",
  "created_by_staff_id",
  "created_by_staff_name",
  "voided_at",
  "voided_by_staff_name",
  "void_reason",
  "care_patient_id",
  "uhid",
  "first_name",
  "last_name",
  "sex",
  "age_value",
  "age_unit",
  "date_of_birth",
  "mobile",
  "referring_doctor_id",
  "referring_doctor_name",
  "service_ids",
  "service_codes",
  "service_names",
  "quantities",
  "unit_prices",
  "gross_amount",
  "discount_amount",
  "discount_reason",
  "net_amount",
  "amount_received",
  "due_amount",
  "payment_methods",
  "payment_amounts",
  "notes",
  "tariff_synced_at",
] as const;

export function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function csvCell(v: unknown): string {
  if (v == null) return "";
  return csvEscape(String(v));
}

export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function splitPipe(raw: string): string[] {
  if (!raw) return [];
  return raw.split("|").map((s) => s.trim());
}

export function serializeEmergencyCsv(txns: EmergencyTransaction[]): string {
  const header = CSV_COLUMNS.join(",");
  const rows = txns.map((t) => {
    const rec: Record<(typeof CSV_COLUMNS)[number], string> = {
      format: CSV_FORMAT,
      emergency_transaction_uuid: t.emergencyTransactionUuid,
      emergency_bill_number: t.emergencyBillNumber,
      emergency_session_uuid: t.emergencySessionUuid,
      status: t.status,
      created_at: t.createdAt,
      created_by_staff_id: String(t.createdByStaffId),
      created_by_staff_name: t.createdByStaffName,
      voided_at: t.voidedAt ?? "",
      voided_by_staff_name: t.voidedByStaffName ?? "",
      void_reason: t.voidReason ?? "",
      care_patient_id: t.patient.carePatientId != null ? String(t.patient.carePatientId) : "",
      uhid: t.patient.uhid ?? "",
      first_name: t.patient.firstName,
      last_name: t.patient.lastName,
      sex: t.patient.sex,
      age_value: t.patient.ageValue != null ? String(t.patient.ageValue) : "",
      age_unit: t.patient.ageUnit ?? "",
      date_of_birth: t.patient.dateOfBirth ?? "",
      mobile: t.patient.mobile,
      referring_doctor_id: t.referringDoctorId != null ? String(t.referringDoctorId) : "",
      referring_doctor_name: t.referringDoctorName ?? "",
      service_ids: t.lines.map((l) => l.careServiceId).join("|"),
      service_codes: t.lines.map((l) => l.serviceCode).join("|"),
      service_names: t.lines.map((l) => l.serviceName).join("|"),
      quantities: t.lines.map((l) => l.quantity).join("|"),
      unit_prices: t.lines.map((l) => l.unitPrice.toFixed(2)).join("|"),
      gross_amount: t.grossAmount.toFixed(2),
      discount_amount: t.discountAmount.toFixed(2),
      discount_reason: t.discountReason ?? "",
      net_amount: t.netAmount.toFixed(2),
      amount_received: t.amountReceived.toFixed(2),
      due_amount: t.dueAmount.toFixed(2),
      payment_methods: t.payments.map((p) => p.method).join("|"),
      payment_amounts: t.payments.map((p) => p.amount.toFixed(2)).join("|"),
      notes: t.notes ?? "",
      tariff_synced_at: t.tariffSyncedAt ?? "",
    };
    return CSV_COLUMNS.map((c) => csvCell(rec[c])).join(",");
  });
  return [header, ...rows].join("\n") + "\n";
}

export function parseEmergencyCsv(raw: string): { transactions: EmergencyTransaction[]; errors: string[] } {
  const errors: string[] = [];
  const lines = raw.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { transactions: [], errors: ["CSV has no data rows"] };
  const header = parseCsvLine(lines[0]!);
  if (header[0] !== "format" && !header.includes("emergency_transaction_uuid")) {
    return { transactions: [], errors: ["Not a CARE emergency billing CSV"] };
  }
  const idx = (name: string) => header.indexOf(name);
  const transactions: EmergencyTransaction[] = [];
  const seen = new Set<string>();

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]!);
    const get = (name: string) => cols[idx(name)] ?? "";
    const format = get("format") || CSV_FORMAT;
    if (format && format !== CSV_FORMAT) {
      errors.push(`Row ${i + 1}: unsupported format ${format}`);
      continue;
    }
    const uuid = get("emergency_transaction_uuid").trim();
    if (!isValidUuid(uuid)) {
      errors.push(`Row ${i + 1}: invalid emergency_transaction_uuid`);
      continue;
    }
    if (seen.has(uuid)) {
      errors.push(`Row ${i + 1}: duplicate UUID ${uuid} in file`);
      continue;
    }
    seen.add(uuid);
    const billNo = get("emergency_bill_number").trim();
    if (!isValidEmgBillNumber(billNo)) {
      errors.push(`Row ${i + 1}: invalid EMG bill number`);
      continue;
    }
    const ids = splitPipe(get("service_ids"));
    const codes = splitPipe(get("service_codes"));
    const names = splitPipe(get("service_names"));
    const qtys = splitPipe(get("quantities"));
    const prices = splitPipe(get("unit_prices"));
    const linesItems = ids.map((id, n) => {
      const qty = Number(qtys[n] ?? 1);
      const unit = Number(prices[n] ?? 0);
      return {
        careServiceId: Number(id),
        serviceCode: codes[n] ?? "",
        serviceName: names[n] ?? "",
        category: "",
        quantity: qty,
        unitPrice: unit,
        lineGross: Math.round(qty * unit * 100) / 100,
      };
    });
    const methods = splitPipe(get("payment_methods"));
    const amounts = splitPipe(get("payment_amounts"));
    const payments = methods.map((method, n) => ({
      method: (method === "upi" || method === "card" ? method : "cash") as "cash" | "upi" | "card",
      amount: Number(amounts[n] ?? 0),
    })).filter((p) => p.amount > 0);

    const statusRaw = get("status").toUpperCase();
    const status = statusRaw === "VOID" ? "VOID" : statusRaw === "RECONCILED" ? "RECONCILED" : "PENDING";

    transactions.push({
      emergencyTransactionUuid: uuid,
      emergencyBillNumber: billNo,
      emergencySessionUuid: get("emergency_session_uuid"),
      status,
      createdAt: get("created_at"),
      createdByStaffId: Number(get("created_by_staff_id") || 0),
      createdByStaffName: get("created_by_staff_name"),
      voidedAt: get("voided_at") || null,
      voidedByStaffName: get("voided_by_staff_name") || null,
      voidReason: get("void_reason") || null,
      patient: {
        carePatientId: get("care_patient_id") ? Number(get("care_patient_id")) : null,
        uhid: get("uhid") || null,
        firstName: get("first_name"),
        lastName: get("last_name"),
        sex: get("sex") || "O",
        ageValue: get("age_value") ? Number(get("age_value")) : null,
        ageUnit: get("age_unit") || null,
        dateOfBirth: get("date_of_birth") || null,
        mobile: get("mobile"),
      },
      referringDoctorId: get("referring_doctor_id") ? Number(get("referring_doctor_id")) : null,
      referringDoctorName: get("referring_doctor_name") || null,
      lines: linesItems,
      grossAmount: Number(get("gross_amount") || 0),
      discountAmount: Number(get("discount_amount") || 0),
      discountReason: get("discount_reason") || null,
      netAmount: Number(get("net_amount") || 0),
      amountReceived: Number(get("amount_received") || 0),
      dueAmount: Number(get("due_amount") || 0),
      payments,
      notes: get("notes") || null,
      tariffSyncedAt: get("tariff_synced_at") || null,
    });
  }
  return { transactions, errors };
}

export function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
