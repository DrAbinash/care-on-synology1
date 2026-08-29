import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, PlayCircle, RefreshCw } from "lucide-react";

type Settings = {
  integrationEnabled: boolean;
  autoImport: boolean;
  autoSendHope: boolean;
  importEnabledAt: string | null;
  pollIntervalSeconds: number;
  bridgeUrl: string;
  bridgeSecretConfigured: boolean;
};

type SelfTestStage = { stage: string; status: string; detail?: string; ms?: number };

export default function ElectronicFilmSettingsPage() {
  const qc = useQueryClient();
  const [testResult, setTestResult] = useState<{ stages: SelfTestStage[]; summary: Record<string, number> } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["electronic-film-settings"],
    queryFn: () => api.get<{ settings: Settings }>("/electronic-film/settings"),
  });

  const save = useMutation({
    mutationFn: (patch: Partial<Settings> & { activateCutoverNow?: boolean }) =>
      api.put("/electronic-film/settings", patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["electronic-film-settings"] }),
  });

  const poll = useMutation({
    mutationFn: () => api.post("/electronic-film/poll", {}),
  });

  const selfTest = useMutation({
    mutationFn: async () => {
      const r = await api.post<{ stages: SelfTestStage[]; summary: Record<string, number> }>("/electronic-film/self-test", {});
      setTestResult(r);
      return r;
    },
  });

  const s = data?.settings;
  if (isLoading || !s) return <div className="p-6 text-sm text-muted-foreground">Loading electronic film settings…</div>;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-lg font-semibold">Electronic Film Integration</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Rollout controls</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Integration ON</Label>
            <Switch checked={s.integrationEnabled} onCheckedChange={(v) => save.mutate({ integrationEnabled: v })} />
          </div>
          <div className="flex items-center justify-between">
            <Label>Auto Import from DicomToWindows</Label>
            <Switch checked={s.autoImport} onCheckedChange={(v) => save.mutate({ autoImport: v })} />
          </div>
          <div className="flex items-center justify-between">
            <Label>Auto Send to HOPE</Label>
            <Switch checked={s.autoSendHope} onCheckedChange={(v) => save.mutate({ autoSendHope: v })} />
          </div>
          <p className="text-xs text-muted-foreground">
            Cutover: {s.importEnabledAt ?? "not set — jobs before activation are ignored"}
          </p>
          <Button size="sm" variant="outline" onClick={() => save.mutate({ activateCutoverNow: true })}>
            Set cutover to now
          </Button>
          <p className="text-xs text-muted-foreground">Bridge: {s.bridgeUrl || "unset"} {s.bridgeSecretConfigured ? "✓ secret" : "✗ no secret"}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Operations</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => poll.mutate()} disabled={poll.isPending}>
            {poll.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}
            Retry CARE Import
          </Button>
          <Button size="sm" onClick={() => selfTest.mutate()} disabled={selfTest.isPending}>
            {selfTest.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <PlayCircle className="mr-1 h-4 w-4" />}
            Run Electronic Film Pipeline Test
          </Button>
        </CardContent>
      </Card>

      {testResult && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Pipeline self-test</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {testResult.stages.map((st) => (
              <div key={st.stage} className="flex items-center gap-2 text-xs">
                <Badge variant={st.status === "PASS" ? "default" : st.status === "FAIL" ? "destructive" : "secondary"}>
                  {st.status}
                </Badge>
                <span>{st.stage}</span>
                {st.detail && <span className="text-muted-foreground">{st.detail}</span>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
