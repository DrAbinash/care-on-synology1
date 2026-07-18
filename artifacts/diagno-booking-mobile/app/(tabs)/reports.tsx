import { StyleSheet, View, Text, RefreshControl } from "react-native";
import { useQuery } from "@tanstack/react-query";

import { useColors } from "@/hooks/useColors";
import { useApi } from "@/hooks/useApi";
import {
  Screen,
  ScreenHeader,
  Card,
  IconTile,
  Badge,
  SkeletonList,
  EmptyState,
  spacing,
} from "@/components/ui";

export default function ReportsScreen() {
  const colors = useColors();
  const api = useApi();

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["my-reports"],
    queryFn: () => api.get("/api/public/booking/my-reports"),
  });

  const reports: any[] = data?.reports ?? [];

  return (
    <Screen
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
      }
    >
      <ScreenHeader title="My Reports" subtitle="Lab results for your bookings" />

      {isLoading ? (
        <SkeletonList count={4} height={96} />
      ) : reports.length === 0 ? (
        <EmptyState
          icon="file-text"
          title="No reports yet"
          message="Lab reports will appear here once they're ready."
          actionLabel="Refresh"
          onAction={refetch}
        />
      ) : (
        <View style={{ gap: spacing.md }}>
          {reports.map((item) => (
            <ReportCard key={String(item.id)} item={item} />
          ))}
        </View>
      )}
    </Screen>
  );
}

function ReportCard({ item }: { item: any }) {
  const colors = useColors();
  const status = String(item.status || "pending");
  const ready = status === "verified" || status === "finalized" || status === "ready";
  const statusLabel = ready
    ? "Ready"
    : status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <Card>
      <View style={styles.cardHeader}>
        <IconTile
          icon={ready ? "check-circle" : "clock"}
          color={ready ? colors.success : colors.accent}
        />
        <View style={{ flex: 1 }}>
          <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
            {item.testName || "Lab Report"}
          </Text>
          {item.patientName ? (
            <Text style={[styles.patient, { color: colors.mutedForeground }]} numberOfLines={1}>
              {item.patientName}
            </Text>
          ) : null}
        </View>
        <Badge
          tone={ready ? "success" : "accent"}
          label={statusLabel}
          icon={ready ? "check" : "clock"}
        />
      </View>
      <Text style={[styles.meta, { color: colors.mutedForeground }]}>
        {item.date || ""} · {item.department || "Pathology"}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  cardHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  name: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  patient: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2, lineHeight: 18 },
  meta: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: spacing.sm + 2, lineHeight: 20 },
});
