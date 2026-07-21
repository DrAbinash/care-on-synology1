import { useState } from "react";
import { StyleSheet, Text, View, TextInput, RefreshControl } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";

import { useColors } from "@/hooks/useColors";
import { useStaffAuth, useStaffApi } from "@/context/StaffAuthContext";
import {
  Screen,
  BackBar,
  ScreenHeader,
  SectionLabel,
  Card,
  Badge,
  SkeletonList,
  Skeleton,
  EmptyState,
  spacing,
} from "@/components/ui";

/**
 * Read-only Bill Desk for staff — gated server-side by the dedicated
 * /mobile-bill-desk permission (granted per staff member in ERP Settings →
 * Users), separate from the desktop /billing permission.
 */

export function hasBillDeskAccess(role: string | undefined, permissions: string[] | undefined): boolean {
  if (role === "admin" || role === "super_admin") return true;
  return (permissions ?? []).some((p) => p === "/mobile-bill-desk" || p.startsWith("/mobile-bill-desk:"));
}

type Summary = {
  date: string;
  billCount: number;
  cancelledCount: number;
  grossBilled: number;
  collected: number;
  outstanding: number;
  collectedToday: number;
  byMethod: { method: string; total: number; count: number }[];
};

type BillRow = {
  id: number;
  billNumber: string;
  patientName: string;
  phone: string;
  totalAmount: number;
  paidAmount: number;
  balanceAmount: number;
  status: string;
  createdByName: string | null;
  createdAt: string;
};

function statusTone(status: string): "success" | "warning" | "destructive" {
  if (status === "paid") return "success";
  if (status === "cancelled") return "destructive";
  return "warning";
}

const inr = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

export default function BillDeskScreen() {
  const colors = useColors();
  const router = useRouter();
  const { session } = useStaffAuth();
  const api = useStaffApi();
  const [search, setSearch] = useState("");

  const allowed = hasBillDeskAccess(session?.user?.role, session?.user?.permissions);
  const searching = search.trim().length >= 2;

  const summaryQuery = useQuery({
    queryKey: ["bill-desk-summary"],
    queryFn: () => api.get("/api/mobile-bill-desk/summary") as Promise<Summary>,
    enabled: !!session && allowed,
  });

  const billsQuery = useQuery({
    queryKey: ["bill-desk-bills", searching ? search.trim() : "today"],
    queryFn: () =>
      api.get(
        searching
          ? `/api/mobile-bill-desk/bills?q=${encodeURIComponent(search.trim())}`
          : "/api/mobile-bill-desk/bills",
      ) as Promise<{ bills: BillRow[]; total: number }>,
    enabled: !!session && allowed,
  });

  const refetchAll = () => {
    summaryQuery.refetch();
    billsQuery.refetch();
  };

  if (!session) {
    return (
      <Screen scroll={false}>
        <BackBar />
        <EmptyState
          icon="lock"
          title="Staff login required"
          message="Log in with your staff account to open the Bill Desk."
          actionLabel="Staff Login"
          onAction={() => router.push("/staff-login")}
        />
      </Screen>
    );
  }

  if (!allowed) {
    return (
      <Screen scroll={false}>
        <BackBar />
        <EmptyState
          icon="shield-off"
          title="No Bill Desk access"
          message="Your account doesn't have the Mobile Bill Desk permission. Ask an admin to enable it in Settings → Users."
        />
      </Screen>
    );
  }

  const summary = summaryQuery.data;
  const bills = billsQuery.data?.bills ?? [];

  return (
    <Screen
      refreshControl={
        <RefreshControl
          refreshing={summaryQuery.isRefetching || billsQuery.isRefetching}
          onRefresh={refetchAll}
          tintColor={colors.primary}
        />
      }
    >
      <BackBar />
      <ScreenHeader title="Bill Desk" subtitle={`Today · ${summary?.date ?? ""}`} />

      {summaryQuery.isLoading ? (
        <View style={{ gap: spacing.md }}>
          <Skeleton height={90} />
          <Skeleton height={90} />
        </View>
      ) : summary ? (
        <>
          <View style={styles.statRow}>
            <StatTile label="Bills" value={String(summary.billCount)} icon="file-text" />
            <StatTile label="Collected" value={inr(summary.collectedToday)} icon="trending-up" highlight />
          </View>
          <View style={styles.statRow}>
            <StatTile label="Gross Billed" value={inr(summary.grossBilled)} icon="bar-chart-2" />
            <StatTile label="Outstanding" value={inr(summary.outstanding)} icon="alert-circle" warn={summary.outstanding > 0} />
          </View>

          {summary.byMethod.length > 0 && (
            <>
              <SectionLabel style={{ marginTop: spacing.lg }}>Collections by method</SectionLabel>
              <Card>
                {summary.byMethod.map((m, i) => (
                  <View
                    key={m.method}
                    style={[
                      styles.methodRow,
                      i < summary.byMethod.length - 1 && {
                        borderBottomWidth: StyleSheet.hairlineWidth,
                        borderBottomColor: colors.border,
                      },
                    ]}
                  >
                    <Text style={[styles.methodName, { color: colors.foreground }]}>
                      {m.method.toUpperCase()} <Text style={{ color: colors.mutedForeground }}>×{m.count}</Text>
                    </Text>
                    <Text style={[styles.methodTotal, { color: colors.foreground }]}>{inr(m.total)}</Text>
                  </View>
                ))}
              </Card>
            </>
          )}
        </>
      ) : null}

      <SectionLabel style={{ marginTop: spacing.xl }}>{searching ? "Search results" : "Today's bills"}</SectionLabel>
      <View style={[styles.searchBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Feather name="search" size={16} color={colors.mutedForeground} />
        <TextInput
          style={[styles.searchInput, { color: colors.foreground }]}
          placeholder="Search bill no, patient, phone…"
          placeholderTextColor={colors.mutedForeground}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
        />
      </View>

      {billsQuery.isLoading ? (
        <SkeletonList count={4} height={88} />
      ) : bills.length === 0 ? (
        <EmptyState
          icon="inbox"
          title={searching ? "No matching bills" : "No bills yet today"}
          message={searching ? "Try a different bill number, name or phone." : "Bills created today will appear here."}
        />
      ) : (
        <View style={{ gap: spacing.md }}>
          {bills.map((b) => (
            <Card key={b.id} onPress={() => router.push(`/bill-detail?id=${b.id}`)}>
              <View style={styles.billTop}>
                <Text style={[styles.billNumber, { color: colors.foreground }]}>{b.billNumber}</Text>
                <Badge label={b.status.toUpperCase()} tone={statusTone(b.status)} />
              </View>
              <Text style={[styles.billPatient, { color: colors.mutedForeground }]} numberOfLines={1}>
                {b.patientName} · {b.phone}
              </Text>
              <View style={styles.billBottom}>
                <Text style={[styles.billAmount, { color: colors.foreground }]}>{inr(b.totalAmount)}</Text>
                {b.balanceAmount > 0 ? (
                  <Text style={[styles.billDue, { color: colors.warning }]}>Due {inr(b.balanceAmount)}</Text>
                ) : (
                  <Text style={[styles.billDue, { color: colors.success }]}>Fully paid</Text>
                )}
              </View>
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
}

function StatTile({
  label,
  value,
  icon,
  highlight = false,
  warn = false,
}: {
  label: string;
  value: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  highlight?: boolean;
  warn?: boolean;
}) {
  const colors = useColors();
  const accent = warn ? colors.warning : highlight ? colors.success : colors.primary;
  return (
    <Card style={styles.statTile}>
      <View style={[styles.statIcon, { backgroundColor: accent + "14" }]}>
        <Feather name={icon} size={16} color={accent} />
      </View>
      <Text style={[styles.statValue, { color: colors.foreground }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  statRow: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.md },
  statTile: { flex: 1, paddingVertical: spacing.lg },
  statIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  statValue: { fontSize: 20, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 2 },
  methodRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
  },
  methodName: { fontSize: 13, fontFamily: "Inter_500Medium" },
  methodTotal: { fontSize: 14, fontFamily: "Inter_700Bold" },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    marginBottom: spacing.md,
  },
  searchInput: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular", padding: 0 },
  billTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  billNumber: { fontSize: 15, fontFamily: "Inter_600SemiBold", flex: 1 },
  billPatient: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4 },
  billBottom: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.md,
  },
  billAmount: { fontSize: 16, fontFamily: "Inter_700Bold" },
  billDue: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
});
