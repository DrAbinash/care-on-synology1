import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { api } from "@/lib/fetchApi";
import { isFeatureEnabled } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, RefreshCw, Search, Trash2, ExternalLink } from "lucide-react";
import { RadiologyRolloutFlagsPanel } from "@/components/radiology/RadiologyRolloutFlagsPanel";
import {
  RADIOLOGY_CATALOG_API,
  catalogStatusBadgeClass,
  listFindings,
  listFindingCategories,
  listParameterGroups,
  getFindingGraph,
  deleteCatalogEdge,
  type FindingRow,
  type FindingCategoryRow,
  type ParameterGroupRow,
  type FindingGraph,
  type CatalogEdgeTable,
} from "@/lib/radiologyCatalogApi";

const CONTENT_LINKS = [
  { label: "Quick Select (legacy tiles)", href: "/settings/radiology?tab=quick-select" },
  { label: "Structured report templates", href: "/radiology/structured-report-templates" },
  { label: "Normal one-click templates", href: "/radiology/normal-templates" },
  { label: "Knowledge packs", href: "/settings/radiology/knowledge-packs" },
  { label: "Measurement registry", href: "/measurement-registry" },
  { label: "Content coverage", href: "/settings/radiology/content-coverage" },
];

type Props = { embedded?: boolean };

export function RadiologyCatalogPanel({ embedded = false }: Props) {
  const catalogOn = isFeatureEnabled("ff_radiology_catalog");
  const [tab, setTab] = useState("findings");
  const [search, setSearch] = useState("");
  const [selectedFindingId, setSelectedFindingId] = useState<number | null>(null);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const enabledProbe = useQuery({
    queryKey: ["radiology-catalog-probe"],
    queryFn: async () => {
      await api.get(`${RADIOLOGY_CATALOG_API}/parameter-groups?limit=1`);
      return true;
    },
    enabled: catalogOn,
    retry: false,
  });

  const apiReady = catalogOn && enabledProbe.isSuccess;

  const { data: findings = [], isLoading: findingsLoading, refetch: refetchFindings } = useQuery({
    queryKey: ["radiology-catalog-findings", search],
    queryFn: () => listFindings(search),
    enabled: apiReady,
  });

  const { data: categories = [], isLoading: categoriesLoading } = useQuery({
    queryKey: ["radiology-catalog-categories", search],
    queryFn: () => listFindingCategories(search),
    enabled: apiReady,
  });

  const { data: parameterGroups = [], isLoading: groupsLoading } = useQuery({
    queryKey: ["radiology-catalog-parameter-groups", search],
    queryFn: () => listParameterGroups(search),
    enabled: apiReady && tab === "parameters",
  });

  const { data: findingGraph, isLoading: graphLoading } = useQuery({
    queryKey: ["radiology-catalog-finding-graph", selectedFindingId],
    queryFn: () => getFindingGraph(selectedFindingId!),
    enabled: apiReady && selectedFindingId != null,
  });

  const invalidateCatalog = () => {
    void qc.invalidateQueries({ queryKey: ["radiology-catalog-findings"] });
    void qc.invalidateQueries({ queryKey: ["radiology-catalog-categories"] });
    void qc.invalidateQueries({ queryKey: ["radiology-catalog-parameter-groups"] });
    if (selectedFindingId) {
      void qc.invalidateQueries({ queryKey: ["radiology-catalog-finding-graph", selectedFindingId] });
    }
  };

  const createFinding = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post(`${RADIOLOGY_CATALOG_API}/findings`, body),
    onSuccess: () => {
      invalidateCatalog();
      toast({ title: "Finding created" });
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  const createCategory = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post(`${RADIOLOGY_CATALOG_API}/finding-categories`, body),
    onSuccess: () => {
      invalidateCatalog();
      toast({ title: "Category created" });
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  const createGroup = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post(`${RADIOLOGY_CATALOG_API}/parameter-groups`, body),
    onSuccess: () => {
      invalidateCatalog();
      toast({ title: "Parameter group created" });
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  const deleteFinding = useMutation({
    mutationFn: (id: number) => api.delete(`${RADIOLOGY_CATALOG_API}/findings/${id}`),
    onSuccess: () => {
      setSelectedFindingId(null);
      invalidateCatalog();
      toast({ title: "Finding archived" });
    },
    onError: (e: Error) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const addSynonym = useMutation({
    mutationFn: ({ id, synonym }: { id: number; synonym: string }) =>
      api.post(`${RADIOLOGY_CATALOG_API}/findings/${id}/synonyms`, { synonym }),
    onSuccess: () => invalidateCatalog(),
    onError: (e: Error) => toast({ title: "Add synonym failed", description: e.message, variant: "destructive" }),
  });

  const addAlias = useMutation({
    mutationFn: ({ id, aliasKey }: { id: number; aliasKey: string }) =>
      api.post(`${RADIOLOGY_CATALOG_API}/findings/${id}/aliases`, { aliasKey, source: "admin-ui" }),
    onSuccess: () => invalidateCatalog(),
    onError: (e: Error) => toast({ title: "Add alias failed", description: e.message, variant: "destructive" }),
  });

  const removeEdge = useMutation({
    mutationFn: ({ table, id }: { table: CatalogEdgeTable; id: number }) => deleteCatalogEdge(table, id),
    onSuccess: () => invalidateCatalog(),
    onError: (e: Error) => toast({ title: "Remove failed", description: e.message, variant: "destructive" }),
  });

  const categoryOptions = useMemo(
    () => categories.length ? categories : (findingGraph?.category ? [findingGraph.category] : []),
    [categories, findingGraph],
  );

  if (!catalogOn) {
    return (
      <div className="space-y-4">
        {!embedded && (
          <PageHeader
            title="Radiology content catalog"
            subtitle="Canonical findings, parameters, and aliases — separate from legacy Quick Select tiles."
          />
        )}
        <RadiologyRolloutFlagsPanel />
        <p className="text-xs text-muted-foreground">
          After enabling <code className="font-mono text-[11px]">ff_radiology_catalog</code>, reload this page to manage the catalog API.
        </p>
      </div>
    );
  }

  if (enabledProbe.isError) {
    return (
      <div className="space-y-4">
        {!embedded && (
          <PageHeader title="Radiology content catalog" subtitle="Catalog flag is ON but API returned an error." />
        )}
        <Card className="border-amber-300 bg-amber-50/50">
          <CardContent className="py-4 text-sm text-amber-900">
            Flag is enabled in the database but <code>/api/radiology/catalog</code> is not reachable.
            Restart the API after toggling flags, or set <code>FF_RADIOLOGY_CATALOG=true</code> in the API environment as a dev override.
          </CardContent>
        </Card>
        <RadiologyRolloutFlagsPanel />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!embedded && (
        <PageHeader
          title="Radiology content catalog"
          subtitle="Canonical finding graph (parameters, categories, aliases). Legacy Quick Select and templates remain on their own admin pages."
          actions={
            <Button variant="outline" size="sm" onClick={() => void refetchFindings()}>
              <RefreshCw className="h-4 w-4 mr-1" /> Refresh
            </Button>
          }
        />
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="hub">Hub</TabsTrigger>
          <TabsTrigger value="findings">Findings</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="parameters">Parameters</TabsTrigger>
        </TabsList>

        <TabsContent value="hub" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm">Related clinical content (not in catalog API)</CardTitle>
            </CardHeader>
            <CardContent className="grid sm:grid-cols-2 gap-2">
              {CONTENT_LINKS.map((l) => (
                <Button
                  key={l.href}
                  variant="outline"
                  className="justify-start h-auto py-2 text-left"
                  onClick={() => navigate(l.href)}
                >
                  <ExternalLink className="h-3.5 w-3.5 mr-2 shrink-0" />
                  <span className="text-xs">{l.label}</span>
                </Button>
              ))}
            </CardContent>
          </Card>
          <RadiologyRolloutFlagsPanel
            title="Catalog rollout"
            subtitle="Disable ff_radiology_catalog to hide the API (404) without deleting data."
          />
        </TabsContent>

        <TabsContent value="findings" className="space-y-4 mt-4">
          <div className="flex flex-wrap gap-2 items-end">
            <div className="space-y-1 flex-1 min-w-[200px]">
              <Label className="text-xs">Search findings</Label>
              <div className="relative">
                <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
                <Input className="pl-8 h-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Label or key" />
              </div>
            </div>
            <CreateFindingDialog
              categories={categoryOptions}
              onCreate={(body) => createFinding.mutate(body)}
              pending={createFinding.isPending}
            />
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Key</TableHead>
                      <TableHead>Label</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {findingsLoading && (
                      <TableRow><TableCell colSpan={3} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>
                    )}
                    {!findingsLoading && findings.length === 0 && (
                      <TableRow><TableCell colSpan={3} className="text-center py-6 text-muted-foreground">No findings yet.</TableCell></TableRow>
                    )}
                    {findings.map((f: FindingRow) => (
                      <TableRow
                        key={f.id}
                        className={`cursor-pointer ${selectedFindingId === f.id ? "bg-muted/60" : ""}`}
                        onClick={() => setSelectedFindingId(f.id)}
                      >
                        <TableCell className="font-mono text-xs">{f.key}</TableCell>
                        <TableCell className="text-xs">{f.label}</TableCell>
                        <TableCell>
                          <Badge className={`text-[10px] ${catalogStatusBadgeClass(f.status)}`}>{f.status}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <FindingDetailPanel
              graph={findingGraph}
              loading={graphLoading}
              selectedId={selectedFindingId}
              onDeleteFinding={() => selectedFindingId && deleteFinding.mutate(selectedFindingId)}
              onAddSynonym={(synonym) => selectedFindingId && addSynonym.mutate({ id: selectedFindingId, synonym })}
              onAddAlias={(aliasKey) => selectedFindingId && addAlias.mutate({ id: selectedFindingId, aliasKey })}
              onRemoveEdge={(table, id) => removeEdge.mutate({ table, id })}
            />
          </div>
        </TabsContent>

        <TabsContent value="categories" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <CreateCategoryDialog onCreate={(b) => createCategory.mutate(b)} pending={createCategory.isPending} />
          </div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Key</TableHead>
                    <TableHead>Label</TableHead>
                    <TableHead>Modality</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {categoriesLoading && (
                    <TableRow><TableCell colSpan={4} className="text-center py-6">Loading…</TableCell></TableRow>
                  )}
                  {categories.map((c: FindingCategoryRow) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono text-xs">{c.key}</TableCell>
                      <TableCell className="text-xs">{c.label}</TableCell>
                      <TableCell className="text-xs">{c.modality ?? "—"}</TableCell>
                      <TableCell><Badge className={`text-[10px] ${catalogStatusBadgeClass(c.status)}`}>{c.status}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="parameters" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <CreateParameterGroupDialog onCreate={(b) => createGroup.mutate(b)} pending={createGroup.isPending} />
          </div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Key</TableHead>
                    <TableHead>Label</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groupsLoading && (
                    <TableRow><TableCell colSpan={4} className="text-center py-6">Loading…</TableCell></TableRow>
                  )}
                  {parameterGroups.map((g: ParameterGroupRow) => (
                    <TableRow key={g.id}>
                      <TableCell className="font-mono text-xs">{g.key}</TableCell>
                      <TableCell className="text-xs">{g.label}</TableCell>
                      <TableCell className="text-xs">{g.dataType}</TableCell>
                      <TableCell><Badge className={`text-[10px] ${catalogStatusBadgeClass(g.status)}`}>{g.status}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function RadiologyCatalogAdmin() {
  return (
    <div className="p-4 md:p-6">
      <RadiologyCatalogPanel />
    </div>
  );
}

function CreateFindingDialog({
  categories,
  onCreate,
  pending,
}: {
  categories: FindingCategoryRow[];
  onCreate: (body: Record<string, unknown>) => void;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [categoryId, setCategoryId] = useState("");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" /> New finding</Button>
      <DialogContent>
        <DialogHeader><DialogTitle>Create finding</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Key (immutable)</Label>
            <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="liver.cyst" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Label</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Hepatic cyst" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.label} ({c.key})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={pending || !key.trim() || !label.trim() || !categoryId}
            onClick={() => {
              onCreate({ key: key.trim(), label: label.trim(), categoryId: Number(categoryId), status: "draft" });
              setOpen(false);
              setKey("");
              setLabel("");
            }}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateCategoryDialog({
  onCreate,
  pending,
}: {
  onCreate: (body: Record<string, unknown>) => void;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [modality, setModality] = useState("");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" /> New category</Button>
      <DialogContent>
        <DialogHeader><DialogTitle>Create category</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input placeholder="key" value={key} onChange={(e) => setKey(e.target.value)} />
          <Input placeholder="label" value={label} onChange={(e) => setLabel(e.target.value)} />
          <Input placeholder="modality (optional)" value={modality} onChange={(e) => setModality(e.target.value)} />
        </div>
        <DialogFooter>
          <Button
            disabled={pending || !key.trim() || !label.trim()}
            onClick={() => {
              onCreate({ key: key.trim(), label: label.trim(), modality: modality.trim() || undefined, status: "draft" });
              setOpen(false);
            }}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateParameterGroupDialog({
  onCreate,
  pending,
}: {
  onCreate: (body: Record<string, unknown>) => void;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [dataType, setDataType] = useState("option");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" /> New parameter group</Button>
      <DialogContent>
        <DialogHeader><DialogTitle>Create parameter group</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input placeholder="key" value={key} onChange={(e) => setKey(e.target.value)} />
          <Input placeholder="label" value={label} onChange={(e) => setLabel(e.target.value)} />
          <Select value={dataType} onValueChange={setDataType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {["option", "numeric", "text", "boolean"].map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button
            disabled={pending || !key.trim() || !label.trim()}
            onClick={() => {
              onCreate({ key: key.trim(), label: label.trim(), dataType, status: "draft" });
              setOpen(false);
            }}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FindingDetailPanel({
  graph,
  loading,
  selectedId,
  onDeleteFinding,
  onAddSynonym,
  onAddAlias,
  onRemoveEdge,
}: {
  graph: FindingGraph | undefined;
  loading: boolean;
  selectedId: number | null;
  onDeleteFinding: () => void;
  onAddSynonym: (synonym: string) => void;
  onAddAlias: (aliasKey: string) => void;
  onRemoveEdge: (table: CatalogEdgeTable, id: number) => void;
}) {
  const [synonym, setSynonym] = useState("");
  const [aliasKey, setAliasKey] = useState("");

  if (!selectedId) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          Select a finding to view synonyms, aliases, and graph edges.
        </CardContent>
      </Card>
    );
  }

  if (loading || !graph) {
    return (
      <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">Loading graph…</CardContent></Card>
    );
  }

  return (
    <Card>
      <CardHeader className="py-3 flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="text-sm">{graph.finding.label}</CardTitle>
          <p className="text-xs font-mono text-muted-foreground">{graph.finding.key} · v{graph.finding.version}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onDeleteFinding}><Trash2 className="h-4 w-4 text-red-600" /></Button>
      </CardHeader>
      <CardContent className="space-y-4 text-xs">
        <EdgeList title="Synonyms" items={graph.synonyms.map((s) => ({ id: s.id, text: s.synonym }))} table="finding_synonyms" onRemove={onRemoveEdge} />
        <div className="flex gap-2">
          <Input className="h-8" placeholder="Add synonym" value={synonym} onChange={(e) => setSynonym(e.target.value)} />
          <Button size="sm" disabled={!synonym.trim()} onClick={() => { onAddSynonym(synonym.trim()); setSynonym(""); }}>Add</Button>
        </div>

        <EdgeList title="Aliases" items={graph.aliases.map((a) => ({ id: a.id, text: a.aliasKey }))} table="finding_aliases" onRemove={onRemoveEdge} />
        <div className="flex gap-2">
          <Input className="h-8" placeholder="alias_key" value={aliasKey} onChange={(e) => setAliasKey(e.target.value)} />
          <Button size="sm" disabled={!aliasKey.trim()} onClick={() => { onAddAlias(aliasKey.trim()); setAliasKey(""); }}>Add</Button>
        </div>

        {graph.recommendations.length > 0 && (
          <div>
            <p className="font-semibold mb-1">Recommendations</p>
            <ul className="list-disc pl-4 space-y-1">
              {graph.recommendations.map((r) => <li key={r.id}>{r.recommendationText}</li>)}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EdgeList({
  title,
  items,
  table,
  onRemove,
}: {
  title: string;
  items: { id: number; text: string }[];
  table: CatalogEdgeTable;
  onRemove: (table: CatalogEdgeTable, id: number) => void;
}) {
  if (items.length === 0) return <p className="text-muted-foreground">{title}: none</p>;
  return (
    <div>
      <p className="font-semibold mb-1">{title}</p>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-2 border rounded px-2 py-1">
            <span className="font-mono">{item.text}</span>
            <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => onRemove(table, item.id)}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
