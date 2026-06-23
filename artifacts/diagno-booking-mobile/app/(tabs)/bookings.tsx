import { StyleSheet, View, Text, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";

import { useColors } from "@/hooks/useColors";
import { useApi } from "@/hooks/useApi";
import { useAuth } from "@/context/AuthContext";

export default function BookingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();
  const { user } = useAuth();

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["my-bookings", user?.phone],
    queryFn: () => api.get("/api/public/booking/my-bookings?phone=" + encodeURIComponent(user?.phone || "")),
    enabled: !!user?.phone,
  });

  const bookings: any[] = data?.bookings ?? [];

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + 16 }]}>
      <View style={{ paddingHorizontal: 16, marginBottom: 12 }}>
        <Text style={[styles.header, { color: colors.foreground }]}>My Bookings</Text>
        <Text style={[styles.sub, { color: colors.mutedForeground }]}>
          {user?.phone ? "Your appointments and test bookings" : "Login to view your bookings"}
        </Text>
      </View>

      {!user?.phone ? (
        <View style={styles.empty}>
          <Feather name="lock" size={48} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground, marginTop: 16 }]}>Login Required</Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            Please log in with your phone number to see your bookings
          </Text>
          <TouchableOpacity
            style={[styles.refreshBtn, { backgroundColor: colors.primary } ]}
            onPress={() => router.push("/login")}
          >
            <Text style={styles.refreshBtnText}>Login</Text>
          </TouchableOpacity>
        </View>
      ) : isLoading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : bookings.length === 0 ? (
        <View style={styles.empty}>
          <Feather name="calendar" size={48} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No bookings yet</Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            Book your first test from the Home screen
          </Text>
          <TouchableOpacity
            style={[styles.refreshBtn, { backgroundColor: colors.primary } ]}
            onPress={() => router.push("/book")}
          >
            <Text style={styles.refreshBtnText}>Book Now</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={bookings}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
          }
          renderItem={({ item }) => <BookingCard item={item} colors={colors} onPress={() => router.push(`/booking-detail?id=${item.id}`)} />}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        />
      )}
    </View>
  );
}

function BookingCard({ item, colors, onPress }: { item: any; colors: any; onPress: () => void }) {
  const status = item.status || "pending";
  const isPaid = status === "paid" || status === "confirmed";
  const statusColor = isPaid ? colors.success : status === "cancelled" ? colors.destructive : colors.warning;

  return (
    <TouchableOpacity style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.cardHeader}>
        <View style={[styles.iconBox, { backgroundColor: statusColor + "18" }]}>
          <Feather name={isPaid ? "check-circle" : "clock"} size={20} color={statusColor} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.ref, { color: colors.foreground }]}>Ref: {item.bookingRef}</Text>
          <Text style={[styles.name, { color: colors.mutedForeground }]}>{item.patientName || item.name}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: statusColor + "18" }]}>
          <Text style={[styles.statusText, { color: statusColor }]}>{status.toUpperCase()}</Text>
        </View>
      </View>
      <Text style={[styles.date, { color: colors.mutedForeground }]}>
        {item.appointmentDate || item.date || ""} · {item.timeSlot || ""}
      </Text>
      <Text style={[styles.amount, { color: colors.foreground }]}>
        ₹{Number(item.amount || 0).toLocaleString("en-IN")}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { fontSize: 24, fontFamily: "Inter_700Bold", paddingHorizontal: 16, marginBottom: 4 },
  sub: { fontSize: 14, fontFamily: "Inter_400Regular", paddingHorizontal: 16, marginBottom: 16, color: "#64748b" },
  card: { borderRadius: 16, padding: 16, borderWidth: 1 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 },
  iconBox: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  ref: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  name: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  statusBadge: { borderRadius: 8, paddingVertical: 3, paddingHorizontal: 10 },
  statusText: { fontSize: 10, fontFamily: "Inter_700Bold" },
  date: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4 },
  amount: { fontSize: 15, fontFamily: "Inter_700Bold", marginTop: 6 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold", marginTop: 16 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 6 },
  refreshBtn: { marginTop: 20, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24 },
  refreshBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
