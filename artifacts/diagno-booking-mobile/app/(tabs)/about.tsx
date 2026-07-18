import { StyleSheet, Text, View, TouchableOpacity, Linking } from "react-native";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useQuery } from "@tanstack/react-query";

import { useColors } from "@/hooks/useColors";
import { useApi } from "@/hooks/useApi";
import {
  Screen,
  SectionLabel,
  Card,
  IconTile,
  spacing,
  radii,
  type FeatherIconName,
} from "@/components/ui";

export default function AboutScreen() {
  const colors = useColors();
  const api = useApi();

  const { data: config } = useQuery({
    queryKey: ["booking-config"],
    queryFn: () => api.get("/api/public/booking/config"),
  });

  const clinic = config || {};

  return (
    <Screen>
      <LinearGradient
        colors={["#0f766e", "#115e59"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.hero}
      >
        <View style={styles.heroLogo}>
          <Feather name="activity" size={28} color="#ffffff" />
        </View>
        <Text style={styles.heroTitle}>Care Diagnostics</Text>
        <Text style={styles.heroSub}>Subhash Chowk, Castair's Town, Deoghar</Text>
      </LinearGradient>

      <SectionLabel style={{ marginTop: spacing.section }}>About Us</SectionLabel>
      <Card>
        <Text style={[styles.para, { color: colors.mutedForeground }]}>
          Care Diagnostics is a state-of-the-art diagnostic center located in the heart of Deoghar. We offer comprehensive pathology, radiology, and imaging services with accurate results and quick turnaround times. Our mission is to make quality healthcare accessible to every patient.
        </Text>
      </Card>

      <SectionLabel style={{ marginTop: spacing.xxl }}>Services Offered</SectionLabel>
      <Card>
        <ServiceItem icon="droplet" label="Pathology & Blood Tests" />
        <ServiceItem icon="camera" label="Digital X-Ray" />
        <ServiceItem icon="monitor" label="Ultrasound (USG)" />
        <ServiceItem icon="cpu" label="CT Scan & MRI" />
        <ServiceItem icon="heart" label="ECG & Cardiology" />
        <ServiceItem icon="file-text" label="Health Packages" last />
      </Card>

      <SectionLabel style={{ marginTop: spacing.xxl }}>Contact</SectionLabel>
      <Card>
        <ContactRow
          icon="phone"
          label="Phone"
          value={clinic.phone || "9973497200"}
          onPress={() => Linking.openURL(`tel:${clinic.phone || "9973497200"}`)}
        />
        <ContactRow
          icon="map-pin"
          label="Address"
          value="CARE DIAGNOSTICS, Subhash Chowk, Castair's Town, Near Bajla Mahila College, Deoghar–814112"
        />
        <ContactRow
          icon="clock"
          label="Timings"
          value="Mon-Sat: 7:00 AM - 7:00 PM | Sun: 8:00 AM - 2:00 PM"
        />
        <ContactRow
          icon="mail"
          label="Email"
          value={clinic.email || "CARE.DEOGHAR@GMAIL.COM"}
          onPress={() => Linking.openURL(`mailto:${clinic.email || "CARE.DEOGHAR@GMAIL.COM"}`)}
          last
        />
      </Card>

      <SectionLabel style={{ marginTop: spacing.xxl }}>Why Choose Us</SectionLabel>
      <Card>
        <WhyItem text="NABL Accredited Lab" />
        <WhyItem text="Same-Day Reports" />
        <WhyItem text="Home Sample Collection" />
        <WhyItem text="Online Booking & Payment" last />
      </Card>
    </Screen>
  );
}

function ServiceItem({ icon, label, last = false }: { icon: FeatherIconName; label: string; last?: boolean }) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.serviceRow,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
      ]}
    >
      <IconTile icon={icon} color={colors.primary} size={36} />
      <Text style={[styles.serviceText, { color: colors.foreground }]}>{label}</Text>
    </View>
  );
}

function ContactRow({
  icon,
  label,
  value,
  onPress,
  last = false,
}: {
  icon: FeatherIconName;
  label: string;
  value: string;
  onPress?: () => void;
  last?: boolean;
}) {
  const colors = useColors();
  return (
    <TouchableOpacity
      style={[
        styles.contactRow,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
      ]}
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={0.7}
    >
      <IconTile icon={icon} color={colors.accent} size={36} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.contactLabel, { color: colors.mutedForeground }]}>{label}</Text>
        <Text style={[styles.contactValue, { color: colors.foreground }]}>{value}</Text>
      </View>
      {onPress && <Feather name="chevron-right" size={16} color={colors.mutedForeground} />}
    </TouchableOpacity>
  );
}

function WhyItem({ text, last = false }: { text: string; last?: boolean }) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.whyRow,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
      ]}
    >
      <Feather name="check-circle" size={17} color={colors.success} />
      <Text style={[styles.whyText, { color: colors.foreground }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    borderRadius: 20,
    paddingVertical: spacing.section,
    paddingHorizontal: spacing.xxl,
    alignItems: "center",
  },
  heroLogo: {
    width: 56,
    height: 56,
    borderRadius: radii.card,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.16)",
    marginBottom: spacing.md,
  },
  heroTitle: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
    color: "#ffffff",
  },
  heroSub: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
    color: "rgba(255,255,255,0.8)",
    marginTop: spacing.xs,
    textAlign: "center",
  },
  para: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 22 },
  serviceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  serviceText: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium", lineHeight: 20 },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 44,
  },
  contactLabel: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    letterSpacing: 0.2,
  },
  contactValue: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
    marginTop: 2,
  },
  whyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md - 2,
  },
  whyText: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
});
