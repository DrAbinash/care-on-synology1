import { useEffect, useState } from "react";
import { StyleSheet, View, Text, RefreshControl } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import * as Haptics from "expo-haptics";

import { useColors } from "@/hooks/useColors";
import { getBaseUrl } from "@/hooks/useApi";
import { useAuth, usePatientApi } from "@/context/AuthContext";
import {
  Screen,
  ScreenHeader,
  Card,
  IconTile,
  Badge,
  AppButton,
  SkeletonList,
  EmptyState,
  InlineAlert,
  spacing,
} from "@/components/ui";

type ReportRow = {
  id: number;
  reportNumber: string;
  title: string;
  type: string;
  status: string;
  patientName: string;
  date: string | null;
};

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export default function ReportsScreen() {
  const colors = useColors();
  const router = useRouter();
  const api = usePatientApi();
  const { user, clearSession } = useAuth();
  const [openError, setOpenError] = useState("");

  const { data, isLoading, refetch, isRefetching, error } = useQuery({
    queryKey: ["my-reports", user?.phone],
    queryFn: () => api.get("/api/patient/my-reports") as Promise<{ reports: ReportRow[] }>,
    enabled: !!user?.token,
    retry: false,
  });

  // Session expired server-side → drop the stored session so the login
  // prompt reappears instead of a dead error state.
  useEffect(() => {
    if (error && /session expired|login required/i.test(error.message || "")) {
      clearSession();
    }
  }, [error, clearSession]);

  const reports = data?.reports ?? [];

  // The report PDF opens through a short-lived tokenized link the server
  // mints only after checking this session owns the report.
  const openReport = async (report: ReportRow) => {
    setOpenError("");
    try {
      const res = await api.post(`/api/patient/reports/${report.id}/link`, {}) as { url: string };
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await WebBrowser.openBrowserAsync(getBaseUrl() + res.url);
    } catch (e: unknown) {
      setOpenError(e instanceof Error ? e.message : "Could not open the report. Please try again.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  if (!user?.token) {
    return (
      <Screen scroll={false}>
        <ScreenHeader title="My Reports" subtitle="Login to view your lab reports" />
        <EmptyState
          icon="lock"
          title="Login Required"
          message="Verify your phone number to securely access your lab reports."
          actionLabel="Login"
          onAction={() => router.push("/login")}
        />
      </Screen>
    );
  }

  return (
    <Screen
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
      }
    >
      <ScreenHeader title="My Reports" subtitle="Lab results linked to your mobile number" />

      {openError ? (
        <View style={{ marginBottom: spacing.md }}>
          <InlineAlert tone="destructive" message={openError} />
        </View>
      ) : null}

      {isLoading ? (
        <SkeletonList count={4} height={110} />
      ) : reports.length === 0 ? (
        <EmptyState
          icon="file-text"
          title="No reports yet"
          message="Verified lab reports for your registered mobile number will appear here."
          actionLabel="Refresh"
          onAction={refetch}
        />
      ) : (
        <View style={{ gap: spacing.md }}>
          {reports.map((item) => (
            <ReportCard key={String(item.id)} item={item} onOpen={() => openReport(item)} />
          ))}
        </View>
      )}
    </Screen>
  );
}

function ReportCard({ item, onOpen }: { item: ReportRow; onOpen: () => void }) {
  const colors = useColors();

  return (
    <Card>
      <View style={styles.cardHeader}>
        <IconTile
          icon={item.type === "radiology" ? "monitor" : "droplet"}
          color={colors.success}
        />
        <View style={{ flex: 1 }}>
          <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={2}>
            {item.title}
          </Text>
          <Text style={[styles.meta, { color: colors.mutedForeground }]} numberOfLines={1}>
            {[item.patientName, item.reportNumber].filter(Boolean).join(" · ")}
          </Text>
        </View>
        <Badge label="Ready" tone="success" icon="check-circle" />
      </View>

      <View style={styles.cardFooter}>
        <Text style={[styles.date, { color: colors.mutedForeground }]}>{fmtDate(item.date)}</Text>
        <AppButton
          label="View Report"
          icon="file-text"
          variant="secondary"
          onPress={onOpen}
          style={styles.viewBtn}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  cardHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  name: { fontSize: 15, fontFamily: "Inter_600SemiBold", lineHeight: 20 },
  meta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.md,
  },
  date: { fontSize: 13, fontFamily: "Inter_400Regular" },
  viewBtn: { paddingVertical: 10, paddingHorizontal: spacing.lg },
});
