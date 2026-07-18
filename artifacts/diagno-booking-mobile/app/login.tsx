import { useState } from "react";
import {
  StyleSheet, Text, View, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";

import { useColors } from "@/hooks/useColors";
import { useApi } from "@/hooks/useApi";
import { Card, AppButton, InlineAlert, spacing } from "@/components/ui";

export default function LoginScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();

  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const sendOtp = async () => {
    setError("");
    if (!/^\d{10}$/.test(phone)) { setError("Enter a valid 10-digit phone number"); return; }
    setLoading(true);
    try {
      await api.post("/api/public/booking/send-otp", { phone, name });
      setStep("otp");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      setError(e?.message || "Failed to send OTP");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async () => {
    setError("");
    if (!/^\d{6}$/.test(otp)) { setError("Enter the 6-digit OTP"); return; }
    setLoading(true);
    try {
      await api.post("/api/public/booking/verify-otp", { phone, code: otp, name });
      router.replace("/");
    } catch (e: any) {
      setError(e?.message || "Invalid OTP");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <LinearGradient
          colors={["#0f766e", "#115e59"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.hero, { paddingTop: Platform.OS === "web" ? 80 : insets.top + 32 }]}
        >
          <View style={styles.logoTile}>
            <Feather name="activity" size={30} color="#fff" />
          </View>
          <Text style={styles.brand}>Care Diagnostics</Text>
          <Text style={styles.heroSub}>Patient login</Text>
        </LinearGradient>

        <Card style={styles.formCard}>
          <Text style={[styles.formTitle, { color: colors.foreground }]}>
            {step === "phone" ? "Sign in with your mobile number" : "Verify OTP"}
          </Text>
          <Text style={[styles.formSub, { color: colors.mutedForeground }]}>
            {step === "phone"
              ? "We'll send a one-time password to confirm it's you"
              : `Enter the OTP sent to +91 ${phone}`}
          </Text>

          {error ? (
            <View style={{ marginBottom: spacing.md }}>
              <InlineAlert tone="destructive" message={error} />
            </View>
          ) : null}

          {step === "phone" ? (
            <>
              <View style={[styles.inputBox, { backgroundColor: colors.background, borderColor: colors.input }]}>
                <Text style={[styles.prefix, { color: colors.mutedForeground }]}>+91</Text>
                <TextInput
                  style={[styles.input, { color: colors.foreground }]} placeholder="Mobile number"
                  placeholderTextColor={colors.mutedForeground} keyboardType="phone-pad" maxLength={10}
                  value={phone} onChangeText={(t) => setPhone(t.replace(/[^0-9]/g, ""))}
                />
              </View>

              <View style={[styles.inputBox, { backgroundColor: colors.background, borderColor: colors.input }]}>
                <Feather name="user" size={16} color={colors.mutedForeground} />
                <TextInput
                  style={[styles.input, { color: colors.foreground }]} placeholder="Your name"
                  placeholderTextColor={colors.mutedForeground} value={name} onChangeText={setName}
                />
              </View>

              <AppButton
                label="Send OTP"
                icon="message-circle"
                onPress={sendOtp}
                loading={loading}
                disabled={phone.length !== 10 || !name.trim()}
                style={{ marginTop: spacing.xs }}
              />
            </>
          ) : (
            <>
              <View style={[styles.inputBox, { backgroundColor: colors.background, borderColor: colors.input }]}>
                <Feather name="key" size={16} color={colors.mutedForeground} />
                <TextInput
                  style={[styles.input, { color: colors.foreground }]} placeholder="Enter 6-digit OTP"
                  placeholderTextColor={colors.mutedForeground} keyboardType="number-pad" maxLength={6}
                  value={otp} onChangeText={setOtp}
                />
              </View>

              <AppButton
                label="Verify & Login"
                icon="check"
                onPress={verifyOtp}
                loading={loading}
                disabled={otp.length !== 6}
                style={{ marginTop: spacing.xs }}
              />

              <TouchableOpacity style={styles.resendBtn} onPress={sendOtp} disabled={loading} hitSlop={8}>
                <Text style={[styles.resendText, { color: colors.primary }]}>Resend OTP</Text>
              </TouchableOpacity>
            </>
          )}
        </Card>

        <Text style={[styles.footerNote, { color: colors.mutedForeground }]}>
          The one-time password is delivered by SMS to your mobile number and expires shortly after it is sent.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  hero: {
    paddingHorizontal: spacing.xxl,
    paddingBottom: 52,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    alignItems: "center",
  },
  logoTile: {
    width: 60, height: 60, borderRadius: 18,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "#ffffff26",
    marginBottom: spacing.lg,
  },
  brand: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff", letterSpacing: -0.4, textAlign: "center" },
  heroSub: { fontSize: 14, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.8)", marginTop: 4, textAlign: "center" },
  formCard: {
    marginTop: -28,
    marginHorizontal: spacing.xl,
    padding: spacing.xl,
  },
  formTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  formSub: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20, marginTop: 3, marginBottom: spacing.lg },
  inputBox: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, height: 46,
    marginBottom: spacing.md,
  },
  prefix: { fontSize: 15, fontFamily: "Inter_500Medium" },
  input: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular", height: "100%" },
  resendBtn: { marginTop: spacing.lg, alignSelf: "center", minHeight: 44, justifyContent: "center" },
  resendText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  footerNote: {
    fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18,
    textAlign: "center", marginTop: spacing.xl, marginHorizontal: spacing.section,
  },
});
