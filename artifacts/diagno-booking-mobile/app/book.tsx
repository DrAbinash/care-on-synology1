import {
  StyleSheet, Text, View, ScrollView, TouchableOpacity, TextInput, Platform,
  ActivityIndicator, KeyboardAvoidingView,
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
  const [slotPickerOpen, setSlotPickerOpen] = useState(false);

  const bookMutation = useMutation({
    mutationFn: async () => {
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
      if (gateway === "icici") {
        const res = await api.post("/api/public/booking/icici-initiate", body) as { bookingRef: string; redirectUrl: string; tranCtx: string };
        // For mobile WebView, redirect to payment URL
        if (res.redirectUrl) {
          window.location.href = res.redirectUrl;
        }
        return res;
      }
      if (gateway === "payu") {
        const res = await api.post("/api/public/booking/payu-initiate", body) as { payuUrl: string; fields: Record<string, string> };
        // Build and submit a hidden form
        const form = document.createElement("form");
        form.method = "POST";
        form.action = res.payuUrl;
        form.style.display = "none";
        for (const [k, v] of Object.entries(res.fields)) {
          const input = document.createElement("input");
          input.type = "hidden"; input.name = k; input.value = String(v);
          form.appendChild(input);
        }
        document.body.appendChild(form);
        form.submit();
        return res;
      }
      if (gateway === "phonepe") {
        const res = await api.post("/api/public/booking/phonepe-initiate", body) as { redirectUrl: string };
        if (res.redirectUrl) window.location.href = res.redirectUrl;
        return res;
      }
      if (gateway === "bharatpe") {
        const res = await api.post("/api/public/booking/bharatpe-initiate", body) as { redirectUrl: string };
        if (res.redirectUrl) window.location.href = res.redirectUrl;
        return res;
      }
      // Fallback: Razorpay or QR
      const res = await api.post("/api/public/booking/create-order", body) as { bookingRef: string; razorpayOrderId: string; amountPaise: number; keyId: string };
      return res;
    },
    onSuccess: (data: any) => {
      setSuccessRef(data.bookingRef || "");
      setStep("done");
    },
    onError: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    },
  });

  if (!enabled && config) {
    return (
      <View style={[styles.disabledWrap, { backgroundColor: colors.background, paddingTop: insets.top + 20 }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={20} color={colors.foreground} />
          <Text style={[styles.backText, { color: colors.foreground }]}>Back</Text>
        </TouchableOpacity>
        <View style={styles.disabledCenter}>
          <Feather name="alert-circle" size={48} color={colors.warning} />
          <Text style={[styles.disabledTitle, { color: colors.foreground }]}>Booking Disabled</Text>
          <Text style={[styles.disabledText, { color: colors.mutedForeground }]}>
            Online booking is currently disabled by the clinic. Please call to schedule your tests.
          </Text>
          <TouchableOpacity style={[styles.disabledCallBtn, { backgroundColor: colors.primary }]} onPress={() => {}}>
            <Feather name="phone" size={16} color="#fff" />
            <Text style={styles.disabledCallText}>Call Clinic</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: Platform.OS === "web" ? 67 : insets.top + 16, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ paddingHorizontal: 16 }}>
          <TouchableOpacity style={styles.backBtn} onPress={() => {
            if (step === "tests") router.back();
            else if (step === "details") setStep("tests");
            else if (step === "pay") setStep("details");
            else setStep("tests");
          }}>
            <Feather name="arrow-left" size={20} color={colors.foreground} />
            <Text style={[styles.backText, { color: colors.foreground }]}>
              {step === "done" ? "Home" : "Back"}
            </Text>
          </TouchableOpacity>

          {step === "done" ? (
            <Animated.View entering={FadeIn.duration(400)}>
              <View style={[styles.doneCard, { backgroundColor: colors.success + "10", borderColor: colors.success + "40" }]}>
                <View style={[styles.doneIcon, { backgroundColor: colors.success + "18" }]}>
                  <Feather name="check-circle" size={36} color={colors.success} />
                </View>
                <Text style={[styles.doneTitle, { color: colors.foreground }]}>Booking Confirmed</Text>
                <Text style={[styles.doneRef, { color: colors.success }]}>Ref: {successRef}</Text>
                <Text style={[styles.doneNote, { color: colors.mutedForeground }]}>
                  Please arrive 15 minutes early. Bring this reference number.
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.doneBtn, { backgroundColor: colors.primary } ]}
                onPress={() => router.replace("/")}
              >
                <Text style={styles.doneBtnText}>Back to Home</Text>
              </TouchableOpacity>
            </Animated.View>
          ) : step === "tests" ? (
            <>
              <Text style={[styles.screenTitle, { color: colors.foreground }]}>Select Tests</Text>
              <View style={[styles.searchBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Feather name="search" size={16} color={colors.mutedForeground} />
                <TextInput
                  style={[styles.searchInput, { color: colors.foreground }]}
                  placeholder="Search tests or packages..."
                  placeholderTextColor={colors.mutedForeground}
                  value={search}
                  onChangeText={setSearch}
                />
              </View>

              {isLoading ? <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} /> : (
                <>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                    <View style={styles.catRow}>
                      {categories.map((c) => (
                        <TouchableOpacity
                          key={c}
                          style={[styles.catChip, { backgroundColor: catFilter === c ? colors.primary : colors.card, borderColor: colors.border }]}
                          onPress={() => setCatFilter(c)}
                        >
                          <Text style={[styles.catChipText, { color: catFilter === c ? "#fff" : colors.foreground }]}>
                            {c === "all" ? "All" : c}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </ScrollView>

                  <Text style={[styles.sectionHeader, { color: colors.foreground }]}>Individual Tests</Text>
                  {filteredTests.length === 0 ? (
                    <Text style={[styles.empty, { color: colors.mutedForeground }]}>No tests match your search</Text>
                  ) : (
                    <View style={{ gap: 8 }}>
                      {filteredTests.map((t) => (
                        <TestCard
                          key={t.id}
                          item={t}
                          selected={selTests.has(t.id)}
                          onToggle={() => toggleTest(t.id)}
                          colors={colors}
                        />
                      ))}
                    </View>
                  )}

                  {packages.length > 0 && (
                    <>
                      <Text style={[styles.sectionHeader, { color: colors.foreground, marginTop: 20 }]}>Packages</Text>
                      {filteredPkgs.length === 0 ? (
                        <Text style={[styles.empty, { color: colors.mutedForeground }]}>No packages match</Text>
                      ) : (
                        <View style={{ gap: 8 }}>
                          {filteredPkgs.map((p) => (
                            <PackageCard
                              key={p.id}
                              item={p}
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
          ) : step === "details" ? (
            <>
              <Text style={[styles.screenTitle, { color: colors.foreground }]}>Patient Details</Text>
              <View style={[styles.summaryBar, { backgroundColor: colors.primary + "12" }]}>
                <Text style={[styles.summaryText, { color: colors.primary }]}>
                  {selTests.size + selPkgs.size} items · ₹{total.toLocaleString("en-IN")}
                </Text>
              </View>

              <Input label="Full Name *" value={patient.name} onChangeText={(v: string) => setPatient({ ...patient, name: v })} colors={colors} />
              <Input label="Phone Number *" value={patient.phone} onChangeText={(v: string) => setPatient({ ...patient, phone: v })} colors={colors} keyboardType="phone-pad" />
              <Input label="Email (optional)" value={patient.email} onChangeText={(v: string) => setPatient({ ...patient, email: v })} colors={colors} keyboardType="email-address" />
              <Input label="Preferred Date (YYYY-MM-DD)" value={patient.date} onChangeText={(v: string) => setPatient({ ...patient, date: v })} colors={colors} />

              <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>Time Slot</Text>
              <TouchableOpacity
                style={[styles.slotPicker, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => setSlotPickerOpen(!slotPickerOpen)}
              >
                <Text style={{ color: patient.timeSlot ? colors.foreground : colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 15 }}>
                  {patient.timeSlot || "Select a time slot"}
                </Text>
                <Feather name={slotPickerOpen ? "chevron-up" : "chevron-down"} size={16} color={colors.mutedForeground} />
              </TouchableOpacity>
              {slotPickerOpen && (
                <View style={[styles.slotGrid, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  {timeSlots.map((s) => (
                    <TouchableOpacity
                      key={s}
                      style={[styles.slotChip, {
                        backgroundColor: patient.timeSlot === s ? colors.primary : colors.background,
                        borderColor: colors.border,
                      }]}
                      onPress={() => { setPatient((p) => ({ ...p, timeSlot: s })); setSlotPickerOpen(false); }}
                    >
                      <Text style={{ color: patient.timeSlot === s ? "#fff" : colors.foreground, fontSize: 13, fontFamily: "Inter_500Medium" }}>
                        {s}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <Input label="Notes (optional)" value={patient.notes} onChangeText={(v: string) => setPatient({ ...patient, notes: v })} colors={colors} multiline />

              <TouchableOpacity
                style={[styles.nextBtn, { backgroundColor: colors.primary, opacity: patient.name && patient.phone && patient.date ? 1 : 0.4 } ]}
                disabled={!patient.name || !patient.phone || !patient.date}
                onPress={() => setStep("pay")}
              >
                <Text style={styles.nextBtnText}>Continue to Payment</Text>
                <Feather name="arrow-right" size={18} color="#fff" />
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={[styles.screenTitle, { color: colors.foreground }]}>Payment</Text>
              <View style={[styles.payCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.payLabel, { color: colors.mutedForeground }]}>Total Amount</Text>
                <Text style={[styles.payAmount, { color: colors.foreground }]}>₹{total.toLocaleString("en-IN")}</Text>
                <Text style={[styles.payItems, { color: colors.mutedForeground }]}>
                  {selTests.size} tests, {selPkgs.size} packages
                </Text>
              </View>

              <View style={[styles.gatewayCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.gatewayTitle, { color: colors.foreground }]}>Select Payment Method</Text>
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
                  <View style={[styles.warnBox, { backgroundColor: colors.warning + "12", borderColor: colors.warning + "40" }]}>
                    <Feather name="alert-triangle" size={16} color={colors.warning} />
                    <Text style={[styles.warnText, { color: colors.warning }]}>
                      No payment gateway configured. Please call the clinic.
                    </Text>
                  </View>
                )}
              </View>

              <TouchableOpacity
                style={[styles.nextBtn, { backgroundColor: colors.primary, opacity: config?.gateway ? 1 : 0.4 } ]}
                disabled={!config?.gateway}
                onPress={() => bookMutation.mutate()}
              >
                {bookMutation.isPending ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Text style={styles.nextBtnText}>Pay & Book</Text>
                    <Feather name="arrow-right" size={18} color="#fff" />
                  </>
                )}
              </TouchableOpacity>
            </>
          )}
        </View>
      </ScrollView>

      {/* Sticky footer summary on test step */}
      {step === "tests" && (
        <View style={[styles.footer, { backgroundColor: colors.card, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, 8) }]}>
          <View style={styles.footerRow}>
            <View>
              <Text style={[styles.footerTotal, { color: colors.foreground }]}>₹{total.toLocaleString("en-IN")}</Text>
              <Text style={[styles.footerItems, { color: colors.mutedForeground }]}>{selTests.size} tests, {selPkgs.size} pkgs</Text>
            </View>
            <TouchableOpacity
              style={[styles.footerBtn, { backgroundColor: colors.primary, opacity: selTests.size + selPkgs.size > 0 ? 1 : 0.4 } ]}
              disabled={selTests.size + selPkgs.size === 0}
              onPress={() => setStep("details")}
            >
              <Text style={styles.footerBtnText}>Next</Text>
              <Feather name="arrow-right" size={16} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

function TestCard({ item, selected, onToggle, colors }: { item: any; selected: boolean; onToggle: () => void; colors: any }) {
  return (
    <TouchableOpacity
      style={[styles.testCard, { backgroundColor: colors.card, borderColor: selected ? colors.primary : colors.border }]}
      onPress={onToggle}
      activeOpacity={0.7}
    >
      <View style={styles.testLeft}>
        <View style={[styles.testIcon, { backgroundColor: selected ? colors.primary + "18" : colors.accent + "12" }]}>
          <Feather name="check-circle" size={18} color={selected ? colors.primary : colors.mutedForeground} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.testName, { color: colors.foreground }]}>{item.name}</Text>
          <Text style={[styles.testMeta, { color: colors.mutedForeground }]}>
            {item.category} · {item.department || "Pathology"}
          </Text>
        </View>
      </View>
      <Text style={[styles.testPrice, { color: selected ? colors.primary : colors.foreground }]}>
        ₹{Number(item.price).toLocaleString("en-IN")}
      </Text>
    </TouchableOpacity>
  );
}

function PackageCard({ item, selected, onToggle, colors }: { item: any; selected: boolean; onToggle: () => void; colors: any }) {
  return (
    <TouchableOpacity
      style={[styles.testCard, { backgroundColor: selected ? colors.primary + "08" : colors.card, borderColor: selected ? colors.primary : colors.border }]}
      onPress={onToggle}
      activeOpacity={0.7}
    >
      <View style={styles.testLeft}>
        <View style={[styles.testIcon, { backgroundColor: selected ? colors.primary + "18" : colors.accent + "12" }]}>
          <Feather name="package" size={18} color={selected ? colors.primary : colors.mutedForeground} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.testName, { color: colors.foreground }]}>{item.name}</Text>
          <Text style={[styles.testMeta, { color: colors.mutedForeground }]}>
            {item.tests?.length ?? 0} tests included
          </Text>
        </View>
      </View>
      <Text style={[styles.testPrice, { color: selected ? colors.primary : colors.foreground }]}>
        ₹{Number(item.price).toLocaleString("en-IN")}
      </Text>
    </TouchableOpacity>
  );
}

function GatewayOption({ icon, label, sub, colors }: { icon: any; label: string; sub: string; colors: any }) {
  return (
    <View style={[styles.gatewayRow, { borderBottomColor: colors.border }]}>
      <Feather name={icon} size={18} color={colors.primary} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.gatewayLabel, { color: colors.foreground }]}>{label}</Text>
        <Text style={[styles.gatewaySub, { color: colors.mutedForeground }]}>{sub}</Text>
      </View>
      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
    </View>
  );
}

function Input({ label, value, onChangeText, colors, keyboardType, multiline }: any) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <TextInput
        style={[styles.textInput, {
          backgroundColor: colors.card,
          borderColor: colors.border,
          color: colors.foreground,
          height: multiline ? 80 : 46,
          textAlignVertical: multiline ? "top" : "center",
          paddingTop: multiline ? 12 : undefined,
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
  backBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 },
  backText: { fontSize: 15, fontFamily: "Inter_500Medium" },
  screenTitle: { fontSize: 24, fontFamily: "Inter_700Bold", marginBottom: 14 },
  searchBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10,
    marginBottom: 12,
  },
  searchInput: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  catRow: { flexDirection: "row", gap: 8, paddingVertical: 4 },
  catChip: { borderRadius: 20, borderWidth: 1, paddingVertical: 6, paddingHorizontal: 14 },
  catChipText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  sectionHeader: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 8, marginTop: 4 },
  empty: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 20 },
  testCard: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderRadius: 14, borderWidth: 1, padding: 12,
  },
  testLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  testIcon: { width: 36, height: 36, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  testName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  testMeta: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  testPrice: { fontSize: 14, fontFamily: "Inter_700Bold" },
  summaryBar: { borderRadius: 10, padding: 10, marginBottom: 16 },
  summaryText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  inputLabel: { fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 5 },
  textInput: {
    borderRadius: 10, borderWidth: 1, paddingHorizontal: 12,
    fontSize: 15, fontFamily: "Inter_400Regular",
  },
  slotPicker: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 12,
  },
  slotGrid: {
    flexDirection: "row", flexWrap: "wrap", gap: 8,
    borderRadius: 10, borderWidth: 1, padding: 10, marginTop: 4,
  },
  slotChip: { borderRadius: 8, borderWidth: 1, paddingVertical: 6, paddingHorizontal: 10 },
  nextBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    borderRadius: 14, paddingVertical: 14, marginTop: 16,
  },
  nextBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
  payCard: { borderRadius: 16, borderWidth: 1, padding: 18, marginBottom: 14 },
  payLabel: { fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 4 },
  payAmount: { fontSize: 28, fontFamily: "Inter_700Bold" },
  payItems: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  gatewayCard: { borderRadius: 16, borderWidth: 1, padding: 18 },
  gatewayTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", marginBottom: 10 },
  gatewayRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 12, borderBottomWidth: 1,
  },
  gatewayLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  gatewaySub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  warnBox: { flexDirection: "row", gap: 8, alignItems: "flex-start", borderRadius: 10, borderWidth: 1, padding: 12 },
  warnText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular" },
  footer: {
    borderTopWidth: 1,
    paddingHorizontal: 16, paddingTop: 10,
  },
  footerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  footerTotal: { fontSize: 18, fontFamily: "Inter_700Bold" },
  footerItems: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  footerBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    borderRadius: 12, paddingVertical: 10, paddingHorizontal: 18,
  },
  footerBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
  doneCard: {
    alignItems: "center", borderRadius: 18, borderWidth: 1,
    padding: 28, marginTop: 20,
  },
  doneIcon: {
    width: 72, height: 72, borderRadius: 36,
    alignItems: "center", justifyContent: "center", marginBottom: 16,
  },
  doneTitle: { fontSize: 22, fontFamily: "Inter_700Bold" },
  doneRef: { fontSize: 16, fontFamily: "Inter_600SemiBold", marginTop: 6 },
  doneNote: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 12 },
  doneBtn: { borderRadius: 14, paddingVertical: 14, alignItems: "center", marginTop: 20 },
  doneBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
  disabledWrap: { flex: 1 },
  disabledCenter: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40, paddingTop: 40 },
  disabledTitle: { fontSize: 20, fontFamily: "Inter_700Bold", marginTop: 16 },
  disabledText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 6 },
  disabledCallBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24, marginTop: 20,
  },
  disabledCallText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
