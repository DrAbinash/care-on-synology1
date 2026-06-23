import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { useListBills, getListBillsQueryKey } from "@workspace/api-client-react";
import type { Bill } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Printer, RefreshCcw, FileText } from "lucide-react";

type ClinicSettings = {
  clinicName?: string | null;
  address?: string | null;
  registrationNo?: string | null;
} | null;

function startOfMonthISO(): string {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function fmtDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function fmtMoney(n: number): string {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

/**
 * FORM 25 (Formerly 3C) (Income-tax Act, 2025) — Form of daily case register
 * (Maintained by practitioners of any system of medicine.)
 *
 * Auto-fetches every paid / partial bill in the selected date range and
 * renders the regulatory 6-column register. Printable on A4.
 */
export default function Form3C() {
  const [dateFrom, setDateFrom] = useState<string>(startOfMonthISO());
  const [dateTo, setDateTo] = useState<string>(todayISO());

  // Bills in range — exclude draft/cancelled (no fees received).
  // Limit high enough for a clinic month; pagination is out of scope here.
  const billsParams = { dateFrom, dateTo, limit: 5000, page: 1 } as const;
  const billsQuery = useListBills(billsParams, {
    query: {
      enabled: Boolean(dateFrom && dateTo),
      queryKey: getListBillsQueryKey(billsParams),
    },
  });

  const clinicQuery = useQuery<ClinicSettings>({
    queryKey: ["/api/clinic-settings"],
    queryFn: () => api.get<ClinicSettings>("/api/clinic-settings/branding"),
    staleTime: 5 * 60_000,
  });

  const rows = useMemo(() => {
    const all: Bill[] = billsQuery.data?.bills ?? [];
    const eligible = all.filter((b) => b.status !== "cancelled" && b.status !== "draft");
    eligible.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    return eligible.map((b, i) => {
      const services = (b.order?.tests ?? [])
        .map((ot) => ot.test?.name)
        .filter(Boolean)
        .join(", ");
      const lastPaymentISO = (b.payments ?? [])
        .map((p) => p.createdAt)
        .filter(Boolean)
        .sort()
        .pop();
      const received = Number(b.paidAmount ?? 0);
      return {
        slNo: i + 1,
        date: lastPaymentISO ?? b.createdAt,
        patientName: b.patient
          ? `${b.patient.firstName ?? ""} ${b.patient.lastName ?? ""}`.trim() || "—"
          : "—",
        services: services || "Diagnostic services",
        feesReceived: received,
        receiptDate: lastPaymentISO ?? b.createdAt,
        billNumber: b.billNumber,
      };
    });
  }, [billsQuery.data]);

  const totalFees = rows.reduce((s, r) => s + r.feesReceived, 0);
  const clinicName = clinicQuery.data?.clinicName ?? "";
  const clinicAddress = clinicQuery.data?.address ?? "";
  const regNo = clinicQuery.data?.registrationNo ?? "";

  const handlePrint = () => window.print();

  return (
    <div className="space-y-4">
      {/* ── Toolbar (hidden on print) ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <div>
          <Label htmlFor="form3c-from">From</Label>
          <Input
            id="form3c-from"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-40"
          />
        </div>
        <div>
          <Label htmlFor="form3c-to">To</Label>
          <Input
            id="form3c-to"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-40"
          />
        </div>
        <Button
          variant="outline"
          onClick={() => billsQuery.refetch()}
          disabled={billsQuery.isFetching}
          data-testid="button-form3c-refresh"
        >
          <RefreshCcw className="w-4 h-4 mr-2" />
          {billsQuery.isFetching ? "Loading…" : "Refresh"}
        </Button>
        <Button onClick={handlePrint} data-testid="button-form3c-print">
          <Printer className="w-4 h-4 mr-2" />
          Print
        </Button>
        <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
          <FileText className="w-4 h-4" />
          {rows.length} entries · ₹{fmtMoney(totalFees)} received
        </div>
      </div>

      {/* ── Printable register ────────────────────────────────────────────── */}
      <div
        id="form3c-print"
        className="bg-white text-black mx-auto"
        style={{ width: "100%", maxWidth: "100%", padding: "4mm 2mm", fontFamily: "'Times New Roman', Times, serif", boxSizing: "border-box" }}
      >
        <div style={{ textAlign: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>FORM 25 (Formerly 3C) (Income-tax Act, 2025)</div>
          <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>Form of daily case register</div>
          <div style={{ fontSize: 9, marginTop: 4 }}>
            [TO BE MAINTAINED BY PRACTITIONERS OF ANY SYSTEM OF MEDICINE, I.E., PHYSICIANS, SURGEONS,
            DENTISTS, PATHOLOGISTS, RADIOLOGISTS, VAIDS, HAKIMS, ETC.]
          </div>
        </div>

        {(clinicName || clinicAddress || regNo) && (
          <div style={{ fontSize: 10, marginBottom: 6, textAlign: "center" }}>
            {clinicName && <div style={{ fontWeight: 700 }}>{clinicName}</div>}
            {clinicAddress && <div>{clinicAddress}</div>}
            {regNo && <div>Registration No.: {regNo}</div>}
          </div>
        )}

        <div style={{ fontSize: 10, display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span>Period: <b>{fmtDate(dateFrom)}</b> to <b>{fmtDate(dateTo)}</b></span>
          <span>Generated: {fmtDate(todayISO())}</span>
        </div>

        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 10,
          }}
        >
          <thead>
            <tr>
              <th style={th()}>Date</th>
              <th style={th()}>Sl. No.</th>
              <th style={th()}>Patient&apos;s name</th>
              <th style={th()}>
                Nature of professional services rendered, i.e.,
                <br />
                <i>general consultation, surgery, injection, visit, etc.</i>
              </th>
              <th style={th()}>Fees received</th>
              <th style={th()}>Date of receipt</th>
            </tr>
            <tr>
              <th style={thNum()}>(1)</th>
              <th style={thNum()}>(2)</th>
              <th style={thNum()}>(3)</th>
              <th style={thNum()}>(4)</th>
              <th style={thNum()}>(5)</th>
              <th style={thNum()}>(6)</th>
            </tr>
          </thead>
          <tbody>
            {billsQuery.isLoading && (
              <tr>
                <td colSpan={6} style={{ ...td(), textAlign: "center", padding: 12 }}>
                  Loading…
                </td>
              </tr>
            )}
            {!billsQuery.isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={6} style={{ ...td(), textAlign: "center", padding: 12 }}>
                  No bills found in the selected period.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={`${r.slNo}-${r.billNumber}`}>
                <td style={td()}>{fmtDate(r.date)}</td>
                <td style={{ ...td(), textAlign: "center" }}>{r.slNo}</td>
                <td style={td()}>{r.patientName}</td>
                <td style={td()}>{r.services}</td>
                <td style={{ ...td(), textAlign: "right" }}>₹ {fmtMoney(r.feesReceived)}</td>
                <td style={td()}>{fmtDate(r.receiptDate)}</td>
              </tr>
            ))}
            {rows.length > 0 && (
              <tr>
                <td colSpan={4} style={{ ...td(), textAlign: "right", fontWeight: 700 }}>
                  Total
                </td>
                <td style={{ ...td(), textAlign: "right", fontWeight: 700 }}>
                  ₹ {fmtMoney(totalFees)}
                </td>
                <td style={td()}></td>
              </tr>
            )}
          </tbody>
        </table>

        <div style={{ marginTop: 24, fontSize: 10, display: "flex", justifyContent: "space-between" }}>
          <div>Place: ____________________</div>
          <div>Signature of practitioner: ____________________</div>
        </div>
      </div>

      {/* ── Print isolation: show only the register sheet on print ──────── */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #form3c-print, #form3c-print * { visibility: visible !important; }
          #form3c-print { position: absolute; left: 0; top: 0; width: 100%; max-width: 100%; padding: 0; box-sizing: border-box; }
          @page { size: A4; margin: 4mm; }
        }
      `}</style>
    </div>
  );
}

function th(): React.CSSProperties {
  return {
    border: "1px solid #000",
    padding: "4px 6px",
    fontWeight: 700,
    textAlign: "center",
    verticalAlign: "middle",
    fontSize: 10,
    background: "#f5f5f5",
  };
}
function thNum(): React.CSSProperties {
  return { ...th(), fontWeight: 400, fontStyle: "italic", padding: "2px 4px" };
}
function td(): React.CSSProperties {
  return {
    border: "1px solid #000",
    padding: "4px 6px",
    verticalAlign: "top",
  };
}
