import {
  StyleSheet, Text, View, ScrollView, RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";

import { useColors } from "@/hooks/useColors";
import { useStaffApi, useStaffAuth } from "@/context/StaffAuthContext";

export default function CommandCenterScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useStaffApi();
  const { session } = useStaffAuth();

  const cc = useQuery({
    queryKey: ["command-center"],
    queryFn: () => api.get("/api/radiology-workflow/command-center"),
    enabled: !!session,
  });

  const data = cc.data;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      refreshControl={
        <RefreshControl refreshing={cc.isRefetching} onRefresh={cc.refetch} tintColor={colors.primary} />
      }
    >
      <View style={{ paddingTop: insets.top + 16, paddingHorizontal: 16 }}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.foreground }]}>Command Center</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Real-time RIS/PACS overview
          </Text>
        </View>

        {/* Metrics Grid */}
        <View style={styles.grid}>
          <MetricCard label="Pending Reports" value={data?.pendingReports ?? "—"} color={colors.warning} colors={colors} />
          <MetricCard label="Critical Alerts" value={data?.criticalAlerts ?? "—"} color={colors.destructive} colors={colors} />
          <MetricCard label="Studies Today" value={data?.studiesToday ?? "—"} color={colors.success} colors={colors} />
          <MetricCard label="AI Processing" value={data?.aiQueue?.processing ?? "—"} color={colors.accent} colors={colors} />
          <MetricCard label="Failed Transfers" value={data?.failedTransfers ?? "—"} color={colors.destructive} colors={colors} />
          <MetricCard label="Avg TAT (min)" value={data?.avgTatMinutes ?? "—"} color={colors.primary} colors={colors} />
        </View>

        {/* Live Modalities */}
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Live Modalities</Text>
        {data?.modalities?.map((m: any) => (
          <View key={m.modality} style={[styles.modCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.modLeft}>
              <View style={[styles.modIcon, { backgroundColor: colors.primary + "15" }]}>
                <Feather name="monitor" size={16} color={colors.primary} />
              </View>
              <View>
                <Text style={[styles.modName, { color: colors.foreground }]}>{m.modality}</Text>
                <Text style={[styles.modSub, { color: colors.mutedForeground }]}>
                  {m.online} / {m.total} online
                </Text>
              </View>
            </View>
            <View style={styles.modRight}>
              <View style={[styles.liveDot, { backgroundColor: m.online > 0 ? colors.success : colors.mutedForeground }]} />
              <Text style={[styles.liveText, { color: m.online > 0 ? colors.success : colors.mutedForeground }]}>
                {m.online > 0 ? "LIVE" : "OFFLINE"}
              </Text>
            </View>
          </View>
        )) || (
          <Text style={[styles.empty, { color: colors.mutedForeground }]}>No modality data available</Text>
        )}

        {/* Storage Summary */}
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Storage Overview</Text>
        {data?.storage && (
          <View style={[styles.storageCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <StorageRow label="Hot" value={data.storage.hot} colors={colors} tint={colors.success} />
            <StorageRow label="Archive" value={data.storage.archive} colors={colors} tint={colors.accent} />
            <StorageRow label="Orphans" value={data.storage.orphans} colors={colors} tint={colors.warning} />
          </View>
        )}
      </View>
    </ScrollView>
  );
}

function MetricCard({ label, value, color, colors }: any) {
  return (
    <View style={[styles.metricCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.metricValue, { color }]}>{value}</Text>
      <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

function StorageRow({ label, value, colors, tint }: any) {
  return (
    <View style={styles.storageRow}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={[styles.miniDot, { backgroundColor: tint }]} />
        <Text style={[styles.storageLabel, { color: colors.foreground }]}>{label}</Text>
      </View>
      <Text style={[styles.storageValue, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { marginBottom: 16 },
  title: { fontSize: 24, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 14, fontFamily: "Inter_400Regular", marginTop: 2 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 20 },
  metricCard: { flex: 1, minWidth: 100, borderRadius: 14, borderWidth: 1, padding: 12, alignItems: "center" },
  metricValue: { fontSize: 22, fontFamily: "Inter_700Bold" },
  metricLabel: { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 4, textAlign: "center" },
  sectionTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", marginTop: 20, marginBottom: 10 },
  modCard: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 14, borderWidth: 1, padding: 12, marginBottom: 8 },
  modLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  modIcon: { width: 36, height: 36, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  modName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  modSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  modRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  liveText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  storageCard: { borderRadius: 14, borderWidth: 1, padding: 14 },
  storageRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomColor: "#e2e8f020", borderBottomWidth: 1 },
  miniDot: { width: 8, height: 8, borderRadius: 4 },
  storageLabel: { fontSize: 14, fontFamily: "Inter_500Medium" },
  storageValue: { fontSize: 14, fontFamily: "Inter_700Bold" },
  empty: { fontSize: 14, fontFamily: "Inter_400Regular", paddingVertical: 12 },
});
