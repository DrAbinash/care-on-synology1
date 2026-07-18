import { StyleSheet, Text, View, ScrollView, Platform, Linking } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";

import { useColors } from "@/hooks/useColors";
import { useApi } from "@/hooks/useApi";
import {
  Card,
  IconTile,
  SectionLabel,
  Badge,
  InlineAlert,
  spacing,
  radii,
  cardShadow,
  type FeatherIconName,
} from "@/components/ui";

const SERVICES: { icon: FeatherIconName; label: string }[] = [
  { icon: "droplet", label: "Pathology" },
  { icon: "camera", label: "X-Ray" },
  { icon: "monitor", label: "Ultrasound" },
  { icon: "cpu", label: "CT / MRI" },
  { icon: "heart", label: "ECG" },
  { icon: "package", label: "Packages" },
];

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const api = useApi();
  const { data: config } = useQuery({
    queryKey: ["booking-config"],
    queryFn: () => api.get("/api/public/booking/config"),
  });

  const enabled = config?.enabled ?? false;
  const gateway = config?.gateway;
  const phone = config?.phone || "9973497200";

  const heroTopPad = Platform.OS === "web" ? 67 : insets.top + spacing.lg;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ paddingBottom: 110 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Hero */}
      <LinearGradient
        colors={["#0f766e", "#115e59"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.hero, { paddingTop: heroTopPad + spacing.sm }]}
      >
        <View style={styles.heroBrandRow}>
          <IconTile icon="activity" color="#0f766e" backgroundColor="#ffffff" size={44} />
          <View style={{ flex: 1 }}>
            <Text style={styles.heroTitle}>Care Diagnostics</Text>
            <Text style={styles.heroSubtitle}>Subhash Chowk, Castair's Town, Deoghar</Text>
          </View>
        </View>
        <View style={styles.heroChipRow}>
          <View style={styles.heroChip}>
            <Feather name="award" size={12} color="#ffffff" />
            <Text style={styles.heroChipText}>NABL Accredited</Text>
          </View>
          <View style={styles.heroChip}>
            <Feather name="clock" size={12} color="#ffffff" />
            <Text style={styles.heroChipText}>Same-day Reports</Text>
          </View>
        </View>
      </LinearGradient>

      <View style={styles.body}>
        {/* Book a Test — elevated CTA overlapping the hero */}
        <Card style={styles.ctaCard} onPress={() => router.push("/book")}>
          <IconTile icon="plus-circle" color={colors.primary} size={46} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.ctaTitle, { color: colors.foreground }]}>Book a Test</Text>
            <Text style={[styles.ctaSubtitle, { color: colors.mutedForeground }]}>
              Select tests, choose date & pay online
            </Text>
          </View>
          <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
        </Card>

        {!enabled && (
          <View style={{ marginBottom: spacing.xxl }}>
            <InlineAlert
              tone="warning"
              message="Online booking is currently disabled. Please call the clinic to book."
            />
          </View>
        )}

        {/* Services */}
        <SectionLabel>Services</SectionLabel>
        <View style={styles.serviceGrid}>
          {SERVICES.map((s) => (
            <Card key={s.label} style={styles.serviceTile}>
              <IconTile icon={s.icon} color={colors.primary} size={38} />
              <Text style={[styles.serviceLabel, { color: colors.foreground }]}>{s.label}</Text>
            </Card>
          ))}
        </View>

        {/* Quick access */}
        <SectionLabel>Quick access</SectionLabel>
        <View style={styles.quickRow}>
          <Card style={styles.quickCard} onPress={() => router.push("/bookings")}>
            <IconTile icon="file-text" color={colors.primary} size={40} />
            <Text style={[styles.quickLabel, { color: colors.foreground }]}>My Bookings</Text>
          </Card>
          <Card style={styles.quickCard} onPress={() => router.push("/reports")}>
            <IconTile icon="heart" color={colors.primary} size={40} />
            <Text style={[styles.quickLabel, { color: colors.foreground }]}>Lab Reports</Text>
          </Card>
        </View>

        {/* Payment options */}
        <SectionLabel>Payment options</SectionLabel>
        <View style={styles.payRow}>
          {gateway && (
            <Badge
              label={gateway.charAt(0).toUpperCase() + gateway.slice(1)}
              tone="primary"
              icon="credit-card"
            />
          )}
          <Badge label="UPI" tone="accent" icon="smartphone" />
        </View>

        {/* Contact strip */}
        <SectionLabel style={{ marginTop: spacing.section }}>Need help?</SectionLabel>
        <Card style={styles.contactCard} onPress={() => Linking.openURL("tel:" + phone)}>
          <IconTile icon="phone-call" color={colors.success} size={40} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.contactTitle, { color: colors.foreground }]}>Call the clinic</Text>
            <Text style={[styles.contactSub, { color: colors.mutedForeground }]}>{phone}</Text>
          </View>
          <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
        </Card>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  hero: {
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.section + spacing.xl,
  },
  heroBrandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  heroTitle: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
    color: "#ffffff",
  },
  heroSubtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#ffffffcc",
    marginTop: 2,
    lineHeight: 18,
  },
  heroChipRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.lg,
    flexWrap: "wrap",
  },
  heroChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#ffffff26",
    borderRadius: radii.chip,
    paddingVertical: 5,
    paddingHorizontal: 12,
  },
  heroChipText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: "#ffffff",
  },
  body: {
    paddingHorizontal: spacing.xl,
  },
  ctaCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    marginTop: -spacing.section,
    marginBottom: spacing.xxl,
  },
  ctaTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  ctaSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2, lineHeight: 18 },
  serviceGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    marginBottom: spacing.xxl,
  },
  serviceTile: {
    flexBasis: "30%",
    flexGrow: 1,
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.sm,
  },
  serviceLabel: { fontSize: 12, fontFamily: "Inter_500Medium", textAlign: "center" },
  quickRow: {
    flexDirection: "row",
    gap: spacing.md,
    marginBottom: spacing.xxl,
  },
  quickCard: {
    flex: 1,
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  quickLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  payRow: {
    flexDirection: "row",
    gap: spacing.sm,
    flexWrap: "wrap",
  },
  contactCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
  },
  contactTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  contactSub: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
});
