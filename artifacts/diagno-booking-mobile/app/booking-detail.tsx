import { StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { useColors } from "@/hooks/useColors";
import { useApi } from "@/hooks/useApi";
import {
  Screen,
  BackBar,
  ScreenHeader,
  Card,
  Badge,
  DetailRow,
  EmptyState,
  Skeleton,
  spacing,
} from "@/components/ui";

type Test = { id: number; name: string };
type Pkg = { id: number; name: string };

// Which gateway actually completed this booking, mirroring clinic-site's
// derivePayment() — used to label the payment line the same way the web
// receipt does.
function derivePayment(b: Record<string, unknown>): { method: string; reference: string } {
  const str = (v: unknown) => (typeof v === "string" && v ? v : "");
  if (str(b.razorpayPaymentId) || str(b.razorpayOrderId)) return { method: "Razorpay", reference: str(b.razorpayPaymentId) || str(b.razorpayOrderId) };
  if (str(b.payuPaymentId) || str(b.payuTxnId)) return { method: "PayU", reference: str(b.payuPaymentId) || str(b.payuTxnId) };
  if (str(b.phonepeProviderRefId) || str(b.phonepeTransactionId)) return { method: "PhonePe", reference: str(b.phonepeProviderRefId) || str(b.phonepeTransactionId) };
  if (str(b.bharatpeProviderRefId) || str(b.bharatpeTransactionId)) return { method: "BharatPe", reference: str(b.bharatpeProviderRefId) || str(b.bharatpeTransactionId) };
  if (str(b.iciciProviderRefId) || str(b.iciciTransactionId)) return { method: "Orange Pay (ICICI)", reference: str(b.iciciProviderRefId) || str(b.iciciTransactionId) };
  return { method: "UPI", reference: "" };
}

function parseIdList(raw: unknown): number[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is number => typeof v === "number") : [];
  } catch {
    return [];
  }
}

const STATUS_LABEL: Record<string, string> = {
  pending_payment: "Payment Pending",
  paid: "Paid",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
};

export default function BookingDetailScreen() {
  const colors = useColors();
  const api = useApi();
  const { ref } = useLocalSearchParams<{ ref: string }>();
  const bookingRef = typeof ref === "string" ? ref : "";

  const { data, isLoading, isError } = useQuery({
    queryKey: ["booking-detail", bookingRef],
    queryFn: async () => {
      const [detail, tests, pkgs] = await Promise.all([
        api.get(`/api/public/booking/by-ref?ref=${encodeURIComponent(bookingRef)}`) as Promise<{ booking: Record<string, unknown>; tokenNo: number | null }>,
        api.get("/api/public/booking/tests") as Promise<{ tests: Test[] }>,
        api.get("/api/public/booking/packages") as Promise<{ packages: Pkg[] }>,
      ]);
      return { detail, tests: tests.tests ?? [], packages: pkgs.packages ?? [] };
    },
    enabled: !!bookingRef,
  });

  const booking = data?.detail.booking;
  const tokenNo = data?.detail.tokenNo ?? null;

  const testNames = booking
    ? parseIdList(booking.testIds).map((id) => data?.tests.find((t) => t.id === id)?.name || `Test #${id}`)
    : [];
  const packageNames = booking
    ? parseIdList(booking.packageIds).map((id) => data?.packages.find((p) => p.id === id)?.name || `Package #${id}`)
    : [];
  const payment = booking ? derivePayment(booking) : null;
  const status = booking ? String(booking.status || "pending_payment") : "";
  const statusLabel = STATUS_LABEL[status] || status;
  const isPaid = status === "paid" || status === "confirmed";
  const statusTone = isPaid ? "success" : status === "cancelled" ? "destructive" : "warning";

  const rows: { label: string; value: string }[] = [];
  if (booking) {
    rows.push({ label: "Booking Reference", value: String(booking.bookingRef ?? bookingRef) });
    rows.push({ label: "Patient", value: String(booking.name ?? "") });
    rows.push({
      label: "Appointment",
      value: [String(booking.selectedDate ?? ""), booking.timeSlot ? String(booking.timeSlot) : ""]
        .filter(Boolean)
        .join(" · "),
    });
    if (testNames.length > 0 || packageNames.length > 0) {
      rows.push({ label: "Tests & Packages", value: [...testNames, ...packageNames].join(", ") });
    }
    rows.push({ label: "Total Amount", value: `₹${Number(booking.totalAmount ?? 0).toLocaleString("en-IN")}` });
    if (payment) {
      rows.push({
        label: "Payment Method",
        value: `${payment.method}${payment.reference ? ` · ${payment.reference}` : ""}`,
      });
    }
    if (booking.notes) {
      rows.push({ label: "Notes", value: String(booking.notes) });
    }
  }

  return (
    <Screen>
      <BackBar />
      <ScreenHeader title="Booking Details" />

      {isLoading ? (
        <View style={{ gap: spacing.md }}>
          <Skeleton height={72} />
          <Skeleton height={280} />
        </View>
      ) : isError || !booking ? (
        <EmptyState
          icon="alert-triangle"
          title="Booking not found"
          message="We couldn't find a booking with this reference. Please try again or contact the clinic."
        />
      ) : (
        <>
          <View style={{ marginBottom: spacing.lg }}>
            <Badge
              label={statusLabel}
              tone={statusTone}
              icon={isPaid ? "check-circle" : status === "cancelled" ? "x-circle" : "clock"}
            />
          </View>

          {tokenNo != null && (
            <Card style={styles.tokenCard}>
              <Text style={[styles.tokenLabel, { color: colors.mutedForeground }]}>Token Number</Text>
              <Text style={[styles.tokenValue, { color: colors.primary }]}>{tokenNo}</Text>
            </Card>
          )}

          <Card>
            {rows.map((row, i) => (
              <DetailRow key={row.label} label={row.label} value={row.value} last={i === rows.length - 1} />
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  tokenCard: {
    alignItems: "center",
    paddingVertical: spacing.xl,
    marginBottom: spacing.md,
  },
  tokenLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.9,
  },
  tokenValue: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    marginTop: spacing.xs,
  },
});
