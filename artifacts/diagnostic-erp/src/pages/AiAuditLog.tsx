import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Search, ChevronLeft, ChevronRight, Clock, User, Monitor,
  Image, CheckCircle2, XCircle, ShieldCheck, FileText, Sparkles,
  AlertTriangle,
} from "lucide-react";

interface AuditLog {
  id: number;
  userId: number | null;
  userName: string | null;
  patientId: number | null;
  studyInstanceUID: string | null;
  accessionNumber: string | null;
  provider: string;
  model: string | null;
  promptText: string | null;
  numImages: number;
  anonymized: boolean;
  includedDemographics: boolean;
  wasInsertedToReport: boolean;
  draftId: number | null;
  success: boolean;
  errorMessage: string | null;
  createdAt: string;
}

const PAGE_SIZE = 25;

export default function AiAuditLog() {
  const { toast } = useToast();
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [detailRow, setDetailRow] = useState<AuditLog | null>(null);

  const { data: rows = [], isLoading, isError } = useQuery<AuditLog[]>({
    queryKey: ["ai-reporting-audit-log", offset, search.trim() || null],
    queryFn: async () => {
      const qs = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      const term = search.trim();
      if (term) {
        // The backend supports filtering by studyInstanceUID; if the search term looks
        // like a UID (contains dots and length > 8) pass it, otherwise rely on client-side.
        if (term.includes(".") && term.length > 8) qs.append("studyInstanceUID", term);
      }
      return api.get(`/api/ai-reporting/audit-log?${qs.toString()}`);
    },
  });

  const filtered = search.trim()
    ? rows.filter((r) => {
        const t = search.toLowerCase();
        return (
          (r.userName ?? "").toLowerCase().includes(t) ||
          (r.provider ?? "").toLowerCase().includes(t) ||
          (r.model ?? "").toLowerCase().includes(t) ||
          (r.studyInstanceUID ?? "").toLowerCase().includes(t) ||
          (r.accessionNumber ?? "").toLowerCase().includes(t)
        );
      })
    : rows;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
      <PageHeader
        title="AI Audit Log"
        subtitle="Every AI query is recorded here. Track which provider and model were used, whether the draft was inserted into a report, and whether patient demographics were included."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-2" disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}>
              <ChevronLeft size={14} /> Prev
            </Button>
            <Button variant="outline" size="sm" className="gap-2" disabled={rows.length < PAGE_SIZE} onClick={() => setOffset((o) => o + PAGE_SIZE)}>
              Next <ChevronRight size={14} />
            </Button>
          </div>
        }
      />

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-64">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search user, provider, study UID or accession number…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setOffset(0); }}
            className="pl-9 text-sm"
          />
        </div>
        <Badge variant="outline" className="h-9 px-3 text-xs font-normal">
          {offset + 1}–{offset + filtered.length}
        </Badge>
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Time</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">User</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Provider</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Model</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Status</th>
                <th className="text-center px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Images</th>
                <th className="text-center px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Inserted</th>
                <th className="text-center px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Privacy</th>
                <th className="text-center px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Detail</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">
                    <div className="animate-pulse">Loading audit logs…</div>
                  </td>
                </tr>
              )}
              {isError && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-destructive">
                    <AlertTriangle size={16} className="inline mr-1" /> Failed to load audit logs.
                  </td>
                </tr>
              )}
              {!isLoading && filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">
                    No audit logs found.
                  </td>
                </tr>
              )}
              {filtered.map((row) => (
                <tr key={row.id} className="border-t hover:bg-muted/30 transition-colors">
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Clock size={12} />
                      {new Date(row.createdAt).toLocaleString()}
                    </div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <User size={12} className="text-muted-foreground" />
                      <span className="text-xs">{row.userName ?? "—"}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Badge variant="secondary" className="text-[10px] h-5">
                      {row.provider}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-muted-foreground">
                    {row.model ?? "—"}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {row.success ? (
                      <span className="inline-flex items-center gap-1 text-xs text-green-600">
                        <CheckCircle2 size={12} /> Success
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-destructive">
                        <XCircle size={12} /> Failed
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center whitespace-nowrap">
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Image size={12} /> {row.numImages}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center whitespace-nowrap">
                    {row.wasInsertedToReport ? (
                      <span className="inline-flex items-center gap-1 text-xs text-green-600">
                        <FileText size={12} /> Yes
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Sparkles size={12} /> Draft
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center whitespace-nowrap">
                    <div className="inline-flex items-center gap-1">
                      {row.anonymized ? (
                        <Badge variant="outline" className="text-[10px] h-5 gap-1">
                          <ShieldCheck size={10} /> Anonymized
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] h-5 gap-1 border-amber-300 text-amber-700">
                          <AlertTriangle size={10} /> Identified
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-center whitespace-nowrap">
                    <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setDetailRow(row)}>
                      View
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail dialog */}
      <Dialog open={!!detailRow} onOpenChange={() => setDetailRow(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-sm">Audit Log Entry #{detailRow?.id}</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {detailRow && new Date(detailRow.createdAt).toLocaleString()}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">User</span>
                <p className="font-medium">{detailRow?.userName ?? "—"} {detailRow?.userId ? `(ID: ${detailRow.userId})` : ""}</p>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Patient ID</span>
                <p className="font-medium">{detailRow?.patientId ?? "—"}</p>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Provider</span>
                <p className="font-medium">{detailRow?.provider}</p>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Model</span>
                <p className="font-medium">{detailRow?.model ?? "—"}</p>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Study Instance UID</span>
                <p className="font-medium text-xs break-all">{detailRow?.studyInstanceUID ?? "—"}</p>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Accession Number</span>
                <p className="font-medium">{detailRow?.accessionNumber ?? "—"}</p>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Draft ID</span>
                <p className="font-medium">{detailRow?.draftId ?? "—"}</p>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Inserted to Report</span>
                <p className="font-medium">{detailRow?.wasInsertedToReport ? "Yes" : "No"}</p>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Anonymized</span>
                <p className="font-medium">{detailRow?.anonymized ? "Yes" : "No"}</p>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Demographics Included</span>
                <p className="font-medium">{detailRow?.includedDemographics ? "Yes" : "No"}</p>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Images Sent</span>
                <p className="font-medium">{detailRow?.numImages}</p>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Success</span>
                <p className="font-medium">{detailRow?.success ? "Yes" : "No"}</p>
              </div>
            </div>
            {detailRow?.promptText && (
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Prompt (truncated)</span>
                <div className="rounded border bg-muted/40 p-3 text-xs max-h-48 overflow-y-auto whitespace-pre-wrap">
                  {detailRow.promptText}
                </div>
              </div>
            )}
            {detailRow?.errorMessage && (
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Error</span>
                <div className="rounded border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                  {detailRow.errorMessage}
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
