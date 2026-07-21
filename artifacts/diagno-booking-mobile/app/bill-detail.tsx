import { StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { useColors } from "@/hooks/useColors";
import { useStaffAuth, useStaffApi } from "@/context/StaffAuthContext";
import {
  Screen,
  BackBar,
  ScreenHeader,
  SectionLabel,
  Card,
  Badge,
  Skeleton,
  EmptyState,
  DetailRow,
  spacing,
} from "@/components/ui";

type BillDetail = {
  id: number;
  billNumber: string;
  status: string;
  createdAt: string;
  createdByName: string | null;
  subtotal: number;
  discount: number;
  taxAmount: number;
  totalAmount: number;
  paidAmount: number;
  balanceAmount: number;
  refundAmount: number;
  cancelledAt: string | null;
  cancellationReason: string | null;
  patient: { name: string; phone: string } | null;
  items: { name: string; price: number }[];
  payments: {
    id: number;
    amount: number;
    method: string;
    referenceNumber: string | null;
    recordedByName: string | null;
    createdAt: string;
  }[];
};

const inr = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

function fmtDateTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function BillDetailScreen() {
  const colors = useColors();
  const router = useRouter();
  const { session } = useStaffAuth();
  const api = useStaffApi();
  const { id } = useLocalSearchParams<{ id: string }>();
  const billId = Number(id);

  const { data: bill, isLoading, isError } = useQuery({
    queryKey: ["bill-detail", billId],
    queryFn: () => api.get(`/api/mobile-bill-desk/bills/${billId}`) as Promise<BillDetail>,
    enabled: !!session && Number.isInteger(billId) && billId > 0,
  });

  if (!session) {
    return (
      <Screen scroll={false}>
        <BackBar />
        <EmptyState
          icon="lock"
          title="Staff login required"
          actionLabel="Staff Login"
          onAction={() => router.push("/staff-login")}
        />
      </Screen>
    );
  }

  const tone = bill?.status === "paid" ? "success" : bill?.status === "cancelled" ? "destructive" : "warning";

  return (
    <Screen>
      <BackBar />
      <ScreenHeader title={bill?.billNumber ?? "Bill"} subtitle={bill ? fmtDateTime(bill.createdAt) : undefined} />

      {isLoading ? (
        <View style={{ gap: spacing.md }}>
          <Skeleton height={120} />
          <Skeleton height={200} />
        </View>
      ) : isError || !bill ? (
        <EmptyState icon="alert-triangle" title="Bill not found" message="This bill may have been removed, or you may not have access." />
      ) : (
        <>
          <View style={{ marginBottom: spacing.lg }}>
            <Badge label={bill.status.toUpperCase()} tone={tone} />
          </View>

          <Card style={styles.amountCard}>
            <Text style={[styles.amountLabel, { color: colors.mutedForeground }]}>Total</Text>
            <Text style={[styles.amountValue, { color: colors.foreground }]}>{inr(bill.totalAmount)}</Text>
            <View style={styles.amountSplit}>
              <Text style={[styles.amountSub, { color: colors.success }]}>Paid {inr(bill.paidAmount)}</Text>
              {bill.balanceAmount > 0 && (
                <Text style={[styles.amountSub, { color: colors.warning }]}>Due {inr(bill.balanceAmount)}</Text>
              )}
              {bill.refundAmount > 0 && (
                <Text style={[styles.amountSub, { color: colors.destructive }]}>Refunded {inr(bill.refundAmount)}</Text>
              )}
            </View>
          </Card>

          <SectionLabel style={{ marginTop: spacing.lg }}>Patient</SectionLabel>
          <Card>
            <DetailRow label="Name" value={bill.patient?.name || "—"} />
            <DetailRow label="Phone" value={bill.patient?.phone || "—"} />
            <DetailRow label="Billed by" value={bill.createdByName || "—"} last />
          </Card>

          <SectionLabel style={{ marginTop: spacing.lg }}>Items ({bill.items.length})</SectionLabel>
          <Card>
            {bill.items.length === 0 ? (
              <Text style={[styles.emptyLine, { color: colors.mutedForeground }]}>No line items</Text>
            ) : (
              bill.items.map((item, i) => (
                <View
                  key={`${item.name}-${i}`}
                  style={[
                    styles.itemRow,
                    i < bill.items.length - 1 && {
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.itemName, { color: colors.foreground }]} numberOfLines={2}>
                    {item.name}
                  </Text>
                  <Text style={[styles.itemPrice, { color: colors.foreground }]}>{inr(item.price)}</Text>
                </View>
              ))
            )}
            <View style={[styles.totalsBlock, { borderTopColor: colors.border }]}>
              <TotalLine label="Subtotal" value={inr(bill.subtotal)} muted />
              {bill.discount > 0 && <TotalLine label="Discount" value={`− ${inr(bill.discount)}`} muted />}
              {bill.taxAmount > 0 && <TotalLine label="Tax" value={inr(bill.taxAmount)} muted />}
              <TotalLine label="Total" value={inr(bill.totalAmount)} />
            </View>
          </Card>

          <SectionLabel style={{ marginTop: spacing.lg }}>Payments ({bill.payments.length})</SectionLabel>
          <Card style={{ marginBottom: spacing.section }}>
            {bill.payments.length === 0 ? (
              <Text style={[styles.emptyLine, { color: colors.mutedForeground }]}>No payments recorded</Text>
            ) : (
              bill.payments.map((p, i) => (
                <View
                  key={p.id}
                  style={[
                    styles.paymentRow,
                    i < bill.payments.length - 1 && {
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: colors.border,
                    },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.paymentMethod, { color: colors.foreground }]}>
                      {p.method.toUpperCase()}
                      {p.referenceNumber ? `  ·  ${p.referenceNumber}` : ""}
                    </Text>
                    <Text style={[styles.paymentMeta, { color: colors.mutedForeground }]}>
                      {fmtDateTime(p.createdAt)}
                      {p.recordedByName ? ` · by ${p.recordedByName}` : ""}
                    </Text>
                  </View>
                  <Text style={[styles.paymentAmount, { color: colors.success }]}>{inr(p.amount)}</Text>
                </View>
              ))
            )}
          </Card>

          {bill.status === "cancelled" && (
            <Card style={{ marginBottom: spacing.section }}>
              <DetailRow label="Cancelled at" value={fmtDateTime(bill.cancelledAt)} />
              <DetailRow label="Reason" value={bill.cancellationReason || "—"} last />
            </Card>
          )}
        </>
      )}
    </Screen>
  );
}

function TotalLine({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  const colors = useColors();
  return (
    <View style={styles.totalLine}>
      <Text style={[muted ? styles.totalLabelMuted : styles.totalLabel, { color: muted ? colors.mutedForeground : colors.foreground }]}>
        {label}
      </Text>
      <Text style={[muted ? styles.totalLabelMuted : styles.totalLabel, { color: muted ? colors.mutedForeground : colors.foreground }]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  amountCard: { alignItems: "center", paddingVertical: spacing.xl },
  amountLabel: { fontSize: 12, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.9 },
  amountValue: { fontSize: 32, fontFamily: "Inter_700Bold", marginTop: 4 },
  amountSplit: { flexDirection: "row", gap: spacing.lg, marginTop: spacing.sm },
  amountSub: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  itemName: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium", lineHeight: 20 },
  itemPrice: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  totalsBlock: { borderTopWidth: 1, marginTop: spacing.sm, paddingTop: spacing.md, gap: 6 },
  totalLine: { flexDirection: "row", justifyContent: "space-between" },
  totalLabel: { fontSize: 15, fontFamily: "Inter_700Bold" },
  totalLabelMuted: { fontSize: 13, fontFamily: "Inter_400Regular" },
  paymentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  paymentMethod: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  paymentMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  paymentAmount: { fontSize: 15, fontFamily: "Inter_700Bold" },
  emptyLine: { fontSize: 13, fontFamily: "Inter_400Regular", paddingVertical: spacing.sm },
});
