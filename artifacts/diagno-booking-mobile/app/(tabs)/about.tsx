import { StyleSheet, Text, View, ScrollView, TouchableOpacity, Linking, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";

import { useColors } from "@/hooks/useColors";
import { useApi } from "@/hooks/useApi";

export default function AboutScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const api = useApi();

  const { data: config } = useQuery({
    queryKey: ["booking-config"],
    queryFn: () => api.get("/api/public/booking/config"),
  });

  const clinic = config || {};

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={{ paddingTop: Platform.OS === "web" ? 67 : insets.top + 16, paddingHorizontal: 16, paddingBottom: 40 }}>
        <View style={[styles.hero, { backgroundColor: colors.primary }]}>
          <Feather name="activity" size={36} color="#fff" />
          <Text style={styles.heroTitle}>Care Diagnostics</Text>
          <Text style={styles.heroSub}>Subhash Chowk, Castair's Town, Deoghar</Text>
        </View>

        <Section title="About Us" colors={colors}>
          <Text style={[styles.para, { color: colors.mutedForeground }]}>
            Care Diagnostics is a state-of-the-art diagnostic center located in the heart of Deoghar. We offer comprehensive pathology, radiology, and imaging services with accurate results and quick turnaround times. Our mission is to make quality healthcare accessible to every patient.
          </Text>
        </Section>

        <Section title="Services Offered" colors={colors}>
          <ServiceItem icon="droplet" label="Pathology & Blood Tests" colors={colors} />
          <ServiceItem icon="camera" label="Digital X-Ray" colors={colors} />
          <ServiceItem icon="monitor" label="Ultrasound (USG)" colors={colors} />
          <ServiceItem icon="cpu" label="CT Scan & MRI" colors={colors} />
          <ServiceItem icon="heart" label="ECG & Cardiology" colors={colors} />
          <ServiceItem icon="file-text" label="Health Packages" colors={colors} />
        </Section>

        <Section title="Contact" colors={colors}>
          <ContactRow icon="phone" label="Phone" value={clinic.phone || "9973497200"} colors={colors} onPress={() => Linking.openURL(`tel:${clinic.phone || "9973497200"}`)} />
          <ContactRow icon="map-pin" label="Address" value="CARE DIAGNOSTICS, Subhash Chowk, Castair's Town, Near Bajla Mahila College, Deoghar\u2013814112" colors={colors} />
          <ContactRow icon="clock" label="Timings" value="Mon-Sat: 7:00 AM - 7:00 PM | Sun: 8:00 AM - 2:00 PM" colors={colors} />
          <ContactRow icon="mail" label="Email" value={clinic.email || "CARE.DEOGHAR@GMAIL.COM"} colors={colors} onPress={() => Linking.openURL(`mailto:${clinic.email || "CARE.DEOGHAR@GMAIL.COM"}`)} />
        </Section>

        <Section title="Why Choose Us" colors={colors}>
          <WhyItem icon="check-circle" text="NABL Accredited Lab" colors={colors} />
          <WhyItem icon="check-circle" text="Same-Day Reports" colors={colors} />
          <WhyItem icon="check-circle" text="Home Sample Collection" colors={colors} />
          <WhyItem icon="check-circle" text="Online Booking & Payment" colors={colors} />
        </Section>
      </View>
    </ScrollView>
  );
}

function Section({ title, children, colors }: { title: string; children: React.ReactNode; colors: any }) {
  return (
    <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{title}</Text>
      {children}
    </View>
  );
}

function ServiceItem({ icon, label, colors }: { icon: any; label: string; colors: any }) {
  return (
    <View style={styles.serviceRow}>
      <View style={[styles.serviceIcon, { backgroundColor: colors.primary + "12" }]}>
        <Feather name={icon} size={16} color={colors.primary} />
      </View>
      <Text style={[styles.serviceText, { color: colors.foreground }]}>{label}</Text>
    </View>
  );
}

function ContactRow({ icon, label, value, colors, onPress }: { icon: any; label: string; value: string; colors: any; onPress?: () => void }) {
  return (
    <TouchableOpacity style={styles.contactRow} onPress={onPress} disabled={!onPress} activeOpacity={0.7}>
      <View style={[styles.contactIcon, { backgroundColor: colors.accent + "12" }]}>
        <Feather name={icon} size={16} color={colors.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.contactLabel, { color: colors.mutedForeground }]}>{label}</Text>
        <Text style={[styles.contactValue, { color: colors.foreground }]}>{value}</Text>
      </View>
      {onPress && <Feather name="chevron-right" size={16} color={colors.mutedForeground} />}
    </TouchableOpacity>
  );
}

function WhyItem({ icon, text, colors }: { icon: any; text: string; colors: any }) {
  return (
    <View style={styles.whyRow}>
      <Feather name={icon} size={16} color={colors.success} />
      <Text style={[styles.whyText, { color: colors.foreground }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  hero: { borderRadius: 18, padding: 24, alignItems: "center", marginBottom: 16 },
  heroTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff", marginTop: 12 },
  heroSub: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#ffffffbb", marginTop: 4 },
  section: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", marginBottom: 12 },
  para: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 22 },
  serviceRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#00000008" },
  serviceIcon: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  serviceText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  contactRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#00000008" },
  contactIcon: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  contactLabel: { fontSize: 11, fontFamily: "Inter_500Medium" },
  contactValue: { fontSize: 14, fontFamily: "Inter_400Regular", marginTop: 1 },
  whyRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
  whyText: { fontSize: 14, fontFamily: "Inter_400Regular" },
});
