import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { useToast } from "@/hooks/use-toast";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Clock, FileText } from "lucide-react";

interface SearchResult {
  id: number;
  documentId: string;
  documentType: string;
  content: string;
  modality: string | null;
  sourceTitle: string | null;
  score: number | null;
}

interface SearchHistoryItem {
  id: number;
  queryText: string;
  topK: number;
  durationMs: number | null;
  userName: string | null;
  createdAt: string;
}

export default function AiSearchRetrieval() {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [modality, setModality] = useState("");
  const [topK, setTopK] = useState("5");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [totalMatches, setTotalMatches] = useState(0);
  const [durationMs, setDurationMs] = useState(0);

  const searchMutation = useMutation({
    mutationFn: async () => {
      return await api.post<{ results: SearchResult[]; totalMatches: number; durationMs: number; note: string }>("/api/ai-reporting/rag-search", {
        query,
        modality: modality || undefined,
        topK: Number(topK) || 5,
      });
    },
    onSuccess: (data) => {
      setResults(data.results);
      setTotalMatches(data.totalMatches);
      setDurationMs(data.durationMs);
    },
    onError: (e) => toast({ title: "Error", description: String(e), variant: "destructive" }),
  });

  const { data: history = [], isLoading: historyLoading } = useQuery({
    queryKey: ["ragSearchHistory"],
    queryFn: async () => {
      return await api.get<SearchHistoryItem[]>("/api/ai-reporting/rag-search-history?limit=25");
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Search & Retrieval"
        subtitle="Phase 10 — Semantic search over RAG documents. Currently text-based (embedding engine on-prem required for full semantic search)."
      />
      <Card>
        <CardContent className="space-y-4 p-6">
          <div className="flex gap-3">
            <div className="flex-1">
              <Label className="text-sm">Query</Label>
              <Input placeholder="Enter search query" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div className="w-32">
              <Label className="text-sm">Modality</Label>
              <Input placeholder="MRI/CT" value={modality} onChange={(e) => setModality(e.target.value)} />
            </div>
            <div className="w-24">
              <Label className="text-sm">Top K</Label>
              <Input value={topK} onChange={(e) => setTopK(e.target.value)} />
            </div>
            <div className="flex items-end">
              <Button onClick={() => searchMutation.mutate()} disabled={!query.trim() || searchMutation.isPending}>
                <Search className="w-4 h-4 mr-1" /> Search
              </Button>
            </div>
          </div>
          {results.length > 0 && (
            <div className="text-sm text-muted-foreground">
              Found {totalMatches} matches in {durationMs}ms
            </div>
          )}
        </CardContent>
      </Card>

      {results.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Document ID</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Modality</TableHead>
                  <TableHead>Content Preview</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.documentId}</TableCell>
                    <TableCell><Badge variant="outline">{r.documentType}</Badge></TableCell>
                    <TableCell>{r.modality ?? "—"}</TableCell>
                    <TableCell className="max-w-sm">{r.content}</TableCell>
                    <TableCell>{r.sourceTitle ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Clock className="w-4 h-4" /> Search History
        </h3>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Query</TableHead>
                  <TableHead>Top K</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historyLoading && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-6 text-muted-foreground">Loading…</TableCell>
                  </TableRow>
                )}
                {!historyLoading && history.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-6 text-muted-foreground">No search history yet.</TableCell>
                  </TableRow>
                )}
                {history.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell className="font-mono text-xs">{h.queryText}</TableCell>
                    <TableCell>{h.topK}</TableCell>
                    <TableCell>{h.durationMs ? `${h.durationMs}ms` : "—"}</TableCell>
                    <TableCell>{h.userName ?? "—"}</TableCell>
                    <TableCell>{new Date(h.createdAt).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
