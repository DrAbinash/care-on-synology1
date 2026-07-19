import React, { useEffect } from "react";
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  ScrollView,
  RefreshControlProps,
  ViewStyle,
  TextStyle,
  StyleProp,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
} from "react-native-reanimated";

import { useColors } from "@/hooks/useColors";

/**
 * Shared design kit for the booking app.
 *
 * Every screen composes these primitives instead of hand-rolling cards,
 * buttons, headers and loading states, so spacing, radii, type scale and
 * elevation stay identical across the whole app in both light and dark mode.
 */

// ── Scale ────────────────────────────────────────────────────────────────────

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  section: 28,
} as const;

export const radii = {
  card: 16,
  button: 14,
  chip: 999,
  icon: 12,
} as const;

export type FeatherIconName = React.ComponentProps<typeof Feather>["name"];

// Soft cross-platform elevation for cards. Kept subtle on purpose — clinical
// software should feel calm, not glossy.
export function cardShadow(shadowColor: string): ViewStyle {
  return Platform.select<ViewStyle>({
    android: { elevation: 2 },
    default: {
      shadowColor,
      shadowOpacity: 0.06,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
    },
  }) as ViewStyle;
}

// ── Screen scaffold ──────────────────────────────────────────────────────────

/**
 * Scrollable screen container with the app's standard top inset (handles the
 * web preview's fixed banner offset) and horizontal padding.
 */
export function Screen({
  children,
  scroll = true,
  padded = true,
  style,
  contentStyle,
  refreshControl,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  refreshControl?: React.ReactElement<RefreshControlProps>;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top + spacing.lg;

  if (!scroll) {
    return (
      <View style={[{ flex: 1, backgroundColor: colors.background, paddingTop: topPad }, style]}>
        <View style={[padded && { paddingHorizontal: spacing.xl }, { flex: 1 }, contentStyle]}>{children}</View>
      </View>
    );
  }
  return (
    <ScrollView
      style={[{ flex: 1, backgroundColor: colors.background }, style]}
      contentContainerStyle={[
        { paddingTop: topPad, paddingBottom: 110 },
        padded && { paddingHorizontal: spacing.xl },
        contentStyle,
      ]}
      refreshControl={refreshControl}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

/** Large screen title with optional subtitle and a right-side accessory. */
export function ScreenHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <View style={styles.headerRow}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>{title}</Text>
        {subtitle ? (
          <Text style={[styles.headerSubtitle, { color: colors.mutedForeground }]}>{subtitle}</Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

/** Back-navigation row for stack screens. */
export function BackBar({ label = "Back", onPress }: { label?: string; onPress?: () => void }) {
  const colors = useColors();
  const router = useRouter();
  return (
    <TouchableOpacity
      style={styles.backBar}
      onPress={onPress ?? (() => router.back())}
      hitSlop={8}
      activeOpacity={0.6}
    >
      <Feather name="arrow-left" size={20} color={colors.foreground} />
      <Text style={[styles.backText, { color: colors.foreground }]}>{label}</Text>
    </TouchableOpacity>
  );
}

/** Uppercase section label used between card groups. */
export function SectionLabel({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  const colors = useColors();
  return <Text style={[styles.sectionLabel, { color: colors.mutedForeground }, style]}>{children}</Text>;
}

// ── Surfaces ─────────────────────────────────────────────────────────────────

export function Card({
  children,
  style,
  onPress,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
}) {
  const colors = useColors();
  const base: StyleProp<ViewStyle> = [
    styles.card,
    { backgroundColor: colors.card, borderColor: colors.border },
    cardShadow(colors.shadow),
    style,
  ];
  if (onPress) {
    return (
      <TouchableOpacity style={base} onPress={onPress} activeOpacity={0.7}>
        {children}
      </TouchableOpacity>
    );
  }
  return <View style={base}>{children}</View>;
}

/** Squircle icon tile used at the start of list rows and feature cards. */
export function IconTile({
  icon,
  color,
  size = 40,
  backgroundColor,
}: {
  icon: FeatherIconName;
  color: string;
  size?: number;
  backgroundColor?: string;
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.3,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: backgroundColor ?? color + "14",
      }}
    >
      <Feather name={icon} size={size * 0.45} color={color} />
    </View>
  );
}

// ── Controls ─────────────────────────────────────────────────────────────────

type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";

export function AppButton({
  label,
  onPress,
  variant = "primary",
  icon,
  iconRight,
  loading = false,
  disabled = false,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: FeatherIconName;
  iconRight?: FeatherIconName;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();
  const palette: Record<ButtonVariant, { bg: string; fg: string; border?: string }> = {
    primary: { bg: colors.primary, fg: colors.primaryForeground },
    secondary: { bg: colors.card, fg: colors.foreground, border: colors.border },
    ghost: { bg: "transparent", fg: colors.primary },
    destructive: { bg: colors.destructive, fg: colors.destructiveForeground },
  };
  const p = palette[variant];
  const isBlocked = disabled || loading;

  return (
    <TouchableOpacity
      style={[
        styles.button,
        { backgroundColor: p.bg, opacity: isBlocked ? 0.5 : 1 },
        p.border ? { borderWidth: 1, borderColor: p.border } : null,
        style,
      ]}
      onPress={onPress}
      disabled={isBlocked}
      activeOpacity={0.8}
    >
      {loading ? (
        <ActivityIndicator color={p.fg} />
      ) : (
        <>
          {icon ? <Feather name={icon} size={17} color={p.fg} /> : null}
          <Text style={[styles.buttonLabel, { color: p.fg }]}>{label}</Text>
          {iconRight ? <Feather name={iconRight} size={17} color={p.fg} /> : null}
        </>
      )}
    </TouchableOpacity>
  );
}

type BadgeTone = "success" | "warning" | "destructive" | "accent" | "muted" | "primary";

export function Badge({
  label,
  tone = "muted",
  icon,
}: {
  label: string;
  tone?: BadgeTone;
  icon?: FeatherIconName;
}) {
  const colors = useColors();
  const toneColor: Record<BadgeTone, string> = {
    success: colors.success,
    warning: colors.warning,
    destructive: colors.destructive,
    accent: colors.accent,
    primary: colors.primary,
    muted: colors.mutedForeground,
  };
  const c = toneColor[tone];
  return (
    <View style={[styles.badge, { backgroundColor: c + "16" }]}>
      {icon ? <Feather name={icon} size={11} color={c} /> : null}
      <Text style={[styles.badgeText, { color: c }]}>{label}</Text>
    </View>
  );
}

// ── States ───────────────────────────────────────────────────────────────────

/** Animated pulsing placeholder block shown while content loads. */
export function Skeleton({ height = 90, style }: { height?: number; style?: StyleProp<ViewStyle> }) {
  const colors = useColors();
  const pulse = useSharedValue(0.45);

  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(withTiming(0.9, { duration: 700 }), withTiming(0.45, { duration: 700 })),
      -1,
    );
  }, [pulse]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View
      style={[
        { height, borderRadius: radii.card, backgroundColor: colors.muted },
        animatedStyle,
        style,
      ]}
    />
  );
}

/** Standard skeleton list: N pulsing cards with the app's list rhythm. */
export function SkeletonList({ count = 3, height = 96 }: { count?: number; height?: number }) {
  return (
    <View style={{ gap: spacing.md }}>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} height={height} />
      ))}
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  message,
  actionLabel,
  onAction,
}: {
  icon: FeatherIconName;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const colors = useColors();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.muted }]}>
        <Feather name={icon} size={28} color={colors.mutedForeground} />
      </View>
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>{title}</Text>
      {message ? <Text style={[styles.emptyMessage, { color: colors.mutedForeground }]}>{message}</Text> : null}
      {actionLabel && onAction ? (
        <AppButton label={actionLabel} onPress={onAction} style={{ marginTop: spacing.xl, alignSelf: "center", paddingHorizontal: spacing.section }} />
      ) : null}
    </View>
  );
}

/** Inline alert strip for warnings/errors inside a screen. */
export function InlineAlert({
  tone,
  message,
}: {
  tone: "warning" | "destructive" | "success";
  message: string;
}) {
  const colors = useColors();
  const c = tone === "warning" ? colors.warning : tone === "destructive" ? colors.destructive : colors.success;
  const icon: FeatherIconName = tone === "success" ? "check-circle" : "alert-triangle";
  return (
    <View style={[styles.alert, { backgroundColor: c + "12", borderColor: c + "36" }]}>
      <Feather name={icon} size={15} color={c} style={{ marginTop: 1 }} />
      <Text style={[styles.alertText, { color: c }]}>{message}</Text>
    </View>
  );
}

/** Label/value pair used on detail screens. */
export function DetailRow({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  const colors = useColors();
  return (
    <View style={[styles.detailRow, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
      <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.detailValue, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.xl,
  },
  headerTitle: { fontSize: 26, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  headerSubtitle: { fontSize: 14, fontFamily: "Inter_400Regular", marginTop: 3, lineHeight: 20 },
  backBar: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: spacing.lg, alignSelf: "flex-start" },
  backText: { fontSize: 15, fontFamily: "Inter_500Medium" },
  sectionLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.9,
    marginBottom: spacing.md,
    marginTop: spacing.sm,
  },
  card: {
    borderRadius: radii.card,
    borderWidth: 1,
    padding: spacing.lg,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderRadius: radii.button,
    paddingVertical: 15,
    paddingHorizontal: spacing.xl,
  },
  buttonLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    borderRadius: radii.chip,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  badgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.2 },
  empty: { alignItems: "center", paddingVertical: 56, paddingHorizontal: spacing.section },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  emptyTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  emptyMessage: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 6, lineHeight: 20 },
  alert: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "flex-start",
    borderRadius: radii.icon,
    borderWidth: 1,
    padding: spacing.md,
  },
  alertText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", lineHeight: 18 },
  detailRow: { paddingVertical: spacing.md },
  detailLabel: { fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 3, letterSpacing: 0.2 },
  detailValue: { fontSize: 15, fontFamily: "Inter_600SemiBold", lineHeight: 21 },
});
