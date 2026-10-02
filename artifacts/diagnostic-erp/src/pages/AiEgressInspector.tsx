import { useState } from "react";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  ShieldCheck, AlertTriangle, Eye, Cloud, HardDrive, Image as ImageIcon,
} from "lucide-react";

type Preview = {
  generatedAt: string;
  destination: {
    provider: string;
    model: string | null;
    execution: "LOCAL" | "CLOUD";
    routedBy: string;
    providerConfigured: boolean;
  };
  images: {
    requested: number;
    seriesSelected: number;
    count: number;
    totalBytes: number;
    perImageBytes: number[];
    frames: string[];
  };
  prompt: {
    chars: number;
    identifierCategories: string[];
    scrubbed: string;
    fieldsRedacted: number;
    wouldBeRedacted: boolean;
  };
  gates: { cloudVisionAllowed: boolean; cloudTextPhiAllowed: boolean };
  verdict: { allowed: boolean; code: string | null; reason: string };
};

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Read-only preview of one AI send. Nothing here calls a model — it renders the
 * same images and prompt text the send path would put on the wire, and applies
 * the same gates, so a claim in Settings can be checked against an artefact.
 */
export default function AiEgressInspector() {
  const { toast } = useToast();
  const [studyUID, setStudyUID] = useState("");
  const [promptText, setPromptText] = useState("");
  const [maxImages, setMaxImages] = useState("6");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Preview | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const r = await api.post<Preview>("/api/ai-reporting/egress-preview", {
        studyInstanceUID: studyUID.trim(),
        promptText,
        maxImages: Number(maxImages) || 0,
      });
      setResult(r);
    } catch (e: unknown) {
      toast({
        title: "Preview failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  const cloud = result?.destination.execution === "CLOUD";

  return (
    <div className="p-4 sm:p-6 max-w-5xl">
      <PageHeader
        title="AI Egress Inspector"
        subtitle="See exactly what would leave the clinic in one AI request — the images, the prompt, and the verdict. No model is called."
      />

      <div className="grid gap-3 my-4 rounded-xl border bg-muted/30 p-4">
        <label className="text-xs font-semibold">Study Instance UID</label>
        <Input
          value={studyUID}
          onChange={(e) => setStudyUID(e.target.value)}
          placeholder="1.2.840.113619.2.55.3.xxxx — leave blank to preview text only"
          className="font-mono text-xs"
        />

        <label className="text-xs font-semibold mt-2">Prompt / findings text</label>
        <textarea
          value={promptText}
          onChange={(e) => setPromptText(e.target.value)}
          rows={7}
          placeholder="Paste the report body or the prompt you intend to send."
          className="w-full rounded-md border bg-background p-2 text-xs font-mono"
        />

        <div className="flex items-end gap-3">
          <div>
            <label className="text-xs font-semibold block mb-1">Images (max 6)</label>
            <Input
              type="number"
              min={0}
              max={6}
              value={maxImages}
              onChange={(e) => setMaxImages(e.target.value)}
              className="w-24 text-xs"
            />
          </div>
          <Button onClick={() => void run()} disabled={busy} size="sm">
            <Eye size={13} className="mr-1" />
            {busy ? "Checking…" : "Preview what would be sent"}
          </Button>
        </div>
      </div>

      {result && (
        <div className="space-y-4">
          <div
            className={`rounded-xl border p-4 flex gap-3 ${
              result.verdict.allowed
                ? "border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20"
                : "border-red-200 bg-red-50 dark:bg-red-950/20"
            }`}
          >
            {result.verdict.allowed ? (
              <ShieldCheck size={18} className="text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle size={18} className="text-red-600 shrink-0 mt-0.5" />
            )}
            <div className="text-xs">
              <p className={`font-semibold ${result.verdict.allowed ? "text-emerald-800 dark:text-emerald-300" : "text-red-800 dark:text-red-300"}`}>
                {result.verdict.allowed ? "Would be sent" : "Would be blocked"}
                {result.verdict.code ? ` — ${result.verdict.code}` : ""}
              </p>
              <p className="text-muted-foreground mt-0.5">{result.verdict.reason}</p>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div className="rounded-xl border p-3 text-xs space-y-1">
              <p className="font-semibold text-muted-foreground">Destination</p>
              <p className="flex items-center gap-1.5">
                {cloud ? <Cloud size={12} /> : <HardDrive size={12} />}
                <span className="font-mono">{result.destination.provider}</span>
                <Badge variant="outline" className={cloud ? "text-amber-700 border-amber-300" : "text-emerald-700 border-emerald-300"}>
                  {result.destination.execution}
                </Badge>
              </p>
              <p className="text-muted-foreground font-mono">{result.destination.model ?? "no model configured"}</p>
              <p className="text-muted-foreground">routed by {result.destination.routedBy}</p>
              {!result.destination.providerConfigured && (
                <p className="text-amber-700">This provider is not enabled in AI Reporting Settings.</p>
              )}
            </div>

            <div className="rounded-xl border p-3 text-xs space-y-1">
              <p className="font-semibold text-muted-foreground">Payload</p>
              <p className="flex items-center gap-1.5">
                <ImageIcon size={12} />
                {result.images.count} image(s) from {result.images.seriesSelected} series · {bytes(result.images.totalBytes)}
              </p>
              <p>{result.prompt.chars} characters of prompt</p>
              <p className="text-muted-foreground">
                gates: cloud vision {result.gates.cloudVisionAllowed ? "allowed" : "off"} · cloud text{" "}
                {result.gates.cloudTextPhiAllowed ? "allowed" : "off"}
              </p>
            </div>
          </div>

          <div className="rounded-xl border p-3 text-xs">
            <p className="font-semibold text-muted-foreground mb-2">Identifiers in the prompt</p>
            {result.prompt.identifierCategories.length === 0 ? (
              <p className="text-emerald-700">None detected. The text reads as clinical content, not as a named patient.</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {result.prompt.identifierCategories.map((c) => (
                    <Badge key={c} variant="outline" className="text-red-700 border-red-300">{c}</Badge>
                  ))}
                </div>
                <p className="text-muted-foreground mb-1">
                  {result.prompt.wouldBeRedacted
                    ? `Would be sent with ${result.prompt.fieldsRedacted} field(s) redacted:`
                    : `Would be sent verbatim, identifiers included (${result.prompt.fieldsRedacted} field(s) could be redacted if cloud text were allowed):`}
                </p>
                <pre className="whitespace-pre-wrap rounded bg-muted/40 p-2 font-mono text-[11px] max-h-56 overflow-auto">
{result.prompt.wouldBeRedacted ? result.prompt.scrubbed : promptText}
                </pre>
              </>
            )}
          </div>

          {result.images.frames.length > 0 && (
            <div className="rounded-xl border p-3">
              <p className="text-xs font-semibold text-muted-foreground mb-2">
                The exact images that would be sent
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {result.images.frames.map((src, i) => (
                  <figure key={i} className="space-y-1">
                    <img src={src} alt={`frame ${i + 1}`} className="w-full rounded border bg-black object-contain" />
                    <figcaption className="text-[10px] text-muted-foreground text-center">
                      {bytes(result.images.perImageBytes[i] ?? 0)}
                    </figcaption>
                  </figure>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground mt-2">
                Anything written into the pixels by the scanner — typically the corner on ultrasound — travels with
                the image and cannot be removed by a metadata strip. Check these corners.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
