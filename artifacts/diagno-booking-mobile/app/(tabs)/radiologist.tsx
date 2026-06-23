import {
  StyleSheet, Text, View, ScrollView, TouchableOpacity,
  RefreshControl, FlatList, useColorScheme, Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";

import { useColors } from "@/hooks/useColors";
import { useStaffApi, useStaffAuth } from "@/context/StaffAuthContext";

export default function RadiologistScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const isDark = useColorScheme() === "dark";
  const { session, logout } = useStaffAuth();
  const api = useStaffApi();

  const isRad = session?.user.role === "radiologist" || session?.user.role === "admin" || session?.user.role === "super_admin";

  const cc = useQuery({
    queryKey: ["command-center"],
    queryFn: () => api.get("/api/radiology-workflow/command-center"),
    enabled: !!session,
  });

  const studies = useQuery({
    queryKey: ["incoming-studies"],
    queryFn: () => api.get("/api/radiology-workflow/incoming"),
    enabled: !!session,
  });

  const alerts = useQuery({
    queryKey: ["critical-alerts"],
    queryFn: () => api.get("/api/radiology-workflow/critical-alerts"),
    enabled: !!session,
  });

  if (!session) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + 24, alignItems: "center" }]}>
        <Feather name="radio" size={48} color={colors.mutedForeground} />
        <Text style={[styles.lockedTitle, { color: colors.foreground }]}>Staff Access Required</Text>
        <Text style={[styles.lockedSub, { color: colors.mutedForeground }]}>
          Log in as a radiologist to view DICOM studies and critical alerts.
        </Text>
        <TouchableOpacity
          style={[styles.loginBtn, { backgroundColor: colors.primary }]} 
          onPress={() => router.push("/staff-login" as any)}
        >
          <Text style={styles.loginBtnText}>Staff Login</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const data = cc.data;
  const openAlerts = alerts.data?.openFindings ?? [];
  const incoming = studies.data?.studies ?? [];

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      refreshControl={
        <RefreshControl refreshing={cc.isRefetching} onRefresh={cc.refetch} tintColor={colors.primary} />
      }
    >
      <View style={{ paddingTop: Platform.OS === "web" ? 67 : insets.top + 16, paddingHorizontal: 16 }}>
        {/* Header */}
        <View style={styles.headerRow}>
          <View>
            <Text style={[styles.title, { color: colors.foreground }]}>Radiologist Hub</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              Welcome, Dr. {session.user.name}
            </Text>
          </View>
          <TouchableOpacity onPress={logout} style={[styles.logoutBtn, { borderColor: colors.border }]}>
            <Feather name="log-out" size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        {/* Quick Stats */}
        <View style={styles.statsRow}>
          <StatCard
            label="Pending"
            value={data?.pendingReports ?? "—"}
            icon="clock"
            tint={colors.warning}
            colors={colors}
            isDark={isDark}
          />
          <StatCard
            label="Critical"
            value={openAlerts.length ?? "—"}
            icon="alert-triangle"
            tint={colors.destructive}
            colors={colors}
            isDark={isDark}
          />
          <StatCard
            label="Today"
            value={data?.studiesToday ?? "—"}
            icon="activity"
            tint={colors.success}
            colors={colors}
            isDark={isDark}
          />
          <StatCard
            label="AI Queue"
            value={data?.aiQueue?.queued ?? "—"}
            icon="cpu"
            tint={colors.accent}
            colors={colors}
            isDark={isDark}
          />
        </View>

        {/* Critical Alerts Banner */}
        {openAlerts.length > 0 && (
          <TouchableOpacity
            style={[styles.criticalBanner, { backgroundColor: colors.destructive + "18", borderColor: colors.destructive + "40" }]}
            onPress={() => router.push("/critical-alerts" as any)}
            activeOpacity={0.8}
          >
            <Feather name="alert-octagon" size={18} color={colors.destructive} />
            <Text style={[styles.criticalText, { color: colors.destructive }]}>
              {openAlerts.length} critical finding{openAlerts.length > 1 ? "s" : ""} require attention
            </Text>
            <Feather name="chevron-right" size={16} color={colors.destructive} />
          </TouchableOpacity>
        )}

        {/* Quick Actions */}
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Quick Actions</Text>
        <View style={styles.quickRow}>
          <QuickAction
            icon="list"
            label="Studies"
            onPress={() => router.push("/studies-list" as any)}
            colors={colors}
            isDark={isDark}
          />
          <QuickAction
            icon="edit-3"
            label="Report"
            onPress={() => router.push("/studies-list" as any)}
            colors={colors}
            isDark={isDark}
          />
          <QuickAction
            icon="alert-triangle"
            label="Alerts"
            onPress={() => router.push("/critical-alerts" as any)}
            colors={colors}
            isDark={isDark}
          />
          <QuickAction
            icon="bar-chart-2"
            label="Metrics"
            onPress={() => router.push("/command-center" as any)}
            colors={colors}
            isDark={isDark}
          />
        </View>

        {/* Incoming Studies Preview */}
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Recent Incoming Studies</Text>
        {studies.isLoading ? (
          <LoadingDots colors={colors} />
        ) : incoming.length === 0 ? (
          <Text style={[styles.empty, { color: colors.mutedForeground }]}>No recent incoming studies</Text>
        ) : (
          <FlatList
            data={incoming.slice(0, 5)}
            keyExtractor={(item) => String(item.id)}
            scrollEnabled={false}
            renderItem={({ item }) => <StudyRow item={item} colors={colors} />}
            ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: colors.border, marginLeft: 56 }} />}
          />
        )}
      </View>
    </ScrollView>
  );
}

function StatCard({ label, value, icon, tint, colors, isDark }: any) {
  return (
    <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.statIconWrap, { backgroundColor: isDark ? tint + "25" : tint + "12" }]}>
        <Feather name={icon} size={16} color={tint} />
      </View>
      <Text style={[styles.statValue, { color: colors.foreground }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

function QuickAction({ icon, label, onPress, colors, isDark }: any) {
  return (
    <TouchableOpacity
      style={[styles.quickBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.quickIcon, { backgroundColor: isDark ? colors.primary + "25" : colors.primary + "12" }]}>
        <Feather name={icon} size={18} color={colors.primary} />
      </View>
      <Text style={[styles.quickLabel, { color: colors.foreground }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function StudyRow({ item, colors }: any) {
  const status = item.transferStatus || "receiving";
  const statusColor =
    status === "complete" ? colors.success :
    status === "failed" ? colors.destructive :
    status === "quarantined" ? colors.warning :
    colors.primary;

  return (
    <View style={[styles.studyRow, { borderBottomColor: colors.border }]}>
      <View style={[styles.modBadge, { backgroundColor: statusColor + "15" }]}>
        <Text style={[styles.modText, { color: statusColor }]}>{item.modality}</Text>
      </View>
      <View style={styles.studyInfo}>
        <Text style={[styles.studyTitle, { color: colors.foreground }]} numberOfLines={1}>
          {item.patientName || "Unknown"}
        </Text>
        <Text style={[styles.studyMeta, { color: colors.mutedForeground }]}>
          {item.imageCount} images · {item.aeTitle || "N/A"} · {status}
        </Text>
      </View>
      <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
    </View>
  );
}

function LoadingDots({ colors }: any) {
  return (
    <View style={{ paddingVertical: 20, alignItems: "center" }}>
      <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>Loading...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  title: { fontSize: 26, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 14, fontFamily: "Inter_400Regular", marginTop: 2 },
  logoutBtn: { width: 36, height: 36, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  statsRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 },
  statCard: { flex: 1, minWidth: 72, borderRadius: 14, borderWidth: 1, padding: 12, alignItems: "center" },
  statIconWrap: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  statValue: { fontSize: 20, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 2 },
  criticalBanner: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 12, padding: 12, borderWidth: 1, marginBottom: 16 },
  criticalText: { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold" },
  sectionTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", marginTop: 20, marginBottom: 10 },
  quickRow: { flexDirection: "row", gap: 10 },
  quickBtn: { flex: 1, borderRadius: 14, borderWidth: 1, padding: 12, alignItems: "center" },
  quickIcon: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  quickLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  studyRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, paddingHorizontal: 4 },
  modBadge: { width: 44, height: 28, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  modText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  studyInfo: { flex: 1, marginLeft: 10 },
  studyTitle: { fontSize: 14, fontFamily: "Inter_500Medium" },
  studyMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  empty: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", paddingVertical: 16 },
  lockedTitle: { fontSize: 20, fontFamily: "Inter_700Bold", marginTop: 16 },
  lockedSub: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 8, paddingHorizontal: 32 },
  loginBtn: { marginTop: 24, paddingHorizontal: 28, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  loginBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
