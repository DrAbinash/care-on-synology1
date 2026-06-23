import {
  StyleSheet, Text, View, ScrollView, TouchableOpacity, Image,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";

import { useColors } from "@/hooks/useColors";
import { useStaffApi, useStaffAuth } from "@/context/StaffAuthContext";

export default function StudyDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
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
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + 24 }]}>
        <TouchableOpacity onPress={() => router.back()} style={{ paddingHorizontal: 16, marginBottom: 12 }}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.notFound, { color: colors.mutedForeground }]}>Study not found</Text>
      </View>
    );
  }

  if (!study) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + 24 }]}>
        <TouchableOpacity onPress={() => router.back()} style={{ paddingHorizontal: 16, marginBottom: 12 }}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.notFound, { color: colors.mutedForeground }]}>Loading...</Text>
      </View>
    );
  }

  const statusColor =
    study.transferStatus === "complete" ? colors.success :
    study.transferStatus === "failed" ? colors.destructive :
    study.transferStatus === "quarantined" ? colors.warning :
    colors.primary;

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={{ paddingTop: insets.top + 16, paddingHorizontal: 16 }}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.back()}>
            <Feather name="arrow-left" size={22} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.foreground }]}>Study Detail</Text>
          <View style={{ width: 22 }} />
        </View>

        {/* DICOM Thumbnail Placeholder */}
        <View style={[styles.thumbWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="image" size={48} color={colors.mutedForeground} />
          <Text style={[styles.thumbLabel, { color: colors.mutedForeground }]}>
            DICOM Image Viewer
          </Text>
          <Text style={[styles.thumbSub, { color: colors.mutedForeground }]}>
            Web-based DICOM viewer integration coming soon.
          </Text>
        </View>

        {/* Status */}
        <View style={[styles.statusBar, { backgroundColor: statusColor + "12", borderColor: statusColor + "30" }]}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[styles.statusText, { color: statusColor }]}>{study.transferStatus.toUpperCase()}</Text>
        </View>

        {/* Metadata */}
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Study Metadata</Text>
        <MetaRow label="Patient" value={study.patientName || "Unknown"} colors={colors} />
        <MetaRow label="Accession #" value={study.accessionNumber || "N/A"} colors={colors} />
        <MetaRow label="Study UID" value={study.studyInstanceUID?.slice(0, 30) + "..." || "N/A"} colors={colors} />
        <MetaRow label="Modality" value={study.modality} colors={colors} />
        <MetaRow label="AE Title" value={study.aeTitle || "N/A"} colors={colors} />
        <MetaRow label="Images" value={String(study.imageCount)} colors={colors} />
        <MetaRow label="Series" value={String(study.seriesCount)} colors={colors} />
        {study.bodyPart && <MetaRow label="Body Part" value={study.bodyPart} colors={colors} />}
        {study.studyDescription && <MetaRow label="Description" value={study.studyDescription} colors={colors} />}

        {/* Alerts */}
        {study.aeMismatch && (
          <View style={[styles.alertBox, { backgroundColor: colors.warning + "12", borderColor: colors.warning + "40" }]}>
            <Feather name="alert-triangle" size={16} color={colors.warning} />
            <Text style={[styles.alertText, { color: colors.warning }]}>AE Title mismatch detected</Text>
          </View>
        )}
        {study.duplicateStudy && (
          <View style={[styles.alertBox, { backgroundColor: colors.warning + "12", borderColor: colors.warning + "40" }]}>
            <Feather name="copy" size={16} color={colors.warning} />
            <Text style={[styles.alertText, { color: colors.warning }]}>Duplicate Study UID detected</Text>
          </View>
        )}
        {study.incompleteStudy && (
          <View style={[styles.alertBox, { backgroundColor: colors.destructive + "12", borderColor: colors.destructive + "40" }]}>
            <Feather name="alert-circle" size={16} color={colors.destructive} />
            <Text style={[styles.alertText, { color: colors.destructive }]}>Incomplete study (missing images)</Text>
          </View>
        )}

        {/* Actions */}
        <Text style={[styles.sectionTitle, { color: colors.foreground, marginTop: 24 }]}>Actions</Text>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: colors.primary }]} activeOpacity={0.8}>
          <Feather name="external-link" size={16} color="#fff" />
          <Text style={styles.actionBtnText}>Open in PACS Viewer</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }]} activeOpacity={0.8}>
          <Feather name="file-text" size={16} color={colors.primary} />
          <Text style={[styles.actionBtnText, { color: colors.primary }]}>Create Report</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function MetaRow({ label, value, colors }: any) {
  return (
    <View style={[styles.metaRow, { borderBottomColor: colors.border }]}>
      <Text style={[styles.metaLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.metaValue, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  title: { fontSize: 18, fontFamily: "Inter_700Bold" },
  notFound: { fontSize: 16, fontFamily: "Inter_400Regular", textAlign: "center", paddingVertical: 40 },
  thumbWrap: { borderRadius: 14, borderWidth: 1, height: 200, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  thumbLabel: { fontSize: 16, fontFamily: "Inter_600SemiBold", marginTop: 12 },
  thumbSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 4 },
  statusBar: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, marginBottom: 16 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 8 },
  metaRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 1 },
  metaLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  metaValue: { fontSize: 13, fontFamily: "Inter_500Medium" },
  alertBox: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, padding: 10, borderWidth: 1, marginTop: 8 },
  alertText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  actionBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, height: 44, marginTop: 8 },
  actionBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
