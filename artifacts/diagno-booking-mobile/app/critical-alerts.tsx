import {
  StyleSheet, Text, View, FlatList, TouchableOpacity, RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";

import { useColors } from "@/hooks/useColors";
import { useStaffApi, useStaffAuth } from "@/context/StaffAuthContext";

const SEVERITY_COLORS: Record<string, string> = {
  critical: "#ef4444",
  urgent: "#f59e0b",
  significant: "#3b82f6",
};

const CATEGORY_LABELS: Record<string, string> = {
  brain_bleed: "Brain Bleed",
  midline_shift: "Midline Shift",
  pneumothorax: "Pneumothorax",
  cord_compression: "Cord Compression",
  free_air: "Free Air",
  stroke: "Stroke",
  pulmonary_embolism: "Pulmonary Embolism",
  acute_hemorrhage: "Acute Hemorrhage",
};

export default function CriticalAlertsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useStaffApi();
  const { session } = useStaffAuth();

  const alerts = useQuery({
    queryKey: ["critical-alerts"],
    queryFn: () => api.get("/api/radiology-workflow/critical-alerts"),
    enabled: !!session,
  });

  const items = alerts.data?.openFindings ?? [];

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + 16 }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={{ marginRight: 12 }}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>Critical Findings</Text>
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        refreshControl={
          <RefreshControl refreshing={alerts.isRefetching} onRefresh={alerts.refetch} tintColor={colors.primary} />
        }
        renderItem={({ item }) => <AlertCard item={item} colors={colors} />}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        ListEmptyComponent={() => (
          <View style={styles.empty}>
            <Feather name="check-circle" size={32} color={colors.success} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No critical findings pending</Text>
          </View>
        )}
      />
    </View>
  );
}

function AlertCard({ item, colors }: any) {
  const severity = item.severity || "critical";
  const tint = SEVERITY_COLORS[severity] || colors.destructive;
  const categoryLabel = CATEGORY_LABELS[item.category] || item.category || "Critical";

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.cardTop}>
        <View style={[styles.severityBadge, { backgroundColor: tint + "18" }]}>
          <View style={[styles.severityDot, { backgroundColor: tint }]} />
          <Text style={[styles.severityText, { color: tint }]}>{categoryLabel}</Text>
        </View>
        <Text style={[styles.time, { color: colors.mutedForeground }]}>
          {item.createdAt ? new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
        </Text>
      </View>
      <Text style={[styles.finding, { color: colors.foreground }]}>{item.finding}</Text>
      <View style={styles.actions}>
        <TouchableOpacity style={[styles.ackBtn, { backgroundColor: tint }]} activeOpacity={0.8}>
          <Text style={styles.ackText}>Acknowledge</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.shareBtn, { borderColor: colors.border, borderWidth: 1 }]} activeOpacity={0.8}>
          <Feather name="send" size={14} color={colors.primary} />
          <Text style={[styles.shareText, { color: colors.primary }]}>Notify Doctor</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 12 },
  title: { fontSize: 20, fontFamily: "Inter_700Bold" },
  card: { borderRadius: 14, borderWidth: 1, padding: 14 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  severityBadge: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  severityDot: { width: 6, height: 6, borderRadius: 3 },
  severityText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  time: { fontSize: 11, fontFamily: "Inter_400Regular" },
  finding: { fontSize: 14, fontFamily: "Inter_500Medium", marginBottom: 10 },
  actions: { flexDirection: "row", gap: 8 },
  ackBtn: { flex: 1, borderRadius: 10, alignItems: "center", justifyContent: "center", height: 36 },
  ackText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  shareBtn: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 10, paddingHorizontal: 12, height: 36 },
  shareText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  empty: { alignItems: "center", paddingVertical: 40 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", marginTop: 8 },
});
