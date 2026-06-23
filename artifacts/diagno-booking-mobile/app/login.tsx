import { useState } from "react";
import {
  StyleSheet, Text, View, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";

import { useColors } from "@/hooks/useColors";
import { useApi } from "@/hooks/useApi";

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
        contentContainerStyle={{
          paddingTop: Platform.OS === "web" ? 80 : insets.top + 30,
          paddingHorizontal: 24,
          flexGrow: 1,
          justifyContent: "center",
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.iconWrap, { backgroundColor: colors.primary + "12" }]}>
          <Feather name="activity" size={32} color={colors.primary} />
        </View>
        <Text style={[styles.brand, { color: colors.foreground }]}>Care Diagnostics</Text>
        <Text style={[styles.sub, { color: colors.mutedForeground }]}>
          {step === "phone" ? "Enter your mobile number to continue" : `Enter OTP sent to +91 ${phone}`}
        </Text>

        {error ? (
          <View style={[styles.errorBox, { backgroundColor: colors.destructive + "12", borderColor: colors.destructive + "40" }]}>
            <Feather name="alert-circle" size={14} color={colors.destructive} />
            <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
          </View>
        ) : null}

        {step === "phone" ? (
          <>
            <View style={[styles.inputBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.prefix, { color: colors.mutedForeground }]}>+91</Text>
              <TextInput
                style={[styles.input, { color: colors.foreground }]} placeholder="Mobile number"
                placeholderTextColor={colors.mutedForeground} keyboardType="phone-pad" maxLength={10}
                value={phone} onChangeText={(t) => setPhone(t.replace(/[^0-9]/g, ""))}
              />
            </View>

            <View style={[styles.inputBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="user" size={16} color={colors.mutedForeground} />
              <TextInput
                style={[styles.input, { color: colors.foreground }]} placeholder="Your name"
                placeholderTextColor={colors.mutedForeground} value={name} onChangeText={setName}
              />
            </View>

            <TouchableOpacity
              style={[styles.btn, { backgroundColor: colors.primary, opacity: phone.length === 10 && name.trim() ? 1 : 0.4 }]}
              disabled={phone.length !== 10 || !name.trim() || loading}
              onPress={sendOtp}
            >
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Send OTP</Text>}
            </TouchableOpacity>
          </>
        ) : (
          <>
            <View style={[styles.inputBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <TextInput
                style={[styles.input, { color: colors.foreground }]} placeholder="Enter 6-digit OTP"
                placeholderTextColor={colors.mutedForeground} keyboardType="number-pad" maxLength={6}
                value={otp} onChangeText={setOtp}
              />
            </View>

            <TouchableOpacity
              style={[styles.btn, { backgroundColor: colors.primary, opacity: otp.length === 6 ? 1 : 0.4 }]}
              disabled={otp.length !== 6 || loading}
              onPress={verifyOtp}
            >
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Verify & Login</Text>}
            </TouchableOpacity>

            <TouchableOpacity style={styles.resendBtn} onPress={sendOtp} disabled={loading}>
              <Text style={[styles.resendText, { color: colors.primary }]}>Resend OTP</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  iconWrap: {
    width: 64, height: 64, borderRadius: 16,
    alignItems: "center", justifyContent: "center", alignSelf: "center", marginBottom: 16,
  },
  brand: { fontSize: 24, fontFamily: "Inter_700Bold", textAlign: "center" },
  sub: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 6, marginBottom: 24 },
  errorBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    borderRadius: 10, borderWidth: 1, padding: 10, marginBottom: 14,
  },
  errorText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular" },
  inputBox: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10,
    marginBottom: 14,
  },
  prefix: { fontSize: 15, fontFamily: "Inter_500Medium" },
  input: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  btn: { borderRadius: 14, paddingVertical: 14, alignItems: "center", marginTop: 4 },
  btnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
  resendBtn: { marginTop: 16, alignSelf: "center" },
  resendText: { fontSize: 14, fontFamily: "Inter_500Medium" },
});
