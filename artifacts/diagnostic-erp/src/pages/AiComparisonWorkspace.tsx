// Phase 7A: AI Comparison Workspace
// Put the same images in front of several models and read the answers side by side.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/fetchApi";
import { dicomWebFetch, withDicomWebAuth } from "@/lib/browserDicomWeb";
import {
  frameOptions, instanceListUrl, parsePacsInstances, parsePacsSeries, pickKey, renderedImageUrl,
  seriesListUrl, type PacsInstance, type PacsSeries,
} from "@/lib/pacsImagePicker";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Terminal, Check, AlertTriangle, Copy, Trophy, Cloud, HardDrive,
  Clock, ImagePlus, Loader2, ScanLine, Trash2, X,
} from "lucide-react";

/** Mirrors the ceilings `aiComparison.ts` enforces server-side. The server decides;
 *  these numbers only stop the screen from sending a body it already knows is refused. */
const MAX_IMAGES = 6;
const MAX_ARMS = 6;

/** A provider's own name is not evidence of where it runs — `openai` pointed at a
 *  clinic LAN box is local and a "local" box on a public URL is not. The execution
 *  layer decides and reports `locality` per arm; this split is only how the chips
 *  are grouped before a run. */
const LOCAL_PROVIDER_NAMES = new Set(["ollama", "local_openai_compatible"]);

/**
 * The two sentences a doctor must see in a fixed shape.
 *
 * They are constants rather than derived prose because a warning that words itself
 * differently on every render is a warning that gets skimmed. The text-only one is
 * the wording the clinic asked for, verbatim, and it is paired with the option to
 * carry on anyway — CARE does not decide which models a radiologist may ask.
 */
const TEXT_ONLY_IMAGE_WARNING =
  "This model does not support image interpretation. Its response may be based only on the text prompt.";
const UNKNOWN_CAPABILITY_WARNING =
  "CARE could not confirm whether this model reads images, so its response may be based only on the text prompt.";

/** The card's own header for how the answer got its pictures. */
const BASIS_LABEL: Record<InterpretationBasis, string> = {
  "image-supplied": "Image-supplied response",
  "text-only": "Text-only response",
  "images-withheld": "Images not supplied",
  "submission-unverified": "Image submission unverified",
};

/**
 * The chip beside a local model's name. "vision-capable" is a statement about the
 * model, which is what `/api/show` answers; it is deliberately not "read your
 * images", which is a statement about one request and only the result card can
 * speak to that.
 */
const CAPABILITY_CHIP: Record<CapabilityState, string> = {
  "vision-confirmed": "vision-capable",
  "text-only": "text-only",
  "unknown": "capability unknown",
};

interface ProviderRow {
  name: string;
  label: string;
  models: string[];
}

/** Read from the server's own policy resolver — the one the run consults — so this
 *  screen can never show a looser rule than the gate applies. */
interface EgressPolicy {
  mode: "development" | "clinical";
  cloudVisionAllowed: boolean;
  requireAttestation: boolean;
}

interface SelectedArm {
  provider: string;
  model: string;
}

/** One selectable chip, plus whatever the server said about that model. */
interface ArmOption {
  arm: SelectedArm;
  label: string;
  local: boolean;
  capability: ModelCapability | null;
}

/**
 * What the server says about one model and images, and why it says it.
 * Mirrors `OllamaModelCapability` in `@workspace/ai-providers`. `state` is what the
 * badge shows; `detail` is the sentence naming the source, because "the model can
 * read images" and "the model's name looks like it can read images" are different
 * claims and a doctor is entitled to know which one CARE made.
 */
type CapabilityState = "vision-confirmed" | "text-only" | "unknown";

interface ModelCapability {
  state: CapabilityState;
  evidence: string;
  source: string;
  detail: string;
}

/** What CARE can prove about how ONE arm got its pictures. Mirrors the route. */
type InterpretationBasis =
  | "image-supplied"
  | "text-only"
  | "images-withheld"
  | "submission-unverified";

interface ComparisonResult {
  armIndex: number;
  provider: string;
  requestedModel: string | null;
  model: string | null;
  locality: "local" | "cloud" | null;
  attempted: boolean;
  imageCount: number;
  response: string;
  success: boolean;
  error: string | null;
  elapsedMs: number;
  imagesSelected: number;
  imagesSubmitted: number;
  providerAcceptedPayload: boolean | null;
  httpStatus: number | null;
  finishReason: string | null;
  answerTruncated: boolean;
  errorCode: string | null;
  visionCapability: ModelCapability;
  interpretationBasis: InterpretationBasis;
  interpretationBasisDetail: string;
}

interface SelectedImage {
  id: string;
  base64: string;
  previewUrl: string;
  label: string;
}

interface StudyRow {
  id: number;
  studyInstanceUid: string | null;
  patientName: string;
  accessionNumber: string | null;
  modality: string;
  testName: string | null;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function fileToBase64(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
  return dataUrl.split(",")[1] ?? "";
}

async function pacsFrameToBase64(
  studyUid: string,
  seriesUid: string,
  sopUid: string,
  frame: number | null,
): Promise<string> {
  const res = await dicomWebFetch(renderedImageUrl({ studyInstanceUid: studyUid, seriesUid, sopUid, frame }, 768));
  if (!res.ok) throw new Error(`PACS returned ${res.status} for that image.`);
  const blob = await res.blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Could not read the image PACS sent"));
    reader.readAsDataURL(blob);
  });
  return dataUrl.split(",")[1] ?? "";
}

export default function AiComparisonWorkspace() {
  const { toast } = useToast();
  const [prompt, setPrompt] = useState("");
  const [arms, setArms] = useState<SelectedArm[]>([]);
  const [images, setImages] = useState<SelectedImage[]>([]);
  const [results, setResults] = useState<ComparisonResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [winner, setWinner] = useState<number | null>(null);
  const [attest, setAttest] = useState(false);

  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [localModels, setLocalModels] = useState<string[]>([]);
  const [localModelsError, setLocalModelsError] = useState<string | null>(null);
  /** Per pulled tag, what the server's own `/api/show` said. Empty while probing. */
  const [localCapabilities, setLocalCapabilities] = useState<Record<string, ModelCapability>>({});
  const [policy, setPolicy] = useState<EgressPolicy | null>(null);

  const [studyUid, setStudyUid] = useState("");
  const [studies, setStudies] = useState<StudyRow[]>([]);
  const [studySearch, setStudySearch] = useState("");
  const [series, setSeries] = useState<PacsSeries[]>([]);
  const [activeSeries, setActiveSeries] = useState<PacsSeries | null>(null);
  const [instances, setInstances] = useState<PacsInstance[]>([]);
  const [browsing, setBrowsing] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [busyImage, setBusyImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void api.get<{ providers: ProviderRow[]; policy?: EgressPolicy }>("/api/ai-comparison/providers")
      .then((r) => {
        setProviders(r.providers ?? []);
        setPolicy(r.policy ?? null);
      })
      .catch(() => setProviders([]));
    void api.post<{
      ok: boolean;
      models?: string[];
      capabilities?: Record<string, ModelCapability>;
      error?: string;
    }>("/api/radiology-ollama/list-models", {})
      .then((r) => {
        if (r.ok) {
          setLocalModels(r.models ?? []);
          setLocalCapabilities(r.capabilities ?? {});
          setLocalModelsError(null);
        } else setLocalModelsError(r.error ?? "Ollama is not answering");
      })
      .catch((e: Error) => setLocalModelsError(e.message || "Ollama is not answering"));
  }, []);

  useEffect(() => {
    const q = studySearch.trim();
    // `/api/radiology/worklist` answers with a bare array, not an envelope.
    void api.get<StudyRow[]>(
      `/api/radiology/worklist?date=${encodeURIComponent(todayISO())}${q ? `&search=${encodeURIComponent(q)}` : ""}`
    )
      .then((rows) => setStudies(Array.isArray(rows) ? rows : []))
      .catch(() => setStudies([]));
  }, [studySearch]);

  const clearImages = useCallback(() => {
    setImages((prev) => {
      for (const p of prev) if (p.previewUrl.startsWith("blob:")) URL.revokeObjectURL(p.previewUrl);
      return [];
    });
  }, []);

  const openSeriesBrowser = useCallback(async (uid: string) => {
    if (!uid) return;
    setBrowsing(true);
    setBrowseError(null);
    setSeries([]);
    setInstances([]);
    setActiveSeries(null);
    try {
      const json = await api.get<unknown>(seriesListUrl(uid));
      const rows = parsePacsSeries(json);
      setSeries(rows);
      if (rows.length === 0) setBrowseError("This study has no series in PACS.");
    } catch (e: unknown) {
      setBrowseError(e instanceof Error ? e.message : "PACS could not be reached.");
    }
  }, []);

  const openInstances = useCallback(async (s: PacsSeries) => {
    if (!studyUid) return;
    setActiveSeries(s);
    setInstances([]);
    try {
      const json = await api.get<unknown>(instanceListUrl(studyUid, s.uid));
      setInstances(parsePacsInstances(json));
    } catch (e: unknown) {
      toast({ title: e instanceof Error ? e.message : "Could not list this series", variant: "destructive" });
    }
  }, [studyUid, toast]);

  const addImage = useCallback((img: SelectedImage) => {
    setImages((prev) => {
      if (prev.some((p) => p.id === img.id)) return prev;
      if (prev.length >= MAX_IMAGES) {
        toast({ title: `Up to ${MAX_IMAGES} images per comparison`, variant: "destructive" });
        return prev;
      }
      return [...prev, img];
    });
  }, [toast]);

  const removeImage = useCallback((id: string) => {
    setImages((prev) => {
      const gone = prev.find((p) => p.id === id);
      if (gone?.previewUrl.startsWith("blob:")) URL.revokeObjectURL(gone.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  }, []);

  const pickFromPacs = useCallback(async (s: PacsSeries, inst: PacsInstance, frame: number | null) => {
    if (!studyUid) return;
    const id = `pacs:${pickKey(inst.sopUid, frame)}`;
    if (images.some((i) => i.id === id)) { removeImage(id); return; }
    setBusyImage(id);
    try {
      const base64 = await pacsFrameToBase64(studyUid, s.uid, inst.sopUid, frame);
      addImage({
        id,
        base64,
        previewUrl: withDicomWebAuth(renderedImageUrl({ studyInstanceUid: studyUid, seriesUid: s.uid, sopUid: inst.sopUid, frame }, 220)) ?? "",
        label: `${s.modality || s.description || "PACS"} · ${s.description ? `${s.description.slice(0, 24)} · ` : ""}img ${inst.instanceNumber ?? "?"}${frame ? ` f${frame}` : ""}`,
      });
    } catch (e: unknown) {
      toast({ title: e instanceof Error ? e.message : "Could not fetch that image", variant: "destructive" });
    } finally {
      setBusyImage(null);
    }
  }, [studyUid, images, addImage, removeImage, toast]);

  const onFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
        toast({ title: `${file.name}: JPG, PNG or WebP only`, variant: "destructive" });
        continue;
      }
      try {
        const base64 = await fileToBase64(file);
        addImage({
          id: `file:${file.name}:${file.size}:${images.length}`,
          base64,
          previewUrl: URL.createObjectURL(file),
          label: `${file.name} (${Math.round(file.size / 1024)} KB)`,
        });
      } catch (e: unknown) {
        toast({ title: e instanceof Error ? e.message : "Could not read that file", variant: "destructive" });
      }
    }
  }, [addImage, images.length, toast]);

  const toggleArm = useCallback((arm: SelectedArm) => {
    setArms((prev) => {
      const hit = prev.findIndex((a) => a.provider === arm.provider && a.model === arm.model);
      if (hit >= 0) return prev.filter((_, i) => i !== hit);
      if (prev.length >= MAX_ARMS) {
        toast({ title: `Compare at most ${MAX_ARMS} models at a time`, variant: "destructive" });
        return prev;
      }
      return [...prev, arm];
    });
  }, [toast]);

  const cloudArmsSelected = arms.some((a) => !LOCAL_PROVIDER_NAMES.has(a.provider));

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const runLabel = `Compare ${plural(arms.length, "model")} on ${plural(images.length, "image")}`;

  const runComparison = async () => {
    if (!prompt.trim()) { toast({ title: "Enter a prompt", variant: "destructive" }); return; }
    if (arms.length === 0) { toast({ title: "Select at least one model", variant: "destructive" }); return; }

    setLoading(true);
    setResults([]);
    setWinner(null);
    try {
      const data = await api.post<{ results: ComparisonResult[] }>("/api/ai-comparison/run", {
        prompt,
        arms,
        images: images.map((i) => i.base64),
        ...(studyUid ? { studyInstanceUid: studyUid } : {}),
        // Only ever meaningful in Clinical mode; Development mode's standing decision
        // is the admin's cloud-vision setting, and this screen must not re-ask for it.
        ...(attest ? { attestCloudImageEgress: true } : {}),
      });
      setResults(data.results);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Failed", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveWinner = async (r: ComparisonResult) => {
    try {
      await api.post("/api/ai-comparison/save-winner", { prompt, provider: r.provider, model: r.model ?? r.requestedModel, response: r.response });
      setWinner(r.armIndex);
      toast({ title: `Kept: ${r.model ?? r.provider}` });
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Failed", variant: "destructive" });
    }
  };

  const armOptions = useMemo(() => {
    const out: ArmOption[] = [];
    for (const p of providers) {
      const local = LOCAL_PROVIDER_NAMES.has(p.name);
      const models = p.name === "ollama" && localModels.length > 0 ? localModels : p.models;
      for (const m of models) out.push({
        arm: { provider: p.name, model: m },
        label: `${p.label} · ${m}`,
        local,
        // Only Ollama reports its own capabilities, so only an Ollama chip has
        // anything to show. A cloud chip that said "unknown" next to a local one
        // that said "confirmed" would read as doubt about the local model.
        capability: p.name === "ollama" ? localCapabilities[m] ?? null : null,
      });
    }
    return out;
  }, [providers, localModels, localCapabilities]);

  const localOptions = armOptions.filter((o) => o.local);
  const cloudOptions = armOptions.filter((o) => !o.local);

  /**
   * The warning BEFORE the run, for the case that matters clinically: pictures are
   * chosen, a model that cannot see them is chosen too, and the doctor is about to
   * compare answers that are not answers to the same question. Shown per selected
   * model, once each, and it stops nothing — the doctor may still run it, and the
   * card will say afterwards what actually happened.
   */
  const capabilityNotices = useMemo(() => {
    if (images.length === 0) return [];
    const byModel = new Map<string, { model: string; text: string; tone: "text-only" | "unknown" }>();
    for (const a of arms) {
      if (a.provider !== "ollama" || !a.model) continue;
      const cap = localCapabilities[a.model];
      if (!cap || cap.state === "vision-confirmed") continue;
      if (byModel.has(a.model)) continue;
      byModel.set(a.model, {
        model: a.model,
        tone: cap.state === "text-only" ? "text-only" : "unknown",
        text: cap.state === "text-only" ? TEXT_ONLY_IMAGE_WARNING : UNKNOWN_CAPABILITY_WARNING,
      });
    }
    return [...byModel.values()];
  }, [arms, images.length, localCapabilities]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Image Comparison"
        subtitle="Select images, choose the models, and read their interpretations side by side"
      />

      {/* 1 — the study. Same worklist rows the reporting screens use. */}
      <div className="space-y-2 rounded-lg border bg-card p-3">
        <div className="flex items-center gap-2">
          <ScanLine className="h-4 w-4 text-indigo-600" />
          <span className="text-xs font-semibold uppercase tracking-wide">Study</span>
          <span className="text-[11px] text-muted-foreground">
            today · {studies.length} study/studies · typing filters the list
          </span>
        </div>
        <input
          value={studySearch}
          onChange={(e) => setStudySearch(e.target.value)}
          placeholder="Search by name, UHID or accession…"
          className="h-8 w-full rounded-md border bg-background px-2 text-xs"
          data-testid="comparison-study-search"
        />
        <select
          value={studyUid}
          onChange={(e) => {
            setStudyUid(e.target.value);
            // A different study means different patients' pictures.
            clearImages();
            setSeries([]); setActiveSeries(null); setInstances([]); setBrowseError(null);
            if (e.target.value) void openSeriesBrowser(e.target.value);
          }}
          className="h-8 w-full rounded-md border bg-background px-2 text-xs"
          data-testid="comparison-study-select"
        >
          <option value="">No study — compare uploaded images only</option>
          {studies.map((s) => (
            <option key={s.id} value={s.studyInstanceUid ?? ""} disabled={!s.studyInstanceUid}>
              {s.accessionNumber ?? "no accession"} · {s.patientName} · {s.modality} · {s.testName ?? ""}
              {s.studyInstanceUid ? "" : " (no DICOM study UID)"}
            </option>
          ))}
        </select>

        {studyUid && (
          <div className="space-y-1" data-testid="comparison-pacs-browser">
            {browsing && <p className="text-[11px] text-muted-foreground">Loading series…</p>}
            {browseError && <p className="text-[11px] text-red-600">{browseError}</p>}
            {series.map((s) => (
              <button
                key={s.uid}
                type="button"
                onClick={() => void openInstances(s)}
                className={`w-full flex items-center gap-2 rounded-md border px-2 py-1 text-left text-[11px] ${activeSeries?.uid === s.uid ? "bg-indigo-50 border-indigo-300" : "hover:bg-muted/50"}`}
              >
                <span className="flex-1 truncate font-medium">{s.description || s.modality || "Series"}</span>
                <span className="text-muted-foreground">{s.instanceCount ?? "?"} images</span>
              </button>
            ))}
            {activeSeries && (
              <div className="grid grid-cols-8 gap-1 rounded-md border p-1">
                {instances.map((inst) =>
                  (frameOptions(inst.numberOfFrames) ?? [null]).map((frame) => {
                    const id = `pacs:${pickKey(inst.sopUid, frame)}`;
                    const picked = images.some((i) => i.id === id);
                    const thumb = withDicomWebAuth(renderedImageUrl({
                      studyInstanceUid: studyUid, seriesUid: activeSeries.uid, sopUid: inst.sopUid, frame,
                    }, 120));
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => void pickFromPacs(activeSeries, inst, frame)}
                        title={picked ? "Remove from comparison" : "Add to comparison"}
                        className={`relative h-12 overflow-hidden rounded border-2 bg-black ${picked ? "border-indigo-500" : "border-transparent hover:border-muted-foreground/40"}`}
                        data-testid={`comparison-pacs-thumb-${id}`}
                      >
                        {busyImage === id
                          ? <Loader2 className="h-4 w-4 animate-spin text-white/70 absolute inset-0 m-auto" />
                          : thumb && <img src={thumb} alt="" className="h-full w-full object-contain" loading="lazy" />}
                        {picked && (
                          <span className="absolute top-0 right-0 rounded-bl bg-indigo-600 px-1 text-[9px] font-bold text-white">used</span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 2 — the images going into this run */}
      <div className="space-y-2 rounded-lg border bg-card p-3">
        <div className="flex items-center gap-2">
          <ImagePlus className="h-4 w-4 text-emerald-600" />
          <span className="text-xs font-semibold uppercase tracking-wide">Images</span>
          <Badge variant="outline" className="text-[10px]">{images.length}/{MAX_IMAGES}</Badge>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto h-7 text-[11px]"
            onClick={() => fileInputRef.current?.click()}
          >
            <ImagePlus className="h-3 w-3 mr-1" /> Upload JPG/PNG/WebP
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={(e) => { void onFiles(e.target.files); e.target.value = ""; }}
            data-testid="comparison-file-input"
          />
        </div>
        {images.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            No images selected. Pick them from PACS above, or upload screenshots from any viewer.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {images.map((img) => (
              <div key={img.id} className="relative rounded border bg-black/5 p-1" data-testid="comparison-image-thumb">
                <img src={img.previewUrl} alt={img.label} className="h-16 w-full object-contain rounded bg-muted" />
                <p className="truncate text-[9px] text-muted-foreground" title={img.label}>{img.label}</p>
                <button
                  type="button"
                  onClick={() => removeImage(img.id)}
                  className="absolute -right-1 -top-1 rounded-full bg-red-600 p-0.5 text-white hover:bg-red-700"
                  title="Remove"
                  data-testid="comparison-image-remove"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <p className="text-[10px] text-muted-foreground">
          These pictures are sent as they are. Anything identifying the patient in the pixels travels with them —
          window-level, annotations and burned-in names included.
        </p>
      </div>

      {/* 3 — the models */}
      <div className="space-y-3 rounded-lg border bg-card p-3">
        <div className="flex items-center gap-2">
          <HardDrive className="h-4 w-4 text-amber-600" />
          <span className="text-xs font-semibold uppercase tracking-wide">Models</span>
          <Badge variant="outline" className="text-[10px]">{arms.length}/{MAX_ARMS} selected</Badge>
          <span className="ml-auto text-[11px] text-muted-foreground" data-testid="comparison-security-mode">
            {policy ? (
              <>
                {policy.mode === "development" ? "Development mode" : "Clinical mode"}
                {" · cloud vision "}
                {policy.cloudVisionAllowed ? "enabled" : "not enabled"}
                {!policy.cloudVisionAllowed && (
                  <span data-testid="comparison-cloud-off-note"> — cloud arms will be refused until it is</span>
                )}
              </>
            ) : "…"}
          </span>
        </div>

        {localModelsError && (
          <p className="text-[11px] text-amber-700" data-testid="comparison-ollama-warning">
            Local models could not be listed ({localModelsError}). The configured local models below are still
            offered, and nothing here needs the internet.
          </p>
        )}

        <ArmGroup title="On-premises" options={localOptions} arms={arms} onToggle={toggleArm} />
        <ArmGroup title="Cloud" options={cloudOptions} arms={arms} onToggle={toggleArm} />

        {capabilityNotices.map((n) => (
          <div
            key={n.model}
            className={`flex items-start gap-2 rounded-md border p-2 text-[11px] ${
              n.tone === "text-only"
                ? "border-red-300 bg-red-50 text-red-800"
                : "border-amber-300 bg-amber-50 text-amber-800"
            }`}
            data-testid={`comparison-capability-warning-${n.model}`}
          >
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              <b>{n.model}</b>{" "}
              <span data-testid={`comparison-capability-warning-text-${n.model}`}>{n.text}</span>
              <span className="text-muted-foreground">
                {" "}You can still run it — the result card then says what actually happened to your images.
              </span>
            </span>
          </div>
        ))}

        {policy?.requireAttestation && cloudArmsSelected && (
          <label className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-[11px]">
            <input
              type="checkbox"
              checked={attest}
              onChange={(e) => setAttest(e.target.checked)}
              className="mt-0.5"
              data-testid="comparison-attest"
            />
            <span>
              <b>Cloud image transfer.</b> {policy.mode === "clinical" ? "Clinical mode" : "This mode"} asks the
              reporting clinician to confirm each run that puts pictures in front of a cloud model. Checking this
              records the confirmation against your own signed-in identity — the decision to allow cloud vision at
              all stays where it is set, not here. Development mode does not ask, because there the
              administrator&apos;s cloud-vision setting already is the decision.
            </span>
          </label>
        )}
      </div>

      <Textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="What should each model say about these images?"
        rows={5}
        className="text-sm"
        data-testid="comparison-prompt"
      />

      <Button onClick={runComparison} disabled={loading} className="w-full" data-testid="comparison-run">
        {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Terminal className="h-4 w-4 mr-1" />}
        {loading ? "Running…" : runLabel}
      </Button>

      {results.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {results.map((r) => (
            <div key={r.armIndex} className="border rounded-lg bg-card p-4 space-y-3" data-testid="comparison-result-card">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Badge variant="outline" className="text-[10px] shrink-0" data-testid="comparison-arm-provider">{r.provider}</Badge>
                  <span className="truncate text-xs font-semibold" title={r.model ?? ""} data-testid="comparison-arm-model">{r.model ?? r.requestedModel ?? "configured default"}</span>
                  <Badge
                    variant="outline"
                    className={`text-[9px] shrink-0 ${r.locality === "cloud" ? "border-violet-300 text-violet-800" : "border-emerald-300 text-emerald-800"}`}
                    data-testid="comparison-arm-locality"
                  >
                    {r.locality === "cloud" ? <Cloud className="h-2.5 w-2.5 mr-0.5" /> : <HardDrive className="h-2.5 w-2.5 mr-0.5" />}
                    {r.locality ?? "not run"}
                  </Badge>
                </div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                  <Clock className="h-3 w-3" /> {r.elapsedMs}ms
                </div>
              </div>

              {r.success ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="flex items-center gap-1 text-xs text-green-700">
                    <Check className="h-3 w-3" /> Answered
                  </span>
                  {/* The line this card used to print — `Answered · 2 image(s)` from
                      the count the REQUEST carried — said the same thing about an arm
                      that saw both pictures and an arm that was stopped before any
                      socket. This badge is derived from what the executor reported
                      came back, which is the only side worth reading. */}
                  <Badge
                    variant="outline"
                    className={`text-[9px] uppercase tracking-wide ${
                      r.interpretationBasis === "image-supplied"
                        ? "border-emerald-300 text-emerald-800"
                        : r.interpretationBasis === "text-only"
                          ? "border-slate-300 text-slate-700"
                          : "border-red-300 text-red-700"
                    }`}
                    title={r.interpretationBasisDetail}
                    data-testid="comparison-arm-basis"
                  >
                    {BASIS_LABEL[r.interpretationBasis]}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={`text-[9px] ${
                      r.visionCapability.state === "vision-confirmed"
                        ? "border-emerald-300 text-emerald-800"
                        : r.visionCapability.state === "text-only"
                          ? "border-red-300 text-red-700"
                          : "border-amber-300 text-amber-800"
                    }`}
                    title={`${r.visionCapability.detail} (${r.visionCapability.evidence})`}
                    data-testid="comparison-arm-capability"
                  >
                    {CAPABILITY_CHIP[r.visionCapability.state]}
                  </Badge>
                </div>
              ) : (
                <div className="text-[11px] rounded p-2 bg-red-50 text-red-700 border border-red-200" data-testid="comparison-arm-error">
                  <AlertTriangle className="h-3 w-3 inline mr-1" />
                  {r.error ?? "Failed"}
                </div>
              )}

              {(r.imagesSelected > 0 && r.visionCapability.state === "text-only") && (
                <p className="text-[11px] rounded p-2 bg-red-50 text-red-800 border border-red-200" data-testid="comparison-arm-text-only-warning">
                  <AlertTriangle className="h-3 w-3 inline mr-1" />
                  {TEXT_ONLY_IMAGE_WARNING}
                </p>
              )}
              {(r.imagesSelected > 0 && r.visionCapability.state === "unknown") && (
                <p className="text-[11px] rounded p-2 bg-amber-50 text-amber-800 border border-amber-200" data-testid="comparison-arm-unknown-warning">
                  <AlertTriangle className="h-3 w-3 inline mr-1" />
                  {UNKNOWN_CAPABILITY_WARNING}
                </p>
              )}

              <div className="text-[10px] text-muted-foreground space-y-0.5" data-testid="comparison-arm-provenance">
                <p>{r.interpretationBasisDetail}</p>
                <p>
                  Images selected {r.imagesSelected} · submitted {r.imagesSubmitted} · accepted by provider{" "}
                  {r.providerAcceptedPayload === null ? "not established" : r.providerAcceptedPayload ? "yes" : "no"}
                  {r.httpStatus != null ? ` · HTTP ${r.httpStatus}` : ""}
                  {r.errorCode ? ` · ${r.errorCode}` : ""}
                  {r.finishReason ? ` · stopped: ${r.finishReason}` : ""}
                  {" · "}{r.elapsedMs}ms
                </p>
                {r.answerTruncated && (
                  <p className="text-amber-700" data-testid="comparison-arm-truncated">
                    This answer stopped early ({r.finishReason}), so it is not a complete reading of the study.
                  </p>
                )}
              </div>

              {r.response ? (
                <div className="text-[11px] whitespace-pre-wrap bg-muted/30 rounded p-3 max-h-[340px] overflow-y-auto">
                  {r.response}
                </div>
              ) : null}

              {r.success && r.response ? (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="text-xs" onClick={() => { void navigator.clipboard.writeText(r.response); }}>
                    <Copy className="h-3 w-3 mr-1" /> Copy
                  </Button>
                  <Button
                    variant={winner === r.armIndex ? "default" : "outline"}
                    size="sm"
                    className="text-xs"
                    onClick={() => void handleSaveWinner(r)}
                  >
                    <Trophy className="h-3 w-3 mr-1" />
                    {winner === r.armIndex ? "Kept" : "Keep this one"}
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {results.length > 0 && (
        <div className="text-[11px] text-amber-700 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded p-2">
          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
          Every card above is a draft. Nothing here has touched the report or the observation ledger: reading these
          answers, and copying one into your own text, is your decision as the reporting radiologist.
        </div>
      )}

      {images.length > 0 && (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={clearImages} data-testid="comparison-clear-images">
            <Trash2 className="h-3 w-3 mr-1" /> Clear {images.length} image{images.length === 1 ? "" : "s"}
          </Button>
          <span className="text-[10px] text-muted-foreground">
            Clearing is the only way to switch studies: images selected for one patient must never ride into a
            comparison of another.
          </span>
        </div>
      )}
    </div>
  );
}

function ArmGroup({
  title,
  options,
  arms,
  onToggle,
}: {
  title: string;
  options: ArmOption[];
  arms: SelectedArm[];
  onToggle: (arm: SelectedArm) => void;
}) {
  if (options.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{title}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = arms.some((a) => a.provider === o.arm.provider && a.model === o.arm.model);
          return (
            <button
              key={`${o.arm.provider}:${o.arm.model}`}
              type="button"
              onClick={() => onToggle(o.arm)}
              className={`px-2 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                on
                  ? o.local
                    ? "bg-amber-100 text-amber-800 border-amber-400"
                    : "bg-violet-100 text-violet-800 border-violet-400"
                  : "bg-muted text-muted-foreground border-muted"
              }`}
              data-testid={`comparison-arm-${o.arm.provider}-${o.arm.model}`}
            >
              {on && <Check className="h-3 w-3 inline mr-1" />}
              {o.label}
              {o.capability && (
                <span
                  className={`ml-1 text-[9px] font-normal ${
                    o.capability.state === "vision-confirmed"
                      ? "text-emerald-700"
                      : o.capability.state === "text-only"
                        ? "text-red-700"
                        : "text-amber-700"
                  }`}
                  title={`${o.capability.detail} (${o.capability.evidence})`}
                  data-testid={`comparison-arm-capability-${o.arm.model}`}
                >
                  · {CAPABILITY_CHIP[o.capability.state]}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
