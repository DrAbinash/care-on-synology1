import { StyleSheet, View, Text, FlatList, TouchableOpacity, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";

import { useColors } from "@/hooks/useColors";
import { useApi } from "@/hooks/useApi";

export default function ReportsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const api = useApi();

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["my-reports"],
    queryFn: () => api.get("/api/public/booking/my-reports"),
  });

  const reports: any[] = data?.reports ?? [];

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + 16 }]}>
      <Text style={[styles.header, { color: colors.foreground }]}>My Reports</Text>

      {isLoading ? (
        <LoadingSkeleton colors={colors} />
      ) : reports.length === 0 ? (
        <EmptyState colors={colors} onRefresh={refetch} />
      ) : (
        <FlatList
          data={reports}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
          }
          renderItem={({ item }) => <ReportCard item={item} colors={colors} />}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        />
      )}
    </View>
  );
}

function ReportCard({ item, colors }: { item: any; colors: any }) {
  const status = item.status || "pending";
  const ready = status === "verified" || status === "finalized" || status === "ready";

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.cardHeader}>
        <View style={[styles.iconBox, { backgroundColor: ready ? colors.success + "18" : colors.accent + "18" }]}>
          <Feather name={ready ? "check-circle" : "clock"} size={20} color={ready ? colors.success : colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.name, { color: colors.foreground }]}>{item.testName || "Lab Report"}</Text>
          <Text style={[styles.patient, { color: colors.mutedForeground }]}>{item.patientName || ""}</Text>
        </View>
      </View>
      <Text style={[styles.date, { color: colors.mutedForeground }]}>
        {item.date || ""} · {item.department || "Pathology"}
      </Text>
      {ready && (
        <TouchableOpacity style={[styles.downloadBtn, { backgroundColor: colors.primary + "12" }]} activeOpacity={0.7}>
          <Feather name="download" size={14} color={colors.primary} />
          <Text style={[styles.downloadText, { color: colors.primary }]}>View Report</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function EmptyState({ colors, onRefresh }: { colors: any; onRefresh: () => void }) {
  return (
    <View style={styles.empty}>
      <Feather name="file-text" size={48} color={colors.mutedForeground} />
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No reports yet</Text>
      <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
        Lab reports will appear here once ready
      </Text>
      <TouchableOpacity style={[styles.refreshBtn, { backgroundColor: colors.primary }]} onPress={onRefresh}>
        <Text style={styles.refreshBtnText}>Refresh</Text>
      </TouchableOpacity>
    </View>
  );
}

function LoadingSkeleton({ colors }: { colors: any }) {
  return (
    <View style={{ paddingHorizontal: 16, gap: 10 }}>
      {[1, 2, 3].map((i) => (
        <View key={i} style={[styles.skeleton, { backgroundColor: colors.card }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { fontSize: 24, fontFamily: "Inter_700Bold", paddingHorizontal: 16, marginBottom: 16 },
  card: { borderRadius: 16, padding: 16, borderWidth: 1 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 },
  iconBox: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  patient: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  date: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4 },
  downloadBtn: {
    flexDirection: "row", alignItems: "center", alignSelf: "flex-start",
    borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14, gap: 6, marginTop: 10,
  },
  downloadText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold", marginTop: 16 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 6 },
  refreshBtn: { marginTop: 20, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24 },
  refreshBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
  skeleton: { height: 90, borderRadius: 16, opacity: 0.5 },
});
