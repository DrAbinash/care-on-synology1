import { useEffect } from "react";
import { StyleSheet, View, Text, FlatList, RefreshControl } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";

import { useColors } from "@/hooks/useColors";
import { useAuth, usePatientApi } from "@/context/AuthContext";
import {
  Screen,
  ScreenHeader,
  Card,
  IconTile,
  Badge,
  SkeletonList,
  EmptyState,
  spacing,
  type FeatherIconName,
} from "@/components/ui";

type StatusTone = "success" | "warning" | "destructive";

function statusMeta(status: string): { icon: FeatherIconName; tone: StatusTone; label: string } {
  if (status === "paid") return { icon: "check-circle", tone: "success", label: "Paid" };
  if (status === "confirmed") return { icon: "check-circle", tone: "success", label: "Confirmed" };
  if (status === "cancelled") return { icon: "x-circle", tone: "destructive", label: "Cancelled" };
  if (status === "pending_payment") return { icon: "clock", tone: "warning", label: "Payment Pending" };
  return { icon: "clock", tone: "warning", label: status.charAt(0).toUpperCase() + status.slice(1) };
}

export default function BookingsScreen() {
  const colors = useColors();
  const router = useRouter();
  const api = usePatientApi();
  const { user, clearSession } = useAuth();

  const { data, isLoading, refetch, isRefetching, error } = useQuery({
    queryKey: ["my-bookings", user?.phone],
    queryFn: () => api.get("/api/patient/my-bookings"),
    enabled: !!user?.token,
    retry: false,
  });

  // A 401 means the server-side session expired — drop the stored session so
  // the login prompt reappears instead of an endless error state.
  useEffect(() => {
    if (error && /session expired|login required/i.test(error.message || "")) {
      clearSession();
    }
  }, [error, clearSession]);

  const bookings: any[] = data?.bookings ?? [];

  return (
    <Screen scroll={false}>
      <ScreenHeader
        title="My Bookings"
        subtitle={user?.phone ? "Your appointments and test bookings" : "Login to view your bookings"}
      />

      {!user?.phone ? (
        <EmptyState
          icon="lock"
          title="Login Required"
          message="Please log in with your phone number to see your bookings"
          actionLabel="Login"
          onAction={() => router.push("/login")}
        />
      ) : isLoading ? (
        <SkeletonList count={4} />
      ) : bookings.length === 0 ? (
        <EmptyState
          icon="calendar"
          title="No bookings yet"
          message="Book your first test from the Home screen"
          actionLabel="Book Now"
          onAction={() => router.push("/book")}
        />
      ) : (
        <FlatList
          data={bookings}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ gap: spacing.md, paddingBottom: 110 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
          }
          renderItem={({ item }) => (
            <BookingCard
              item={item}
              onPress={() => router.push(`/booking-detail?ref=${encodeURIComponent(item.bookingRef)}`)}
            />
          )}
        />
      )}
    </Screen>
  );
}

function BookingCard({ item, onPress }: { item: any; onPress: () => void }) {
  const colors = useColors();
  const status = String(item.status || "pending");
  const meta = statusMeta(status);
  const toneColor =
    meta.tone === "success" ? colors.success : meta.tone === "destructive" ? colors.destructive : colors.warning;

  return (
    <Card onPress={onPress}>
      <View style={styles.rowTop}>
        <IconTile icon={meta.icon} color={toneColor} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.ref, { color: colors.foreground }]} numberOfLines={1}>
            {item.bookingRef}
          </Text>
          <Text style={[styles.name, { color: colors.mutedForeground }]} numberOfLines={1}>
            {item.patientName || item.name}
          </Text>
        </View>
        <Text style={[styles.amount, { color: colors.foreground }]}>
          ₹{Number(item.totalAmount || 0).toLocaleString("en-IN")}
        </Text>
      </View>
      <View style={styles.rowBottom}>
        <Text style={[styles.date, { color: colors.mutedForeground }]} numberOfLines={1}>
          {[item.selectedDate || "", item.timeSlot || ""].filter(Boolean).join(" · ")}
        </Text>
        <Badge label={meta.label} tone={meta.tone} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  rowTop: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  rowBottom: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  ref: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  name: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  amount: { fontSize: 15, fontFamily: "Inter_700Bold" },
  date: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },
});
