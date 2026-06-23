import { StyleSheet, Text, View, ScrollView, TouchableOpacity, useColorScheme, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";

import { useColors } from "@/hooks/useColors";
import { useApi } from "@/hooks/useApi";

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";

  const api = useApi();
  const { data: config } = useQuery({
    queryKey: ["booking-config"],
    queryFn: () => api.get("/api/public/booking/config"),
  });

  const enabled = config?.enabled ?? false;
  const gateway = config?.gateway;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={{ paddingTop: Platform.OS === "web" ? 67 : insets.top + 16, paddingHorizontal: 20 }}>
        <View style={styles.headerRow}>
          <View>
            <Text style={[styles.title, { color: colors.foreground }]}>Care Diagnostics</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              Subhash Chowk, Castair's Town, Deoghar
            </Text>
          </View>
          <View style={[styles.logo, { backgroundColor: colors.primary }]}>
            <Feather name="activity" size={22} color="#fff" />
          </View>
        </View>

        {/* Main CTA */}
        <TouchableOpacity
          style={[styles.cta, { backgroundColor: colors.primary } ]}
          activeOpacity={0.85}
          onPress={() => router.push("/book")}
        >
          <View style={styles.ctaRow}>
            <View style={styles.ctaIconBox}>
              <Feather name="plus-circle" size={28} color={colors.primary} />
            </View>
            <View>
              <Text style={styles.ctaTitle}>Book a Test</Text>
              <Text style={styles.ctaSubtitle}>Select tests, choose date & pay online</Text>
            </View>
          </View>
          <Feather name="chevron-right" size={22} color="#ffffff80" />
        </TouchableOpacity>

        {!enabled && (
          <View style={[styles.warn, { backgroundColor: colors.warning + "12", borderColor: colors.warning + "40" }]}>
            <Feather name="alert-triangle" size={16} color={colors.warning} />
            <Text style={[styles.warnText, { color: colors.warning }]}>
              Online booking is currently disabled. Please call the clinic to book.
            </Text>
          </View>
        )}

        {/* Quick actions */}
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Quick Access</Text>
        <View style={styles.quickRow}>
          <QuickButton
            icon="file-text"
            label="My Bookings"
            onPress={() => router.push("/bookings")}
            colors={colors}
            isDark={isDark}
          />
          <QuickButton
            icon="heart"
            label="Lab Reports"
            onPress={() => router.push("/reports")}
            colors={colors}
            isDark={isDark}
          />
        </View>

        {/* Payment badges */}
        <Text style={[styles.sectionTitle, { color: colors.foreground, marginTop: 8 }]}>Payment Options</Text>
        <View style={styles.payRow}>
          {gateway && (
            <View style={[styles.payBadge, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="credit-card" size={14} color={colors.primary} />
              <Text style={[styles.payText, { color: colors.foreground }]}>{gateway.charAt(0).toUpperCase() + gateway.slice(1)}</Text>
            </View>
          )}
          <View style={[styles.payBadge, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="smartphone" size={14} color={colors.accent} />
            <Text style={[styles.payText, { color: colors.foreground }]}>UPI</Text>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

function QuickButton({ icon, label, onPress, colors, isDark }: any) {
  return (
    <TouchableOpacity
      style={[styles.quickBtn, { backgroundColor: colors.card, borderColor: colors.border, shadowColor: colors.shadow }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.quickIcon, { backgroundColor: isDark ? colors.primary + "20" : colors.primary + "12" }]}>
        <Feather name={icon} size={18} color={colors.primary} />
      </View>
      <Text style={[styles.quickLabel, { color: colors.foreground }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 24 },
  title: { fontSize: 28, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 15, fontFamily: "Inter_400Regular", marginTop: 2 },
  logo: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  cta: { borderRadius: 18, padding: 18, marginBottom: 18, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  ctaRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  ctaIconBox: { width: 48, height: 48, borderRadius: 14, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  ctaTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: "#fff" },
  ctaSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#ffffffbb", marginTop: 2 },
  warn: { flexDirection: "row", gap: 8, alignItems: "flex-start", borderRadius: 12, padding: 12, borderWidth: 1, marginBottom: 16 },
  warnText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular" },
  sectionTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", marginBottom: 12 },
  quickRow: { flexDirection: "row", gap: 12, marginBottom: 24 },
  quickBtn: { flex: 1, borderRadius: 14, borderWidth: 1, padding: 14, alignItems: "center", gap: 8 },
  quickIcon: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  quickLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  payRow: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  payBadge: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 20, borderWidth: 1, paddingVertical: 6, paddingHorizontal: 14 },
  payText: { fontSize: 12, fontFamily: "Inter_500Medium" },
});
