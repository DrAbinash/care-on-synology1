import { StyleSheet, Text, View, ScrollView, FlatList, TouchableOpacity } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";

import { useColors } from "@/hooks/useColors";
import { useApi } from "@/hooks/useApi";

export default function DoctorsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["doctors"],
    queryFn: () => api.get("/api/doctors"),
  });

  const doctors: any[] = data?.doctors ?? [];

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + 16 }]}>
      <View style={{ paddingHorizontal: 16, marginBottom: 12 }}>
        <Text style={[styles.header, { color: colors.foreground }]}>Our Doctors</Text>
        <Text style={[styles.sub, { color: colors.mutedForeground }]}>
          Experienced specialists and referring physicians
        </Text>
      </View>

      {isLoading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator colors={colors} />
        </View>
      ) : doctors.length === 0 ? (
        <View style={styles.empty}>
          <Feather name="users" size={48} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No doctors listed</Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            Doctor profiles will appear here
          </Text>
        </View>
      ) : (
        <FlatList
          data={doctors}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
          }
          renderItem={({ item }) => <DoctorCard item={item} colors={colors} />}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        />
      )}
    </View>
  );
}

function DoctorCard({ item, colors }: { item: any; colors: any }) {
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.cardHeader}>
        <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
          <Text style={styles.avatarText}>{(item.name || "?").charAt(0).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.name, { color: colors.foreground }]}>Dr. {item.name}</Text>
          <Text style={[styles.spec, { color: colors.mutedForeground }]}>{item.specialty || "General Physician"}</Text>
        </View>
      </View>
      <View style={styles.metaRow}>
        <Feather name="phone" size={12} color={colors.mutedForeground} />
        <Text style={[styles.meta, { color: colors.mutedForeground }]}>{item.phone || "N/A"}</Text>
      </View>
      {item.qualification && (
        <View style={styles.metaRow}>
          <Feather name="award" size={12} color={colors.mutedForeground} />
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>{item.qualification}</Text>
        </View>
      )}
    </View>
  );
}

function ActivityIndicator({ colors }: { colors: any }) {
  return <View style={[styles.skeleton, { backgroundColor: colors.card }]} />;
}

function RefreshControl({ refreshing, onRefresh, tintColor }: { refreshing: boolean; onRefresh: () => void; tintColor: string }) {
  return null; // Stub for web; on native this is imported from react-native
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { fontSize: 24, fontFamily: "Inter_700Bold" },
  sub: { fontSize: 14, fontFamily: "Inter_400Regular", marginTop: 2 },
  card: { borderRadius: 16, borderWidth: 1, padding: 16 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#fff" },
  name: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  spec: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 1 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  meta: { fontSize: 12, fontFamily: "Inter_400Regular" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold", marginTop: 16 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 6 },
  skeleton: { height: 100, borderRadius: 16, opacity: 0.5, marginHorizontal: 16 },
});
