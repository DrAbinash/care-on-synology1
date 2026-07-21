import { StyleSheet, Text, View, FlatList, RefreshControl } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";

import { useColors } from "@/hooks/useColors";
import { useStaffApi, useStaffAuth } from "@/context/StaffAuthContext";
import {
  Screen,
  BackBar,
  ScreenHeader,
  Card,
  Badge,
  SkeletonList,
  EmptyState,
  spacing,
} from "@/components/ui";

type StatusTone = "success" | "destructive" | "warning" | "primary" | "muted";

function statusTone(status: string): StatusTone {
  switch (status) {
    case "complete":
      return "success";
    case "failed":
      return "destructive";
    case "quarantined":
      return "warning";
    case "receiving":
      return "primary";
    default:
      return "muted";
  }
}

export default function StudiesListScreen() {
  const colors = useColors();
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
    <Screen scroll={false}>
      <BackBar />
      <ScreenHeader title="Incoming Studies" subtitle="Studies received from connected modalities" />

      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ paddingBottom: spacing.section }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={studies.isRefetching} onRefresh={studies.refetch} tintColor={colors.primary} />
        }
        renderItem={({ item }) => {
          const rawDate = item.studyDate || item.createdAt;
          const dateStr = rawDate
            ? new Date(rawDate).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })
            : null;
          return (
            <Card onPress={() => router.push({ pathname: "/study-detail" as any, params: { id: item.id } })}>
              <View style={styles.rowInner}>
                <View style={{ flex: 1 }}>
                  <View style={styles.cardTop}>
                    <Badge label={item.modality || "—"} tone="accent" />
                    <Text style={[styles.accession, { color: colors.mutedForeground }]}>
                      {item.accessionNumber || "No Acc#"}
                    </Text>
                  </View>
                  <Text style={[styles.patientName, { color: colors.foreground }]}>
                    {item.patientName || "Unknown"}
                  </Text>
                  {item.studyDescription ? (
                    <Text style={[styles.desc, { color: colors.mutedForeground }]} numberOfLines={1}>
                      {item.studyDescription}
                    </Text>
                  ) : null}
                  <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                    {dateStr ? `${dateStr} · ` : ""}
                    {item.imageCount} images · {item.seriesCount} series · {item.aeTitle || "N/A"}
                  </Text>
                  <View style={styles.bottomRow}>
                    <Badge label={item.transferStatus} tone={statusTone(item.transferStatus)} />
                    {item.aeMismatch && <Feather name="alert-triangle" size={14} color={colors.warning} />}
                    {item.duplicateStudy && <Feather name="copy" size={14} color={colors.warning} />}
                  </View>
                </View>
                <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
              </View>
            </Card>
          );
        }}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        ListEmptyComponent={
          studies.isLoading ? (
            <SkeletonList count={4} height={112} />
          ) : (
            <EmptyState
              icon="inbox"
              title="No incoming studies"
              message="New studies from connected modalities will appear here."
            />
          )
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  rowInner: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  accession: { fontSize: 11, fontFamily: "Inter_500Medium", letterSpacing: 0.2 },
  patientName: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  desc: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },
  meta: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18, marginTop: 2, marginBottom: spacing.sm },
  bottomRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
});
