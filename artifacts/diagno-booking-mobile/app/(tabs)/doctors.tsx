import {
  StyleSheet,
  Text,
  View,
  RefreshControl,
  TouchableOpacity,
  Linking,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";

import { useColors } from "@/hooks/useColors";
import { useApi } from "@/hooks/useApi";
import {
  Screen,
  ScreenHeader,
  Card,
  SkeletonList,
  EmptyState,
  spacing,
} from "@/components/ui";

export default function DoctorsScreen() {
  const colors = useColors();
  const api = useApi();

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["doctors"],
    queryFn: () => api.get("/api/doctors"),
  });

  const doctors: any[] = data?.doctors ?? [];

  return (
    <Screen
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
      }
    >
      <ScreenHeader title="Our Doctors" subtitle="Experienced specialists and referring physicians" />

      {isLoading ? (
        <SkeletonList count={4} height={104} />
      ) : doctors.length === 0 ? (
        <EmptyState
          icon="users"
          title="No doctors listed"
          message="Doctor profiles will appear here."
        />
      ) : (
        <View style={{ gap: spacing.md }}>
          {doctors.map((item) => (
            <DoctorCard key={String(item.id)} item={item} />
          ))}
        </View>
      )}
    </Screen>
  );
}

function DoctorCard({ item }: { item: any }) {
  const colors = useColors();

  return (
    <Card>
      <View style={styles.cardHeader}>
        <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
          <Text style={styles.avatarText}>{(item.name || "?").charAt(0).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
            Dr. {item.name}
          </Text>
          <Text style={[styles.spec, { color: colors.mutedForeground }]} numberOfLines={1}>
            {item.specialty || "General Physician"}
          </Text>
        </View>
      </View>

      {item.qualification ? (
        <View style={styles.metaRow}>
          <Feather name="award" size={14} color={colors.mutedForeground} />
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>{item.qualification}</Text>
        </View>
      ) : null}

      {item.phone ? (
        <TouchableOpacity
          style={[styles.phoneRow, { borderTopColor: colors.border }]}
          onPress={() => Linking.openURL("tel:" + item.phone)}
          activeOpacity={0.6}
          hitSlop={8}
        >
          <Feather name="phone" size={15} color={colors.primary} />
          <Text style={[styles.phoneText, { color: colors.primary }]}>{item.phone}</Text>
        </TouchableOpacity>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  cardHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#fff" },
  name: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  spec: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2, lineHeight: 18 },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  meta: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 20 },
  phoneRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    minHeight: 44,
  },
  phoneText: { fontSize: 14, fontFamily: "Inter_500Medium" },
});
