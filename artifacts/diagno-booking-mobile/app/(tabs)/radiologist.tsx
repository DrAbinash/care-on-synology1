import { StyleSheet, Text, View, TouchableOpacity, RefreshControl } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";

import { useColors } from "@/hooks/useColors";
import { useStaffApi, useStaffAuth } from "@/context/StaffAuthContext";
import { hasBillDeskAccess } from "@/app/bill-desk";
import {
  Screen,
  ScreenHeader,
  SectionLabel,
  Card,
  IconTile,
  Badge,
  SkeletonList,
  EmptyState,
  spacing,
  radii,
  type FeatherIconName,
} from "@/components/ui";

export default function RadiologistScreen() {
  const colors = useColors();
  const router = useRouter();
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
      <Screen scroll={false}>
        <EmptyState
          icon="shield"
          title="Staff Access Required"
          message="Log in as a radiologist to view DICOM studies and critical alerts."
          actionLabel="Staff Login"
          onAction={() => router.push("/staff-login" as any)}
        />
      </Screen>
    );
  }

  const data = cc.data;
  const openAlerts = alerts.data?.openFindings ?? [];
  const incoming = studies.data?.studies ?? [];

  return (
    <Screen
      refreshControl={
        <RefreshControl refreshing={cc.isRefetching} onRefresh={cc.refetch} tintColor={colors.primary} />
      }
    >
      <ScreenHeader
        title="Radiologist Hub"
        subtitle={`Welcome, Dr. ${session.user.name}`}
        right={
          <TouchableOpacity
            onPress={logout}
            style={[styles.logoutBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
            hitSlop={6}
            activeOpacity={0.6}
          >
            <Feather name="log-out" size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
        }
      />

      {/* KPI stat tiles */}
      <View style={styles.statGrid}>
        <StatTile label="Pending" value={data?.pendingReports ?? "—"} icon="clock" tint={colors.warning} />
        <StatTile label="Critical" value={openAlerts.length ?? "—"} icon="alert-triangle" tint={colors.destructive} />
        <StatTile label="Today" value={data?.studiesToday ?? "—"} icon="activity" tint={colors.success} />
        <StatTile label="AI Queue" value={data?.aiQueue?.queued ?? "—"} icon="cpu" tint={colors.accent} />
      </View>

      {/* Critical alerts banner */}
      {openAlerts.length > 0 && (
        <TouchableOpacity
          style={[
            styles.criticalBanner,
            { backgroundColor: colors.destructive + "12", borderColor: colors.destructive + "36" },
          ]}
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

      <SectionLabel style={{ marginTop: spacing.md }}>Quick actions</SectionLabel>
      <View style={styles.quickRow}>
        <QuickAction icon="list" label="Studies" onPress={() => router.push("/studies-list" as any)} />
        <QuickAction icon="edit-3" label="Report" onPress={() => router.push("/studies-list" as any)} />
        <QuickAction icon="alert-triangle" label="Alerts" onPress={() => router.push("/critical-alerts" as any)} />
        <QuickAction icon="bar-chart-2" label="Metrics" onPress={() => router.push("/command-center" as any)} />
      </View>

      {/* Bill Desk — shown only to staff granted the dedicated
          /mobile-bill-desk permission (ERP Settings → Users). */}
      {hasBillDeskAccess(session.user.role, session.user.permissions) && (
        <Card
          style={styles.billDeskCard}
          onPress={() => router.push("/bill-desk" as any)}
        >
          <IconTile icon="dollar-sign" color={colors.success} size={40} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.billDeskTitle, { color: colors.foreground }]}>Bill Desk</Text>
            <Text style={[styles.billDeskSub, { color: colors.mutedForeground }]}>
              Today's collections, bills & payments
            </Text>
          </View>
          <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
        </Card>
      )}

      <SectionLabel style={{ marginTop: spacing.section }}>Recent incoming studies</SectionLabel>
      {studies.isLoading ? (
        <SkeletonList count={3} height={78} />
      ) : incoming.length === 0 ? (
        <EmptyState
          icon="inbox"
          title="No incoming studies"
          message="Newly received DICOM studies will appear here."
        />
      ) : (
        <View style={{ gap: spacing.md }}>
          {incoming.slice(0, 5).map((item: any) => (
            <StudyRow key={String(item.id)} item={item} />
          ))}
        </View>
      )}
    </Screen>
  );
}

function StatTile({
  label,
  value,
  icon,
  tint,
}: {
  label: string;
  value: string | number;
  icon: FeatherIconName;
  tint: string;
}) {
  const colors = useColors();
  return (
    <Card style={styles.statTile}>
      <IconTile icon={icon} color={tint} size={34} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.statValue, { color: colors.foreground }]} numberOfLines={1}>
          {value}
        </Text>
        <Text style={[styles.statLabel, { color: colors.mutedForeground }]} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Card>
  );
}

function QuickAction({
  icon,
  label,
  onPress,
}: {
  icon: FeatherIconName;
  label: string;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Card style={styles.quickBtn} onPress={onPress}>
      <IconTile icon={icon} color={colors.primary} size={38} />
      <Text style={[styles.quickLabel, { color: colors.foreground }]}>{label}</Text>
    </Card>
  );
}

function StudyRow({ item }: { item: any }) {
  const colors = useColors();
  const status: string = item.transferStatus || "receiving";

  const statusMeta: Record<string, { tone: "success" | "destructive" | "warning" | "primary"; icon: FeatherIconName; label: string }> = {
    complete: { tone: "success", icon: "check-circle", label: "Complete" },
    failed: { tone: "destructive", icon: "x-circle", label: "Failed" },
    quarantined: { tone: "warning", icon: "alert-triangle", label: "Quarantined" },
    receiving: { tone: "primary", icon: "download-cloud", label: "Receiving" },
  };
  const meta = statusMeta[status] ?? statusMeta.receiving;
  const tint =
    meta.tone === "success"
      ? colors.success
      : meta.tone === "destructive"
        ? colors.destructive
        : meta.tone === "warning"
          ? colors.warning
          : colors.primary;

  return (
    <Card style={styles.studyRow}>
      <IconTile icon={meta.icon} color={tint} />
      <View style={styles.studyInfo}>
        <Text style={[styles.studyTitle, { color: colors.foreground }]} numberOfLines={1}>
          {item.patientName || "Unknown"}
        </Text>
        <Text style={[styles.studyMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
          {item.modality} · {item.imageCount} images · {item.aeTitle || "N/A"}
        </Text>
      </View>
      <Badge label={meta.label} tone={meta.tone} />
    </Card>
  );
}

const styles = StyleSheet.create({
  logoutBtn: {
    width: 40,
    height: 40,
    borderRadius: radii.icon,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  statGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  statTile: {
    flexGrow: 1,
    flexBasis: "44%",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
  },
  statValue: { fontSize: 24, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  statLabel: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 1 },
  criticalBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radii.icon,
    borderWidth: 1,
    padding: spacing.md,
    marginBottom: spacing.lg,
    minHeight: 44,
  },
  criticalText: { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold", lineHeight: 19 },
  quickRow: { flexDirection: "row", gap: spacing.md },
  quickBtn: {
    flex: 1,
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
  },
  quickLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  billDeskCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    marginTop: spacing.lg,
  },
  billDeskTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  billDeskSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  studyRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md },
  studyInfo: { flex: 1 },
  studyTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  studyMeta: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2, lineHeight: 18 },
});
