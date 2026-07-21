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
import { useStaffAuth } from "@/context/StaffAuthContext";
import { Card, AppButton, Badge, InlineAlert, spacing } from "@/components/ui";

export default function StaffLoginScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { login } = useStaffAuth();

  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const doLogin = async () => {
    setError("");
    if (!username.trim() || !pin.trim()) { setError("Username and PIN required"); return; }
    setLoading(true);
    try {
      await login(username.trim(), pin.trim());
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace("/");
    } catch (e: any) {
      setError(e?.message || "Login failed");
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
            <Feather name="shield" size={30} color="#fff" />
          </View>
          <Text style={styles.brand}>Staff Portal</Text>
          <Text style={styles.heroSub}>Care Diagnostics</Text>
        </LinearGradient>

        <Card style={styles.formCard}>
          <View style={{ alignItems: "flex-start", marginBottom: spacing.md }}>
            <Badge label="For clinic staff only" tone="muted" icon="lock" />
          </View>
          <Text style={[styles.formTitle, { color: colors.foreground }]}>Sign in</Text>
          <Text style={[styles.formSub, { color: colors.mutedForeground }]}>
            Sign in with your staff username and PIN
          </Text>

          {error ? (
            <View style={{ marginBottom: spacing.md }}>
              <InlineAlert tone="destructive" message={error} />
            </View>
          ) : null}

          <View style={[styles.inputBox, { backgroundColor: colors.background, borderColor: colors.input }]}>
            <Feather name="user" size={16} color={colors.mutedForeground} />
            <TextInput
              style={[styles.input, { color: colors.foreground }]}
              placeholder="Username or email"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              value={username}
              onChangeText={setUsername}
            />
          </View>

          <View style={[styles.inputBox, { backgroundColor: colors.background, borderColor: colors.input }]}>
            <Feather name="lock" size={16} color={colors.mutedForeground} />
            <TextInput
              style={[styles.input, { color: colors.foreground }]}
              placeholder="PIN"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={8}
              value={pin}
              onChangeText={setPin}
              onSubmitEditing={doLogin}
            />
          </View>

          <AppButton
            label="Sign In"
            icon="log-in"
            onPress={doLogin}
            loading={loading}
            style={{ marginTop: spacing.xs }}
          />
        </Card>

        <TouchableOpacity onPress={() => router.replace("/login")} style={styles.switchBtn} hitSlop={8}>
          <Text style={[styles.switchText, { color: colors.primary }]}>
            I am a patient → Patient Login
          </Text>
        </TouchableOpacity>
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
  input: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular", height: "100%" },
  switchBtn: { marginTop: spacing.xl, alignSelf: "center", minHeight: 44, justifyContent: "center" },
  switchText: { fontSize: 14, fontFamily: "Inter_500Medium" },
});
