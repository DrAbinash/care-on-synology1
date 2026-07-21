import { StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";

import { useColors } from "@/hooks/useColors";
import { useStaffApi, useStaffAuth } from "@/context/StaffAuthContext";
import {
  Screen,
  BackBar,
  ScreenHeader,
  Card,
  Badge,
  DetailRow,
  InlineAlert,
  AppButton,
  SectionLabel,
  Skeleton,
  SkeletonList,
  EmptyState,
  spacing,
  radii,
} from "@/components/ui";

type StatusTone = "success" | "destructive" | "warning" | "primary" | "muted";

function statusTone(status: string): StatusTone {
  switch (status) {
    case "complete":
      return "success";
    case "failed":
      return "destructive";
    case "quarantined":
      return "warning";
    case "receiving":
      return "primary";
    default:
      return "muted";
  }
}

export default function StudyDetailScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams();
  const api = useStaffApi();
  const { session } = useStaffAuth();

  const studyId = Number(id);

  const studies = useQuery({
    queryKey: ["incoming-studies"],
    queryFn: () => api.get("/api/radiology-workflow/incoming"),
    enabled: !!session,
  });

  const allStudies = studies.data?.studies ?? [];
  const study = allStudies.find((s: any) => s.id === studyId);

  if (!study && !studies.isLoading) {
    return (
      <Screen>
        <BackBar />
        <EmptyState
          icon="search"
          title="Study not found"
          message="This study may have been removed or is no longer available."
        />
      </Screen>
    );
  }

  if (!study) {
    return (
      <Screen>
        <BackBar />
        <Skeleton height={200} style={{ marginBottom: spacing.md }} />
        <SkeletonList count={3} height={72} />
      </Screen>
    );
  }

  const rows: { label: string; value: string }[] = [
    { label: "Patient", value: study.patientName || "Unknown" },
    { label: "Accession #", value: study.accessionNumber || "N/A" },
    {
      label: "Study UID",
      value: study.studyInstanceUID ? `${String(study.studyInstanceUID).slice(0, 30)}…` : "N/A",
    },
    { label: "Modality", value: study.modality || "N/A" },
    { label: "AE Title", value: study.aeTitle || "N/A" },
    { label: "Images", value: String(study.imageCount) },
    { label: "Series", value: String(study.seriesCount) },
  ];
  if (study.bodyPart) rows.push({ label: "Body Part", value: study.bodyPart });
  if (study.studyDescription) rows.push({ label: "Description", value: study.studyDescription });

  const hasAlerts = study.aeMismatch || study.duplicateStudy || study.incompleteStudy;

  return (
    <Screen>
      <BackBar />
      <ScreenHeader title="Study Detail" subtitle={study.patientName || "Unknown patient"} />

      <View style={styles.badgeRow}>
        <Badge label={study.modality || "—"} tone="accent" />
        <Badge label={String(study.transferStatus).toUpperCase()} tone={statusTone(study.transferStatus)} />
      </View>

      {/* DICOM viewer placeholder */}
      <Card style={styles.thumbCard}>
        <View style={[styles.thumbIcon, { backgroundColor: colors.muted }]}>
          <Feather name="image" size={28} color={colors.mutedForeground} />
        </View>
        <Text style={[styles.thumbLabel, { color: colors.foreground }]}>DICOM Image Viewer</Text>
        <Text style={[styles.thumbSub, { color: colors.mutedForeground }]}>
          Web-based DICOM viewer integration coming soon.
        </Text>
      </Card>

      {hasAlerts ? (
        <View style={styles.alertStack}>
          {study.aeMismatch ? <InlineAlert tone="warning" message="AE Title mismatch detected" /> : null}
          {study.duplicateStudy ? <InlineAlert tone="warning" message="Duplicate Study UID detected" /> : null}
          {study.incompleteStudy ? (
            <InlineAlert tone="destructive" message="Incomplete study (missing images)" />
          ) : null}
        </View>
      ) : null}

      <SectionLabel style={{ marginTop: spacing.xxl }}>Study metadata</SectionLabel>
      <Card style={{ paddingVertical: spacing.xs }}>
        {rows.map((row, index) => (
          <DetailRow key={row.label} label={row.label} value={row.value} last={index === rows.length - 1} />
        ))}
      </Card>

      <SectionLabel style={{ marginTop: spacing.xxl }}>Actions</SectionLabel>
      <View style={[styles.note, { backgroundColor: colors.muted }]}>
        <Feather name="info" size={15} color={colors.mutedForeground} style={{ marginTop: 1 }} />
        <Text style={[styles.noteText, { color: colors.mutedForeground }]}>
          PACS viewer integration coming soon
        </Text>
      </View>
      <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
        <AppButton
          label="Open in PACS Viewer"
          icon="external-link"
          variant="secondary"
          disabled
          onPress={() => {}}
        />
        <AppButton label="Create Report" icon="file-text" variant="secondary" disabled onPress={() => {}} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  badgeRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.lg },
  thumbCard: { alignItems: "center", paddingVertical: spacing.section },
  thumbIcon: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  thumbLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  thumbSub: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginTop: 4,
    lineHeight: 20,
    textAlign: "center",
  },
  alertStack: { gap: spacing.sm, marginTop: spacing.lg },
  note: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    borderRadius: radii.icon,
    padding: spacing.md,
  },
  noteText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", lineHeight: 18 },
});
