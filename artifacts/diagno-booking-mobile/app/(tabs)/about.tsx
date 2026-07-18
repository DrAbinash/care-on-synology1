import { StyleSheet, Text, View, TouchableOpacity, Linking } from "react-native";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useQuery } from "@tanstack/react-query";

import { useColors } from "@/hooks/useColors";
import { useMobileConfig } from "@/hooks/useMobileConfig";
import {
  Screen,
  SectionLabel,
  Card,
  IconTile,
  spacing,
  radii,
  type FeatherIconName,
} from "@/components/ui";

const DEFAULT_ABOUT =
  "Care Diagnostics is a state-of-the-art diagnostic center located in the heart of Deoghar. We offer comprehensive pathology, radiology, and imaging services with accurate results and quick turnaround times. Our mission is to make quality healthcare accessible to every patient.";

export default function AboutScreen() {
  const colors = useColors();
  // Admin-curated content (Settings → Mobile App); falls back to built-ins.
  const { clinic, config: appCfg } = useMobileConfig();

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
        <Text style={styles.heroTitle}>{clinic.name}</Text>
        <Text style={styles.heroSub}>{clinic.tagline || clinic.address}</Text>
      </LinearGradient>

      <SectionLabel style={{ marginTop: spacing.section }}>About Us</SectionLabel>
      <Card>
        <Text style={[styles.para, { color: colors.mutedForeground }]}>
          {appCfg.aboutText || DEFAULT_ABOUT}
        </Text>
      </Card>

      <SectionLabel style={{ marginTop: spacing.xxl }}>Services Offered</SectionLabel>
      <Card>
        {appCfg.services.map((s, i) => (
          <ServiceItem
            key={s.label}
            icon={s.icon as FeatherIconName}
            label={s.label}
            last={i === appCfg.services.length - 1}
          />
        ))}
      </Card>

      <SectionLabel style={{ marginTop: spacing.xxl }}>Contact</SectionLabel>
      <Card>
        <ContactRow
          icon="phone"
          label="Phone"
          value={clinic.phone}
          onPress={() => Linking.openURL(`tel:${clinic.phone}`)}
        />
        {appCfg.whatsappNumber ? (
          <ContactRow
            icon="message-circle"
            label="WhatsApp"
            value={appCfg.whatsappNumber}
            onPress={() => Linking.openURL(`https://wa.me/${appCfg.whatsappNumber.replace(/[^0-9]/g, "")}`)}
          />
        ) : null}
        {appCfg.emergencyPhone ? (
          <ContactRow
            icon="alert-circle"
            label="Emergency"
            value={appCfg.emergencyPhone}
            onPress={() => Linking.openURL(`tel:${appCfg.emergencyPhone}`)}
          />
        ) : null}
        <ContactRow icon="map-pin" label="Address" value={clinic.address} />
        <ContactRow icon="clock" label="Timings" value={appCfg.timings} />
        <ContactRow
          icon="mail"
          label="Email"
          value={clinic.email}
          onPress={() => Linking.openURL(`mailto:${clinic.email}`)}
          last
        />
      </Card>

      <SectionLabel style={{ marginTop: spacing.xxl }}>Why Choose Us</SectionLabel>
      <Card>
        {appCfg.trustChips.map((chip, i) => (
          <WhyItem key={chip} text={chip} last={i === appCfg.trustChips.length - 1} />
        ))}
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
