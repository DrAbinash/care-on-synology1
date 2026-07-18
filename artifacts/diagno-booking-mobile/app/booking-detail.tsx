import { StyleSheet, Text, View, TouchableOpacity, ScrollView, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { useColors } from "@/hooks/useColors";
import { useApi } from "@/hooks/useApi";

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
  const insets = useSafeAreaInsets();
  const router = useRouter();
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

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + 16 }]}>
      <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
        <Feather name="arrow-left" size={20} color={colors.foreground} />
        <Text style={[styles.backText, { color: colors.foreground }]}>Back</Text>
      </TouchableOpacity>

      <Text style={[styles.title, { color: colors.foreground }]}>Booking Details</Text>

      {isLoading ? (
        <View style={{ paddingVertical: 60, alignItems: "center" }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : isError || !booking ? (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, alignItems: "center", gap: 8 }]}>
          <Feather name="alert-triangle" size={28} color={colors.warning} />
          <Text style={[styles.value, { color: colors.foreground }]}>Booking not found</Text>
          <Text style={[styles.label, { color: colors.mutedForeground, textAlign: "center" }]}>
            We couldn't find a booking with this reference. Please try again or contact the clinic.
          </Text>
        </View>
      ) : (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Booking Reference</Text>
          <Text style={[styles.value, { color: colors.foreground }]}>{String(booking.bookingRef ?? bookingRef)}</Text>

          <Text style={[styles.label, { color: colors.mutedForeground, marginTop: 14 }]}>Status</Text>
          <View style={[styles.statusBadge, { backgroundColor: (isPaid ? colors.success : colors.accent) + "18" }]}>
            <Text style={[styles.statusText, { color: isPaid ? colors.success : colors.accent }]}>{statusLabel}</Text>
          </View>

          {tokenNo != null && (
            <>
              <Text style={[styles.label, { color: colors.mutedForeground, marginTop: 14 }]}>Token Number</Text>
              <Text style={[styles.value, { color: colors.foreground }]}>{tokenNo}</Text>
            </>
          )}

          <Text style={[styles.label, { color: colors.mutedForeground, marginTop: 14 }]}>Patient</Text>
          <Text style={[styles.value, { color: colors.foreground }]}>{String(booking.name ?? "")}</Text>

          <Text style={[styles.label, { color: colors.mutedForeground, marginTop: 14 }]}>Appointment</Text>
          <Text style={[styles.value, { color: colors.foreground }]}>
            {String(booking.selectedDate ?? "")} {booking.timeSlot ? `· ${String(booking.timeSlot)}` : ""}
          </Text>

          {(testNames.length > 0 || packageNames.length > 0) && (
            <>
              <Text style={[styles.label, { color: colors.mutedForeground, marginTop: 14 }]}>Tests &amp; Packages</Text>
              <Text style={[styles.value, { color: colors.foreground }]}>
                {[...testNames, ...packageNames].join(", ")}
              </Text>
            </>
          )}

          <Text style={[styles.label, { color: colors.mutedForeground, marginTop: 14 }]}>Total Amount</Text>
          <Text style={[styles.value, { color: colors.foreground }]}>
            ₹{Number(booking.totalAmount ?? 0).toLocaleString("en-IN")}
          </Text>

          {payment && (
            <>
              <Text style={[styles.label, { color: colors.mutedForeground, marginTop: 14 }]}>Payment Method</Text>
              <Text style={[styles.value, { color: colors.foreground }]}>
                {payment.method}{payment.reference ? ` · ${payment.reference}` : ""}
              </Text>
            </>
          )}

          {!!booking.notes && (
            <>
              <Text style={[styles.label, { color: colors.mutedForeground, marginTop: 14 }]}>Notes</Text>
              <Text style={[styles.value, { color: colors.foreground }]}>{String(booking.notes)}</Text>
            </>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16 },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 },
  backText: { fontSize: 15, fontFamily: "Inter_500Medium" },
  title: { fontSize: 24, fontFamily: "Inter_700Bold", marginBottom: 16 },
  card: { borderRadius: 16, borderWidth: 1, padding: 20, marginBottom: 24 },
  label: { fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 4 },
  value: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  statusBadge: { alignSelf: "flex-start", borderRadius: 8, paddingVertical: 4, paddingHorizontal: 12 },
  statusText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
});
