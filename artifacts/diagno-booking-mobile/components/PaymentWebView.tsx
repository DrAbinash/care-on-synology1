import { useCallback, useState } from "react";
import { Modal, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Platform } from "react-native";
import { Feather } from "@expo/vector-icons";
import { WebView } from "react-native-webview";

import { useColors } from "@/hooks/useColors";

// The backend's public-booking routes (icici/payu/phonepe/bharatpe) all funnel
// back to this same path with the same query contract regardless of gateway —
// see getBookingConfirmationUrl() in artifacts/api-server/src/routes/public-booking.ts.
// Watching for it here lets one component drive every redirect-based gateway.
const RETURN_PATH = "/book";

export type PaymentResult =
  | { outcome: "confirmed"; ref: string; gateway: string }
  | { outcome: "failed"; reason: string }
  | { outcome: "cancelled" };

export type RazorpayPaymentPayload = {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
};

type RazorpayOptions = {
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

type CommonProps = {
  visible: boolean;
  onResult: (result: PaymentResult) => void;
};

type Props =
  | (CommonProps & { mode: "url"; url: string })
  | (CommonProps & { mode: "post"; url: string; fields: Record<string, string> })
  | (CommonProps & {
      mode: "razorpay";
      razorpay: RazorpayOptions;
      onVerify: (payload: RazorpayPaymentPayload) => Promise<{ bookingRef: string }>;
    });

// Deliberately avoids the WHATWG URL/URLSearchParams globals — Hermes does not
// reliably ship them, so parse the query string by hand instead.
function parseQuery(queryString: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of queryString.split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const rawKey = eq === -1 ? pair : pair.slice(0, eq);
    const rawVal = eq === -1 ? "" : pair.slice(eq + 1);
    try {
      out[decodeURIComponent(rawKey)] = decodeURIComponent(rawVal.replace(/\+/g, " "));
    } catch {
      // malformed component — skip it rather than throw
    }
  }
  return out;
}

function encodeFormBody(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

function razorpayHtml(opts: RazorpayOptions): string {
  const js = (s: string) => JSON.stringify(s ?? "");
  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>html,body{margin:0;height:100%;background:#fff;}</style>
</head>
<body>
  <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
  <script>
    function post(msg) {
      if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(msg));
    }
    try {
      var rzp = new Razorpay({
        key: ${js(opts.keyId)},
        amount: ${Math.round(opts.amountPaise)},
        currency: "INR",
        order_id: ${js(opts.orderId)},
        name: ${js(opts.name)},
        description: ${js(opts.description)},
        prefill: { name: ${js(opts.prefillName)}, contact: ${js(opts.prefillPhone)}, email: ${js(opts.prefillEmail)} },
        theme: { color: "#0ea5e9" },
        handler: function (payment) {
          post({
            type: "success",
            razorpayOrderId: payment.razorpay_order_id,
            razorpayPaymentId: payment.razorpay_payment_id,
            razorpaySignature: payment.razorpay_signature,
          });
        },
        modal: { ondismiss: function () { post({ type: "dismissed" }); } },
      });
      rzp.on("payment.failed", function (resp) {
        post({ type: "failed", reason: (resp && resp.error && resp.error.description) || "Payment failed" });
      });
      rzp.open();
    } catch (e) {
      post({ type: "failed", reason: String(e) });
    }
  </script>
</body>
</html>`;
}

export default function PaymentWebView(props: Props) {
  const colors = useColors();
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState("");

  const handleClose = useCallback(() => {
    if (verifying) return; // don't let the user dismiss mid-verification
    props.onResult({ outcome: "cancelled" });
  }, [props, verifying]);

  const handleShouldStart = useCallback(
    (request: { url: string }): boolean => {
      const url = request.url || "";
      const qIdx = url.indexOf("?");
      const pathPart = (qIdx === -1 ? url : url.slice(0, qIdx)).replace(/\/+$/, "");
      const isReturn = pathPart.endsWith(RETURN_PATH) && qIdx !== -1;
      if (!isReturn) return true;

      const params = parseQuery(url.slice(qIdx + 1));
      if (params.confirmed === "1") {
        props.onResult({ outcome: "confirmed", ref: params.ref || "", gateway: params.gateway || "" });
      } else if (params.failed === "1") {
        props.onResult({ outcome: "failed", reason: params.reason || "Payment not completed" });
      } else {
        props.onResult({ outcome: "cancelled" });
      }
      return false; // never let the WebView actually load the web app's page
    },
    [props],
  );

  const handleRazorpayMessage = useCallback(
    async (event: { nativeEvent: { data: string } }) => {
      if (props.mode !== "razorpay") return;
      let msg: { type: string; reason?: string } & Partial<RazorpayPaymentPayload>;
      try {
        msg = JSON.parse(event.nativeEvent.data);
      } catch {
        return;
      }
      if (msg.type === "dismissed") {
        props.onResult({ outcome: "cancelled" });
        return;
      }
      if (msg.type === "failed") {
        props.onResult({ outcome: "failed", reason: msg.reason || "Payment failed" });
        return;
      }
      if (msg.type === "success" && msg.razorpayOrderId && msg.razorpayPaymentId && msg.razorpaySignature) {
        setVerifying(true);
        setVerifyError("");
        try {
          const verified = await props.onVerify({
            razorpayOrderId: msg.razorpayOrderId,
            razorpayPaymentId: msg.razorpayPaymentId,
            razorpaySignature: msg.razorpaySignature,
          });
          props.onResult({ outcome: "confirmed", ref: verified.bookingRef, gateway: "razorpay" });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Payment verification failed";
          setVerifying(false);
          setVerifyError(`${message} (payment ID: ${msg.razorpayPaymentId})`);
        }
      }
    },
    [props],
  );

  const source =
    props.mode === "url"
      ? { uri: props.url }
      : props.mode === "post"
        ? {
            uri: props.url,
            method: "POST" as const,
            body: encodeFormBody(props.fields),
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
          }
        : { html: razorpayHtml(props.razorpay) };

  return (
    <Modal
      visible={props.visible}
      animationType="slide"
      presentationStyle={Platform.OS === "ios" ? "fullScreen" : undefined}
      onRequestClose={handleClose}
    >
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.foreground }]}>Complete Payment</Text>
          <TouchableOpacity onPress={handleClose} disabled={verifying} style={styles.closeBtn} hitSlop={12}>
            <Feather name="x" size={22} color={verifying ? colors.mutedForeground : colors.foreground} />
          </TouchableOpacity>
        </View>

        {verifyError ? (
          <View style={styles.centerWrap}>
            <Feather name="alert-triangle" size={40} color={colors.destructive} />
            <Text style={[styles.errorText, { color: colors.foreground }]}>{verifyError}</Text>
            <TouchableOpacity
              style={[styles.retryBtn, { backgroundColor: colors.primary }]}
              onPress={() => props.onResult({ outcome: "failed", reason: verifyError })}
            >
              <Text style={styles.retryBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            <WebView
              // react-native-webview's WebViewSource union type doesn't cleanly
              // narrow across the uri/post-body/html variants built above.
              source={source as any}
              onShouldStartLoadWithRequest={props.mode === "razorpay" ? undefined : handleShouldStart}
              onMessage={props.mode === "razorpay" ? handleRazorpayMessage : undefined}
              onLoadEnd={() => setLoading(false)}
              startInLoadingState={false}
              javaScriptEnabled
              domStorageEnabled
              style={{ flex: 1 }}
            />
            {(loading || verifying) && (
              <View style={[styles.loadingOverlay, { backgroundColor: colors.background }]}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
                  {verifying ? "Verifying payment…" : "Loading payment gateway…"}
                </Text>
              </View>
            )}
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  title: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  closeBtn: { padding: 4 },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loadingText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  centerWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 14 },
  errorText: { fontSize: 15, fontFamily: "Inter_500Medium", textAlign: "center" },
  retryBtn: { borderRadius: 12, paddingVertical: 12, paddingHorizontal: 28, marginTop: 6 },
  retryBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
