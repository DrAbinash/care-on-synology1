import {
  StyleSheet, Text, View, FlatList, TouchableOpacity,
  RefreshControl, Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";

import { useColors } from "@/hooks/useColors";
import { useStaffApi, useStaffAuth } from "@/context/StaffAuthContext";

export default function StudiesListScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useStaffApi();
  const { session } = useStaffAuth();

  const studies = useQuery({
    queryKey: ["incoming-studies"],
    queryFn: () => api.get("/api/radiology-workflow/incoming"),
    enabled: !!session,
  });

  const items = studies.data?.studies ?? [];

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + 16 }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={{ marginRight: 12 }}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>Incoming Studies</Text>
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        refreshControl={
          <RefreshControl refreshing={studies.isRefetching} onRefresh={studies.refetch} tintColor={colors.primary} />
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => router.push({ pathname: "/study-detail" as any, params: { id: item.id } })}
            activeOpacity={0.7}
          >
            <View style={styles.cardTop}>
              <View style={[styles.modBadge, { backgroundColor: getModalityColor(item.modality) + "15" }]}>
                <Text style={[styles.modText, { color: getModalityColor(item.modality) }]}>{item.modality}</Text>
              </View>
              <Text style={[styles.accession, { color: colors.mutedForeground }]}>
                {item.accessionNumber || "No Acc#"}
              </Text>
            </View>
            <Text style={[styles.patientName, { color: colors.foreground }]}>{item.patientName || "Unknown"}</Text>
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>
              {item.imageCount} images · {item.seriesCount} series · {item.aeTitle || "N/A"}
            </Text>
            <View style={styles.bottomRow}>
              <StatusBadge status={item.transferStatus} colors={colors} />
              {item.aeMismatch && <Feather name="alert-triangle" size={14} color={colors.warning} />}
              {item.duplicateStudy && <Feather name="copy" size={14} color={colors.warning} />}
            </View>
          </TouchableOpacity>
        )}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        ListEmptyComponent={() => (
          <View style={styles.empty}>
            <Feather name="inbox" size={32} color={colors.mutedForeground} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No incoming studies</Text>
          </View>
        )}
      />
    </View>
  );
}

function StatusBadge({ status, colors }: any) {
  const color =
    status === "complete" ? colors.success :
    status === "failed" ? colors.destructive :
    status === "quarantined" ? colors.warning :
    status === "receiving" ? colors.primary :
    colors.mutedForeground;
  return (
    <View style={[styles.statusBadge, { backgroundColor: color + "18" }]}>
      <View style={[styles.statusDot, { backgroundColor: color }]} />
      <Text style={[styles.statusText, { color }]}>{status}</Text>
    </View>
  );
}

function getModalityColor(modality: string) {
  const map: Record<string, string> = {
    CT: "#3b82f6", MR: "#a855f7", XR: "#f59e0b", US: "#10b981",
    CR: "#ef4444", DR: "#6366f1", MG: "#ec4899", OT: "#64748b",
  };
  return map[modality] || "#64748b";
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 12 },
  title: { fontSize: 20, fontFamily: "Inter_700Bold" },
  card: { borderRadius: 14, borderWidth: 1, padding: 14 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  modBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  modText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  accession: { fontSize: 11, fontFamily: "Inter_500Medium" },
  patientName: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 4 },
  meta: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 8 },
  bottomRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  empty: { alignItems: "center", paddingVertical: 40 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", marginTop: 8 },
});
