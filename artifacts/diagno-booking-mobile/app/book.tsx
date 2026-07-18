import {
  StyleSheet, Text, View, ScrollView, TouchableOpacity, TextInput, Platform,
  KeyboardAvoidingView, Linking,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useState, useMemo, useCallback } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import Animated, { FadeIn } from "react-native-reanimated";
import * as Haptics from "expo-haptics";

import { useColors } from "@/hooks/useColors";
import { useApi } from "@/hooks/useApi";
import PaymentWebView, { PaymentResult, RazorpayPaymentPayload } from "@/components/PaymentWebView";
import {
  AppButton,
  BackBar,
  Card,
  EmptyState,
  IconTile,
  InlineAlert,
  Screen,
  ScreenHeader,
  SectionLabel,
  SkeletonList,
  cardShadow,
  radii,
  spacing,
  type FeatherIconName,
} from "@/components/ui";

type PendingPayment =
  | { mode: "url"; url: string }
  | { mode: "post"; url: string; fields: Record<string, string> }
  | {
      mode: "razorpay";
      razorpay: {
        keyId: string;
        amountPaise: number;
        orderId: string;
        name: string;
        description: string;
        prefillName: string;
        prefillPhone: string;
        prefillEmail: string;
        bookingRef: string;
      };
    };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Next `count` days as { value: "YYYY-MM-DD", label: "Today" | "Tomorrow" | "Mon 21" }. */
function nextDates(count: number) {
  const out: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const label = i === 0 ? "Today" : i === 1 ? "Tomorrow" : `${WEEKDAYS[d.getDay()]} ${d.getDate()}`;
    out.push({ value, label });
  }
  return out;
}

const STEPS: { key: "tests" | "details" | "pay"; label: string }[] = [
  { key: "tests", label: "Tests" },
  { key: "details", label: "Details" },
  { key: "pay", label: "Pay" },
];

export default function BookScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();

  const [step, setStep] = useState<"tests" | "details" | "pay" | "done">("tests");
  const [selTests, setSelTests] = useState<Set<number>>(new Set());
  const [selPkgs, setSelPkgs] = useState<Set<number>>(new Set());
  const [catFilter, setCatFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [patient, setPatient] = useState({ name: "", phone: "", email: "", date: "", timeSlot: "", notes: "" });
  const [successRef, setSuccessRef] = useState("");
  const [pendingPayment, setPendingPayment] = useState<PendingPayment | null>(null);
  const [payError, setPayError] = useState("");

  const { data: catalog, isLoading } = useQuery({
    queryKey: ["booking-catalog"],
    queryFn: async () => {
      const [tests, pkgs, config] = await Promise.all([
        api.get("/api/public/booking/tests"),
        api.get("/api/public/booking/packages"),
        api.get("/api/public/booking/config"),
      ]);
      return { tests: tests.tests ?? [], packages: pkgs.packages ?? [], config };
    },
  });

  const tests: any[] = catalog?.tests ?? [];
  const packages: any[] = catalog?.packages ?? [];
  const config = catalog?.config;
  const enabled = config?.enabled ?? false;

  const categories = useMemo(() => ["all", ...Array.from(new Set(tests.map((t) => t.category))).sort()], [tests]);

  const filteredTests = useMemo(() => {
    let list = catFilter === "all" ? tests : tests.filter((t) => t.category === catFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((t) =>
        (t.name || "").toLowerCase().includes(q) ||
        (t.code || "").toLowerCase().includes(q) ||
        (t.category || "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [tests, catFilter, search]);

  const filteredPkgs = useMemo(() => {
    if (!search.trim()) return packages;
    const q = search.toLowerCase();
    return packages.filter((p) => (p.name || "").toLowerCase().includes(q));
  }, [packages, search]);

  const total = useMemo(() => {
    const t = tests.filter((t) => selTests.has(t.id)).reduce((s, t) => s + Number(t.price), 0);
    const p = packages.filter((p) => selPkgs.has(p.id)).reduce((s, p) => s + Number(p.price), 0);
    return t + p;
  }, [tests, packages, selTests, selPkgs]);

  const toggleTest = useCallback((id: number) => {
    setSelTests((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const togglePkg = useCallback((id: number) => {
    setSelPkgs((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const timeSlots = ["07:00 AM", "08:00 AM", "09:00 AM", "10:00 AM", "11:00 AM", "12:00 PM", "01:00 PM", "02:00 PM", "03:00 PM", "04:00 PM", "05:00 PM"];
  const dateOptions = useMemo(() => nextDates(14), []);

  const bookMutation = useMutation({
    mutationFn: async (): Promise<PendingPayment> => {
      const body = {
        name: patient.name,
        phone: patient.phone,
        email: patient.email || undefined,
        selectedDate: patient.date,
        timeSlot: patient.timeSlot,
        notes: patient.notes || undefined,
        testIds: Array.from(selTests),
        packageIds: Array.from(selPkgs),
        totalAmount: total,
        isVip: false,
      };
      const gateway = config?.gateway;
      // Every gateway below is driven to completion inside PaymentWebView (a
      // native WebView), not the browser-only window.location/DOM-form-submit
      // APIs this used to call — those are no-ops on Android/iOS.
      if (gateway === "icici") {
        const res = await api.post("/api/public/booking/icici-initiate", body) as { bookingRef: string; redirectUrl: string };
        return { mode: "url", url: res.redirectUrl };
      }
      if (gateway === "payu") {
        // Backend returns PaymentEngine's rawResponse verbatim: { fields, actionUrl }.
        const res = await api.post("/api/public/booking/payu-initiate", body) as { fields: Record<string, string>; actionUrl: string };
        return { mode: "post", url: res.actionUrl, fields: res.fields };
      }
      if (gateway === "phonepe") {
        const res = await api.post("/api/public/booking/phonepe-initiate", body) as { redirectUrl: string };
        return { mode: "url", url: res.redirectUrl };
      }
      if (gateway === "bharatpe") {
        const res = await api.post("/api/public/booking/bharatpe-initiate", body) as { redirectUrl: string };
        return { mode: "url", url: res.redirectUrl };
      }
      // Razorpay: create the order, then drive its JS checkout inside the WebView.
      const res = await api.post("/api/public/booking/create-order", body) as {
        bookingRef: string; razorpayOrderId: string; amountPaise: number; keyId: string;
      };
      return {
        mode: "razorpay",
        razorpay: {
          keyId: res.keyId,
          amountPaise: res.amountPaise,
          orderId: res.razorpayOrderId,
          name: "Care Diagnostics",
          description: `Test booking — ${res.bookingRef}`,
          prefillName: patient.name,
          prefillPhone: patient.phone,
          prefillEmail: patient.email,
          bookingRef: res.bookingRef,
        },
      };
    },
    onSuccess: (data) => {
      setPayError("");
      setPendingPayment(data);
    },
    onError: (err: unknown) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setPayError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    },
  });

  const handlePaymentResult = useCallback((result: PaymentResult) => {
    setPendingPayment(null);
    if (result.outcome === "confirmed") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPayError("");
      setSuccessRef(result.ref);
      setStep("done");
    } else if (result.outcome === "failed") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setPayError(result.reason);
    }
    // "cancelled": user backed out of the WebView — return to the pay step silently.
  }, []);

  const handleRazorpayVerify = useCallback(async (payload: RazorpayPaymentPayload) => {
    const res = await api.post("/api/public/booking/verify-payment", payload) as { success: boolean; bookingRef: string };
    return { bookingRef: res.bookingRef };
  }, [api]);

  if (!enabled && config) {
    return (
      <Screen scroll={false}>
        <BackBar />
        <View style={{ flex: 1, justifyContent: "center" }}>
          <EmptyState
            icon="alert-circle"
            title="Booking Disabled"
            message="Online booking is currently disabled by the clinic. Please call to schedule your tests."
            actionLabel="Call Clinic"
            onAction={() => Linking.openURL("tel:9973497200")}
          />
        </View>
      </Screen>
    );
  }

  const stepIndex = STEPS.findIndex((s) => s.key === step);
  const itemCount = selTests.size + selPkgs.size;
  const nothingMatches = filteredTests.length === 0 && (packages.length === 0 || filteredPkgs.length === 0);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: Platform.OS === "web" ? 67 : insets.top + spacing.lg, paddingBottom: spacing.xxl }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ paddingHorizontal: spacing.xl }}>
          <BackBar
            label={step === "done" ? "Home" : "Back"}
            onPress={() => {
              if (step === "tests") router.back();
              else if (step === "details") setStep("tests");
              else if (step === "pay") setStep("details");
              else setStep("tests");
            }}
          />

          {step !== "done" && (
            <View style={styles.stepRow}>
              {STEPS.map((s, i) => {
                const state = i < stepIndex ? "done" : i === stepIndex ? "active" : "todo";
                return (
                  <View key={s.key} style={styles.stepItem}>
                    {i > 0 && <Feather name="chevron-right" size={14} color={colors.mutedForeground} />}
                    <View
                      style={[
                        styles.stepChip,
                        {
                          backgroundColor:
                            state === "active" ? colors.primary : state === "done" ? colors.primary + "14" : colors.muted,
                        },
                      ]}
                    >
                      {state === "done" && <Feather name="check" size={12} color={colors.primary} />}
                      <Text
                        style={[
                          styles.stepChipText,
                          {
                            color:
                              state === "active"
                                ? colors.primaryForeground
                                : state === "done"
                                  ? colors.primary
                                  : colors.mutedForeground,
                          },
                        ]}
                      >
                        {s.label}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {step === "done" ? (
            <Animated.View entering={FadeIn.duration(400)}>
              <Card
                style={{
                  alignItems: "center",
                  backgroundColor: colors.success + "10",
                  borderColor: colors.success + "40",
                  padding: spacing.section,
                  marginTop: spacing.xl,
                }}
              >
                <View style={[styles.doneIcon, { backgroundColor: colors.success + "18" }]}>
                  <Feather name="check" size={34} color={colors.success} />
                </View>
                <Text style={[styles.doneTitle, { color: colors.foreground }]}>Booking Confirmed</Text>
                <Text style={[styles.doneRefLabel, { color: colors.mutedForeground }]}>Booking reference</Text>
                <View style={[styles.refChip, { backgroundColor: colors.muted }]}>
                  <Text style={[styles.refChipText, { color: colors.foreground }]}>{successRef}</Text>
                </View>
                <Text style={[styles.doneNote, { color: colors.mutedForeground }]}>
                  Please arrive 15 minutes early. Bring this reference number.
                </Text>
              </Card>
              <AppButton
                label="Back to Home"
                icon="home"
                onPress={() => router.replace("/")}
                style={{ marginTop: spacing.xl }}
              />
            </Animated.View>
          ) : step === "tests" ? (
            <>
              <ScreenHeader title="Select Tests" subtitle="Choose the tests and packages you need" />
              <View style={[styles.searchBox, { backgroundColor: colors.card, borderColor: colors.input }]}>
                <Feather name="search" size={16} color={colors.mutedForeground} />
                <TextInput
                  style={[styles.searchInput, { color: colors.foreground }]}
                  placeholder="Search tests or packages..."
                  placeholderTextColor={colors.mutedForeground}
                  value={search}
                  onChangeText={setSearch}
                />
              </View>

              {isLoading ? (
                <SkeletonList count={6} height={76} />
              ) : (
                <>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.lg }}>
                    <View style={styles.catRow}>
                      {categories.map((c) => {
                        const active = catFilter === c;
                        return (
                          <TouchableOpacity
                            key={c}
                            style={[
                              styles.catChip,
                              {
                                backgroundColor: active ? colors.primary : colors.card,
                                borderColor: active ? colors.primary : colors.border,
                              },
                            ]}
                            onPress={() => setCatFilter(c)}
                          >
                            <Text style={[styles.catChipText, { color: active ? "#fff" : colors.foreground }]}>
                              {c === "all" ? "All" : c}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </ScrollView>

                  {nothingMatches ? (
                    <EmptyState
                      icon="search"
                      title="No matching tests"
                      message="Try a different search term or category."
                    />
                  ) : (
                    <>
                      <SectionLabel>Individual Tests</SectionLabel>
                      {filteredTests.length === 0 ? (
                        <Text style={[styles.emptyInline, { color: colors.mutedForeground }]}>
                          No tests match your search
                        </Text>
                      ) : (
                        <View style={{ gap: spacing.md }}>
                          {filteredTests.map((t) => (
                            <SelectableCard
                              key={t.id}
                              title={t.name}
                              meta={`${t.category} · ${t.department || "Pathology"}`}
                              price={Number(t.price)}
                              selected={selTests.has(t.id)}
                              onToggle={() => toggleTest(t.id)}
                              colors={colors}
                            />
                          ))}
                        </View>
                      )}

                      {packages.length > 0 && (
                        <>
                          <SectionLabel style={{ marginTop: spacing.xxl }}>Packages</SectionLabel>
                          {filteredPkgs.length === 0 ? (
                            <Text style={[styles.emptyInline, { color: colors.mutedForeground }]}>
                              No packages match
                            </Text>
                          ) : (
                            <View style={{ gap: spacing.md }}>
                              {filteredPkgs.map((p) => (
                                <SelectableCard
                                  key={p.id}
                                  title={p.name}
                                  meta={`${p.tests?.length ?? 0} tests included`}
                                  price={Number(p.price)}
                                  selected={selPkgs.has(p.id)}
                                  onToggle={() => togglePkg(p.id)}
                                  colors={colors}
                                />
                              ))}
                            </View>
                          )}
                        </>
                      )}
                    </>
                  )}
                </>
              )}
            </>
          ) : step === "details" ? (
            <>
              <ScreenHeader title="Patient Details" subtitle="Tell us who the tests are for" />
              <View style={[styles.summaryBar, { backgroundColor: colors.primary + "12" }]}>
                <Feather name="shopping-cart" size={14} color={colors.primary} />
                <Text style={[styles.summaryText, { color: colors.primary }]}>
                  {itemCount} items · ₹{total.toLocaleString("en-IN")}
                </Text>
              </View>

              <Input label="Full Name *" value={patient.name} onChangeText={(v: string) => setPatient({ ...patient, name: v })} colors={colors} />
              <Input label="Phone Number *" value={patient.phone} onChangeText={(v: string) => setPatient({ ...patient, phone: v })} colors={colors} keyboardType="phone-pad" />
              <Input label="Email (optional)" value={patient.email} onChangeText={(v: string) => setPatient({ ...patient, email: v })} colors={colors} keyboardType="email-address" />

              <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>Preferred Date *</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ marginBottom: spacing.sm }}
                contentContainerStyle={{ gap: spacing.sm, paddingVertical: 2 }}
              >
                {dateOptions.map((d) => {
                  const active = patient.date === d.value;
                  return (
                    <TouchableOpacity
                      key={d.value}
                      style={[
                        styles.dateChip,
                        {
                          backgroundColor: active ? colors.primary : colors.card,
                          borderColor: active ? colors.primary : colors.border,
                        },
                      ]}
                      onPress={() => setPatient((p) => ({ ...p, date: d.value }))}
                    >
                      <Text style={[styles.dateChipText, { color: active ? "#fff" : colors.foreground }]}>
                        {d.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
              <Input label="or type a date (YYYY-MM-DD)" value={patient.date} onChangeText={(v: string) => setPatient({ ...patient, date: v })} colors={colors} />

              <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>Time Slot</Text>
              <View style={[styles.slotGrid, { backgroundColor: colors.card, borderColor: colors.border }]}>
                {timeSlots.map((s) => {
                  const active = patient.timeSlot === s;
                  return (
                    <TouchableOpacity
                      key={s}
                      style={[
                        styles.slotChip,
                        {
                          backgroundColor: active ? colors.primary : colors.background,
                          borderColor: active ? colors.primary : colors.border,
                        },
                      ]}
                      onPress={() => setPatient((p) => ({ ...p, timeSlot: s }))}
                    >
                      <Text style={{ color: active ? "#fff" : colors.foreground, fontSize: 13, fontFamily: "Inter_500Medium" }}>
                        {s}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={{ marginTop: spacing.lg }}>
                <Input label="Notes (optional)" value={patient.notes} onChangeText={(v: string) => setPatient({ ...patient, notes: v })} colors={colors} multiline />
              </View>

              <AppButton
                label="Continue to Payment"
                iconRight="arrow-right"
                disabled={!patient.name || !patient.phone || !patient.date}
                onPress={() => setStep("pay")}
                style={{ marginTop: spacing.sm }}
              />
            </>
          ) : (
            <>
              <ScreenHeader title="Payment" subtitle="Review your order and pay securely" />
              <Card style={{ marginBottom: spacing.xxl }}>
                <Text style={[styles.payLabel, { color: colors.mutedForeground }]}>Total Amount</Text>
                <Text style={[styles.payAmount, { color: colors.foreground }]}>₹{total.toLocaleString("en-IN")}</Text>
                <Text style={[styles.payItems, { color: colors.mutedForeground }]}>
                  {selTests.size} tests · {selPkgs.size} packages
                </Text>
              </Card>

              <SectionLabel>Payment Method</SectionLabel>
              <Card>
                {config?.gateway === "razorpay" && (
                  <GatewayOption icon="credit-card" label="Razorpay" sub="Cards, UPI, Netbanking" colors={colors} />
                )}
                {config?.gateway === "payu" && (
                  <GatewayOption icon="credit-card" label="PayU" sub="UPI, Cards, Wallets" colors={colors} />
                )}
                {config?.gateway === "phonepe" && (
                  <GatewayOption icon="smartphone" label="PhonePe" sub="UPI, Cards" colors={colors} />
                )}
                {config?.gateway === "bharatpe" && (
                  <GatewayOption icon="smartphone" label="BharatPe" sub="UPI" colors={colors} />
                )}
                {config?.gateway === "cashfree" && (
                  <GatewayOption icon="credit-card" label="Cashfree" sub="Cards, UPI, Netbanking" colors={colors} />
                )}
                {config?.gateway === "icici" && (
                  <GatewayOption icon="credit-card" label="Orange Pay (ICICI)" sub="Cards, UPI, Netbanking" colors={colors} />
                )}
                {!config?.gateway && (
                  <InlineAlert tone="warning" message="No payment gateway configured. Please call the clinic." />
                )}
              </Card>

              {payError ? (
                <View style={{ marginTop: spacing.md }}>
                  <InlineAlert tone="destructive" message={payError} />
                </View>
              ) : null}

              <AppButton
                label="Pay & Book"
                icon="lock"
                loading={bookMutation.isPending}
                disabled={!config?.gateway}
                onPress={() => bookMutation.mutate()}
                style={{ marginTop: spacing.xl }}
              />
            </>
          )}
        </View>
      </ScrollView>

      {/* Sticky footer summary on test step */}
      {step === "tests" && (
        <View
          style={[
            styles.footer,
            { backgroundColor: colors.card, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, spacing.md) },
            cardShadow(colors.shadow),
          ]}
        >
          <View style={styles.footerRow}>
            <View>
              <Text style={[styles.footerTotal, { color: colors.foreground }]}>₹{total.toLocaleString("en-IN")}</Text>
              <Text style={[styles.footerItems, { color: colors.mutedForeground }]}>
                {selTests.size} tests · {selPkgs.size} packages
              </Text>
            </View>
            <AppButton
              label="Continue"
              iconRight="arrow-right"
              disabled={itemCount === 0}
              onPress={() => setStep("details")}
              style={{ paddingHorizontal: spacing.xxl }}
            />
          </View>
        </View>
      )}

      {pendingPayment?.mode === "url" && (
        <PaymentWebView visible mode="url" url={pendingPayment.url} onResult={handlePaymentResult} />
      )}
      {pendingPayment?.mode === "post" && (
        <PaymentWebView visible mode="post" url={pendingPayment.url} fields={pendingPayment.fields} onResult={handlePaymentResult} />
      )}
      {pendingPayment?.mode === "razorpay" && (
        <PaymentWebView
          visible
          mode="razorpay"
          razorpay={pendingPayment.razorpay}
          onVerify={handleRazorpayVerify}
          onResult={handlePaymentResult}
        />
      )}
    </KeyboardAvoidingView>
  );
}

function SelectableCard({
  title,
  meta,
  price,
  selected,
  onToggle,
  colors,
}: {
  title: string;
  meta: string;
  price: number;
  selected: boolean;
  onToggle: () => void;
  colors: any;
}) {
  return (
    <Card
      onPress={onToggle}
      style={[
        styles.testCard,
        selected && { borderColor: colors.primary, backgroundColor: colors.primary + "08" },
      ]}
    >
      <View
        style={[
          styles.checkCircle,
          selected
            ? { backgroundColor: colors.primary, borderColor: colors.primary }
            : { borderColor: colors.border },
        ]}
      >
        {selected && <Feather name="check" size={13} color={colors.primaryForeground} />}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.testName, { color: colors.foreground }]}>{title}</Text>
        <Text style={[styles.testMeta, { color: colors.mutedForeground }]}>{meta}</Text>
      </View>
      <Text style={[styles.testPrice, { color: selected ? colors.primary : colors.foreground }]}>
        ₹{price.toLocaleString("en-IN")}
      </Text>
    </Card>
  );
}

function GatewayOption({ icon, label, sub, colors }: { icon: FeatherIconName; label: string; sub: string; colors: any }) {
  return (
    <View style={styles.gatewayRow}>
      <IconTile icon={icon} color={colors.primary} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.gatewayLabel, { color: colors.foreground }]}>{label}</Text>
        <Text style={[styles.gatewaySub, { color: colors.mutedForeground }]}>{sub}</Text>
      </View>
      <Feather name="check-circle" size={18} color={colors.primary} />
    </View>
  );
}

function Input({ label, value, onChangeText, colors, keyboardType, multiline }: any) {
  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <TextInput
        style={[styles.textInput, {
          backgroundColor: colors.card,
          borderColor: colors.input,
          color: colors.foreground,
          height: multiline ? 88 : 46,
          textAlignVertical: multiline ? "top" : "center",
          paddingTop: multiline ? spacing.md : undefined,
        }]}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        multiline={multiline}
        placeholderTextColor={colors.mutedForeground}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  stepRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginBottom: spacing.xl },
  stepItem: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  stepChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: radii.chip,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  stepChipText: { fontSize: 12, fontFamily: "Inter_600SemiBold", letterSpacing: 0.2 },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  searchInput: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  catRow: { flexDirection: "row", gap: spacing.sm, paddingVertical: 4 },
  catChip: { borderRadius: radii.chip, borderWidth: 1, paddingVertical: 8, paddingHorizontal: 16 },
  catChipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  emptyInline: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: spacing.xl, lineHeight: 20 },
  testCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md + 2 },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  testName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  testMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  testPrice: { fontSize: 15, fontFamily: "Inter_700Bold" },
  summaryBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radii.icon,
    padding: spacing.md,
    marginBottom: spacing.xl,
  },
  summaryText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  inputLabel: { fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 6, letterSpacing: 0.2 },
  textInput: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  dateChip: {
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  dateChipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  slotGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    borderRadius: radii.icon,
    borderWidth: 1,
    padding: spacing.md,
  },
  slotChip: { borderRadius: 10, borderWidth: 1, paddingVertical: 9, paddingHorizontal: 12 },
  payLabel: { fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 4, letterSpacing: 0.2 },
  payAmount: { fontSize: 30, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  payItems: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4 },
  gatewayRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  gatewayLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  gatewaySub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  footer: {
    borderTopWidth: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  footerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  footerTotal: { fontSize: 18, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  footerItems: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  doneIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  doneTitle: { fontSize: 22, fontFamily: "Inter_700Bold", letterSpacing: -0.4 },
  doneRefLabel: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: spacing.lg, letterSpacing: 0.2 },
  refChip: {
    borderRadius: radii.chip,
    paddingVertical: 8,
    paddingHorizontal: 18,
    marginTop: spacing.sm,
  },
  refChipText: { fontSize: 15, fontFamily: "Inter_600SemiBold", letterSpacing: 1.2 },
  doneNote: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: spacing.lg, lineHeight: 20 },
});
