import { StyleSheet, Text, View, RefreshControl } from "react-native";
import { useQuery } from "@tanstack/react-query";

import { useColors } from "@/hooks/useColors";
import { useStaffApi, useStaffAuth } from "@/context/StaffAuthContext";
import {
  Screen,
  ScreenHeader,
  BackBar,
  SectionLabel,
  Card,
  IconTile,
  Badge,
  SkeletonList,
  EmptyState,
  spacing,
  type FeatherIconName,
} from "@/components/ui";

export default function CommandCenterScreen() {
  const colors = useColors();
  const api = useStaffApi();
  const { session } = useStaffAuth();

  const cc = useQuery({
    queryKey: ["command-center"],
    queryFn: () => api.get("/api/radiology-workflow/command-center"),
    enabled: !!session,
  });

  const data = cc.data;

  return (
    <Screen
      refreshControl={
        <RefreshControl refreshing={cc.isRefetching} onRefresh={cc.refetch} tintColor={colors.primary} />
      }
    >
      <BackBar />
      <ScreenHeader title="Command Center" subtitle="Real-time RIS/PACS overview" />

      {/* KPI metrics */}
      <View style={styles.grid}>
        <MetricTile label="Pending Reports" value={data?.pendingReports ?? "—"} icon="clock" tint={colors.warning} />
        <MetricTile label="Critical Alerts" value={data?.criticalAlerts ?? "—"} icon="alert-triangle" tint={colors.destructive} />
        <MetricTile label="Studies Today" value={data?.studiesToday ?? "—"} icon="activity" tint={colors.success} />
        <MetricTile label="AI Processing" value={data?.aiQueue?.processing ?? "—"} icon="cpu" tint={colors.accent} />
        <MetricTile label="Failed Transfers" value={data?.failedTransfers ?? "—"} icon="x-octagon" tint={colors.destructive} />
        <MetricTile label="Avg TAT (min)" value={data?.avgTatMinutes ?? "—"} icon="bar-chart-2" tint={colors.primary} />
      </View>

      <SectionLabel style={{ marginTop: spacing.section }}>Live modalities</SectionLabel>
      {cc.isLoading ? (
        <SkeletonList count={3} height={68} />
      ) : data?.modalities?.length ? (
        <View style={{ gap: spacing.md }}>
          {data.modalities.map((m: any) => (
            <Card key={m.modality} style={styles.modRow}>
              <IconTile icon="monitor" color={colors.primary} />
              <View style={styles.modInfo}>
                <Text style={[styles.modName, { color: colors.foreground }]}>{m.modality}</Text>
                <Text style={[styles.modSub, { color: colors.mutedForeground }]}>
                  {m.online} / {m.total} online
                </Text>
              </View>
              <Badge
                label={m.online > 0 ? "Live" : "Offline"}
                tone={m.online > 0 ? "success" : "muted"}
                icon={m.online > 0 ? "wifi" : "wifi-off"}
              />
            </Card>
          ))}
        </View>
      ) : (
        <EmptyState
          icon="monitor"
          title="No modality data"
          message="Connected modalities will appear here once they report in."
        />
      )}

      {data?.storage && (
        <>
          <SectionLabel style={{ marginTop: spacing.section }}>Storage overview</SectionLabel>
          <Card>
            <StorageRow label="Hot" value={data.storage.hot} tint={colors.success} />
            <StorageRow label="Archive" value={data.storage.archive} tint={colors.accent} />
            <StorageRow label="Orphans" value={data.storage.orphans} tint={colors.warning} last />
          </Card>
        </>
      )}
    </Screen>
  );
}

function MetricTile({
  label,
  value,
  icon,
  tint,
}: {
  label: string;
  value: string | number;
  icon: FeatherIconName;
  tint: string;
}) {
  const colors = useColors();
  return (
    <Card style={styles.metricTile}>
      <IconTile icon={icon} color={tint} size={34} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.metricValue, { color: colors.foreground }]} numberOfLines={1}>
          {value}
        </Text>
        <Text style={[styles.metricLabel, { color: colors.mutedForeground }]} numberOfLines={2}>
          {label}
        </Text>
      </View>
    </Card>
  );
}

function StorageRow({
  label,
  value,
  tint,
  last = false,
}: {
  label: string;
  value: string | number;
  tint: string;
  last?: boolean;
}) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.storageRow,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
      ]}
    >
      <View style={styles.storageLeft}>
        <View style={[styles.miniDot, { backgroundColor: tint }]} />
        <Text style={[styles.storageLabel, { color: colors.foreground }]}>{label}</Text>
      </View>
      <Text style={[styles.storageValue, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  metricTile: {
    flexGrow: 1,
    flexBasis: "44%",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
  },
  metricValue: { fontSize: 24, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  metricLabel: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 1, lineHeight: 15 },
  modRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md },
  modInfo: { flex: 1 },
  modName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  modSub: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2, lineHeight: 18 },
  storageRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
  },
  storageLeft: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  miniDot: { width: 8, height: 8, borderRadius: 4 },
  storageLabel: { fontSize: 14, fontFamily: "Inter_500Medium" },
  storageValue: { fontSize: 14, fontFamily: "Inter_700Bold" },
});
