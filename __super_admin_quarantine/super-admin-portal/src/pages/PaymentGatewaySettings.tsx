import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import {
  ArrowLeft, CreditCard, Shield, ToggleLeft, ToggleRight, Loader2, Save,
  CheckCircle, Globe, AlertCircle, FileImage
} from "lucide-react";
import { saAuthHeaders } from "@/lib/saApi";

interface ClinicSettings {
  id: number;
  activePaymentGateway: string;
  enableCardPayment: boolean;
  enableQrPayment: boolean;
  enableVipBooking: boolean;
  enablePaymentLogos: boolean;
  enablePaymentTimer: boolean;
  customIciciBannerUrl: string;
  customPhonepeBannerUrl: string;
  customBharatpeBannerUrl: string;
  customPayuBannerUrl: string;
  iciciMerchantId: string;
  iciciAggregatorId: string;
  iciciSecretKey: string;
  payuMerchantKey: string;
  phonepeMerchantId: string;
  bharatpeMerchantId: string;
  iciciEnabled: boolean;
  phonepeEnabled: boolean;
  bharatpeEnabled: boolean;
  payuEnabled: boolean;
  onlineBookingEnabled: boolean;
}

export default function PaymentGatewaySettings({ onBack }: { onBack: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery<ClinicSettings>({
    queryKey: ["/api/clinic-settings"],
    queryFn: async () => {
      const res = await fetch("/api/clinic-settings", { headers: saAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load clinic settings");
      return res.json();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (updatedFields: Partial<ClinicSettings>) => {
      const res = await fetch("/api/clinic-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...saAuthHeaders() },
        body: JSON.stringify(updatedFields),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Update failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Settings saved", description: "Payment settings updated successfully." });
      void queryClient.invalidateQueries({ queryKey: ["/api/clinic-settings"] });
    },
    onError: (e: Error) => {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    },
  });

  if (isLoading || !settings) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background">
        <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  const handleToggle = (key: keyof ClinicSettings, val: boolean) => {
    updateMutation.mutate({ [key]: val });
  };

  const handleSelectGateway = (gateway: string) => {
    updateMutation.mutate({ activePaymentGateway: gateway });
  };

  const handleFormSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data: Record<string, any> = {};
    fd.forEach((value, key) => {
      data[key] = value;
    });
    updateMutation.mutate(data);
  };

  const gateways = [
    { id: "icici", name: "ICICI Orange Pay", enabledKey: "iciciEnabled", activeKey: "iciciEnabled" },
    { id: "phonepe", name: "PhonePe PG", enabledKey: "phonepeEnabled", activeKey: "phonepeEnabled" },
    { id: "bharatpe", name: "BharatPe PG", enabledKey: "bharatpeEnabled", activeKey: "bharatpeEnabled" },
    { id: "payu", name: "PayU India", enabledKey: "payuEnabled", activeKey: "payuEnabled" },
  ];

  return (
    <div className="min-h-screen w-full bg-background p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={onBack}><ArrowLeft size={14} /></Button>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Payment Gateway Management</h1>
            <p className="text-sm text-muted-foreground">Manage active providers, dynamic toggles, transaction banners, and credentials.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Left: Toggles & Active Select */}
          <div className="md:col-span-1 space-y-4">
            <div className="bg-card border border-border rounded-xl p-5 space-y-4">
              <h2 className="text-sm font-bold tracking-wide uppercase text-muted-foreground flex items-center gap-1.5">
                <Globe size={14} className="text-primary" /> Active Gateway
              </h2>
              <div className="space-y-2">
                {gateways.map((g) => {
                  const isActive = settings.activePaymentGateway === g.id;
                  const isEnabled = settings[g.enabledKey as keyof ClinicSettings];
                  return (
                    <div
                      key={g.id}
                      onClick={() => isEnabled && handleSelectGateway(g.id)}
                      className={`p-3 rounded-lg border cursor-pointer transition-all flex justify-between items-center ${
                        isActive
                          ? "bg-primary/5 border-primary"
                          : isEnabled
                          ? "hover:bg-muted/50 border-border"
                          : "opacity-40 cursor-not-allowed border-border"
                      }`}
                    >
                      <div>
                        <p className="text-sm font-semibold">{g.name}</p>
                        <p className="text-xs text-muted-foreground">{isActive ? "Default Selected" : isEnabled ? "Click to set default" : "Disabled"}</p>
                      </div>
                      <Switch
                        checked={!!isEnabled}
                        onCheckedChange={(checked) => handleToggle(g.enabledKey as keyof ClinicSettings, checked)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="bg-card border border-border rounded-xl p-5 space-y-4">
              <h2 className="text-sm font-bold tracking-wide uppercase text-muted-foreground flex items-center gap-1.5">
                <Shield size={14} className="text-primary" /> Feature Toggles
              </h2>
              <div className="space-y-4 text-sm">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="font-semibold">Online Booking</p>
                    <p className="text-xs text-muted-foreground">Allow online diagnostic bookings</p>
                  </div>
                  <Switch checked={settings.onlineBookingEnabled} onCheckedChange={(c) => handleToggle("onlineBookingEnabled", c)} />
                </div>
                <div className="flex justify-between items-center">
                  <div>
                    <p className="font-semibold">Credit/Debit Cards</p>
                    <p className="text-xs text-muted-foreground">Enable card payment checkout</p>
                  </div>
                  <Switch checked={settings.enableCardPayment} onCheckedChange={(c) => handleToggle("enableCardPayment", c)} />
                </div>
                <div className="flex justify-between items-center">
                  <div>
                    <p className="font-semibold">UPI/QR Option</p>
                    <p className="text-xs text-muted-foreground">Enable checkout UPI QR codes</p>
                  </div>
                  <Switch checked={settings.enableQrPayment} onCheckedChange={(c) => handleToggle("enableQrPayment", c)} />
                </div>
                <div className="flex justify-between items-center">
                  <div>
                    <p className="font-semibold">VIP Bookings</p>
                    <p className="text-xs text-muted-foreground">Priority queue settings</p>
                  </div>
                  <Switch checked={settings.enableVipBooking} onCheckedChange={(c) => handleToggle("enableVipBooking", c)} />
                </div>
                <div className="flex justify-between items-center">
                  <div>
                    <p className="font-semibold">Payment Logos</p>
                    <p className="text-xs text-muted-foreground">Display partner gateway logos</p>
                  </div>
                  <Switch checked={settings.enablePaymentLogos} onCheckedChange={(c) => handleToggle("enablePaymentLogos", c)} />
                </div>
                <div className="flex justify-between items-center">
                  <div>
                    <p className="font-semibold">Payment Timer</p>
                    <p className="text-xs text-muted-foreground">Display 10-minute expiry clock</p>
                  </div>
                  <Switch checked={settings.enablePaymentTimer} onCheckedChange={(c) => handleToggle("enablePaymentTimer", c)} />
                </div>
              </div>
            </div>
          </div>

          {/* Right: Credentials & Banners */}
          <div className="md:col-span-2">
            <form onSubmit={handleFormSubmit} className="bg-card border border-border rounded-xl p-5 space-y-6">
              <h2 className="text-sm font-bold tracking-wide uppercase text-muted-foreground flex items-center gap-1.5">
                <CreditCard size={14} className="text-primary" /> Gateway Configurations
              </h2>

              <div className="space-y-4">
                {/* ICICI */}
                <div className="p-4 border border-border rounded-lg space-y-3 bg-muted/20">
                  <p className="text-xs font-bold uppercase text-primary tracking-wider">ICICI Bank Credentials</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Merchant ID</Label>
                      <Input name="iciciMerchantId" defaultValue={settings.iciciMerchantId} placeholder="Merchant ID" />
                    </div>
                    <div>
                      <Label className="text-xs">Aggregator ID</Label>
                      <Input name="iciciAggregatorId" defaultValue={settings.iciciAggregatorId} placeholder="Aggregator ID" />
                    </div>
                    <div className="md:col-span-2">
                      <Label className="text-xs">Secret Key</Label>
                      <Input name="iciciSecretKey" type="password" defaultValue={settings.iciciSecretKey} placeholder="Secret Key" />
                    </div>
                    <div className="md:col-span-2">
                      <Label className="text-xs">Custom Banner URL</Label>
                      <Input name="customIciciBannerUrl" defaultValue={settings.customIciciBannerUrl} placeholder="https://..." />
                    </div>
                  </div>
                </div>

                {/* PhonePe */}
                <div className="p-4 border border-border rounded-lg space-y-3 bg-muted/20">
                  <p className="text-xs font-bold uppercase text-primary tracking-wider">PhonePe Settings</p>
                  <div className="grid grid-cols-1 gap-3">
                    <div>
                      <Label className="text-xs">Merchant ID</Label>
                      <Input name="phonepeMerchantId" defaultValue={settings.phonepeMerchantId} placeholder="Merchant ID" />
                    </div>
                    <div>
                      <Label className="text-xs">Custom Banner URL</Label>
                      <Input name="customPhonepeBannerUrl" defaultValue={settings.customPhonepeBannerUrl} placeholder="https://..." />
                    </div>
                  </div>
                </div>

                {/* BharatPe */}
                <div className="p-4 border border-border rounded-lg space-y-3 bg-muted/20">
                  <p className="text-xs font-bold uppercase text-primary tracking-wider">BharatPe Settings</p>
                  <div className="grid grid-cols-1 gap-3">
                    <div>
                      <Label className="text-xs">Merchant ID</Label>
                      <Input name="bharatpeMerchantId" defaultValue={settings.bharatpeMerchantId} placeholder="Merchant ID" />
                    </div>
                    <div>
                      <Label className="text-xs">Custom Banner URL</Label>
                      <Input name="customBharatpeBannerUrl" defaultValue={settings.customBharatpeBannerUrl} placeholder="https://..." />
                    </div>
                  </div>
                </div>

                {/* PayU */}
                <div className="p-4 border border-border rounded-lg space-y-3 bg-muted/20">
                  <p className="text-xs font-bold uppercase text-primary tracking-wider">PayU India Settings</p>
                  <div className="grid grid-cols-1 gap-3">
                    <div>
                      <Label className="text-xs">Merchant Key</Label>
                      <Input name="payuMerchantKey" defaultValue={settings.payuMerchantKey} placeholder="Merchant Key" />
                    </div>
                    <div>
                      <Label className="text-xs">Custom Banner URL</Label>
                      <Input name="customPayuBannerUrl" defaultValue={settings.customPayuBannerUrl} placeholder="https://..." />
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-3 border-t border-border">
                <Button type="submit" disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? <Loader2 className="animate-spin mr-1.5" size={14} /> : <Save className="mr-1.5" size={14} />}
                  Save Configurations
                </Button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
