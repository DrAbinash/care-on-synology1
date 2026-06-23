import { StyleSheet, Text, View, TouchableOpacity, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";

import { useColors } from "@/hooks/useColors";

export default function BookingDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams();

  // In a real app, fetch booking details by ID. For now, show a placeholder.
  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + 16 }]}>
      <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
        <Feather name="arrow-left" size={20} color={colors.foreground} />
        <Text style={[styles.backText, { color: colors.foreground }]}>Back</Text>
      </TouchableOpacity>

      <Text style={[styles.title, { color: colors.foreground }]}>Booking Details</Text>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.label, { color: colors.mutedForeground }]}>Booking ID</Text>
        <Text style={[styles.value, { color: colors.foreground }]}>{id}</Text>
        <Text style={[styles.label, { color: colors.mutedForeground, marginTop: 12 }]}>Status</Text>
        <View style={[styles.statusBadge, { backgroundColor: colors.accent + "18" }]}>
          <Text style={[styles.statusText, { color: colors.accent }]}>Pending</Text>
        </View>
        <Text style={[styles.label, { color: colors.mutedForeground, marginTop: 12 }]}>Tests</Text>
        <Text style={[styles.value, { color: colors.foreground }]}>CBC, Lipid Profile</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16 },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 },
  backText: { fontSize: 15, fontFamily: "Inter_500Medium" },
  title: { fontSize: 24, fontFamily: "Inter_700Bold", marginBottom: 16 },
  card: { borderRadius: 16, borderWidth: 1, padding: 20 },
  label: { fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 4 },
  value: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  statusBadge: { alignSelf: "flex-start", borderRadius: 8, paddingVertical: 4, paddingHorizontal: 12 },
  statusText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
});
