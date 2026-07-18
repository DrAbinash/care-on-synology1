import { StyleSheet, Text, View, FlatList, RefreshControl } from "react-native";
import { useQuery } from "@tanstack/react-query";

import { useColors } from "@/hooks/useColors";
import { useStaffApi, useStaffAuth } from "@/context/StaffAuthContext";
import {
  Screen,
  BackBar,
  ScreenHeader,
  Card,
  Badge,
  AppButton,
  SkeletonList,
  EmptyState,
  spacing,
} from "@/components/ui";

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
  const api = useStaffApi();
  const { session } = useStaffAuth();

  const alerts = useQuery({
    queryKey: ["critical-alerts"],
    queryFn: () => api.get("/api/radiology-workflow/critical-alerts"),
    enabled: !!session,
  });

  const items = alerts.data?.openFindings ?? [];

  return (
    <Screen scroll={false}>
      <BackBar />
      <ScreenHeader title="Critical Findings" subtitle="Unacknowledged critical results" />

      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ paddingBottom: spacing.section }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={alerts.isRefetching} onRefresh={alerts.refetch} tintColor={colors.primary} />
        }
        renderItem={({ item }) => <AlertCard item={item} />}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        ListEmptyComponent={
          alerts.isLoading ? (
            <SkeletonList count={3} height={148} />
          ) : (
            <EmptyState
              icon="check-circle"
              title="All clear"
              message="No critical findings pending review."
            />
          )
        }
      />
    </Screen>
  );
}

function AlertCard({ item }: { item: any }) {
  const colors = useColors();
  const severity: string = item.severity || "critical";
  const tone: "destructive" | "warning" | "accent" =
    severity === "urgent" ? "warning" : severity === "significant" ? "accent" : "destructive";
  const tint =
    severity === "urgent" ? colors.warning : severity === "significant" ? colors.accent : colors.destructive;
  const categoryLabel = CATEGORY_LABELS[item.category] || item.category || "Critical";

  return (
    <Card style={{ borderLeftWidth: 3, borderLeftColor: tint }}>
      <View style={styles.cardTop}>
        <Badge label={severity.toUpperCase()} tone={tone} icon="alert-triangle" />
        <Text style={[styles.time, { color: colors.mutedForeground }]}>
          {item.createdAt
            ? new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            : ""}
        </Text>
      </View>
      <Text style={[styles.category, { color: colors.foreground }]}>{categoryLabel}</Text>
      {item.patientName ? (
        <Text style={[styles.patient, { color: colors.mutedForeground }]}>{item.patientName}</Text>
      ) : null}
      <Text style={[styles.finding, { color: colors.foreground }]}>{item.finding}</Text>
      <View style={styles.actions}>
        <AppButton
          label="Acknowledge"
          icon="check"
          variant="secondary"
          disabled
          onPress={() => {}}
          style={{ flex: 1 }}
        />
        <AppButton
          label="Notify Doctor"
          icon="send"
          variant="secondary"
          disabled
          onPress={() => {}}
          style={{ flex: 1 }}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  time: { fontSize: 11, fontFamily: "Inter_400Regular" },
  category: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  patient: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  finding: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20, marginTop: spacing.xs },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
});
