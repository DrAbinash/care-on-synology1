import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Shield, Save, RotateCcw, Lock, Unlock,
} from "lucide-react";
import { saAuthHeaders } from "@/lib/saApi";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

// API response shape (camelCase with "can" prefix)
interface ApiPermissionRow {
  id: number;
  role: string;
  module: string;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canPrint: boolean;
  canReprint: boolean;
  canRefund: boolean;
  canExport: boolean;
  canApprove: boolean;
  canFinalize: boolean;
  updatedAt: string;
}

// UI shape (short lowercase keys)
interface RolePermission {
  id: number;
  role: string;
  module: string;
  view: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
  print: boolean;
  reprint: boolean;
  refund: boolean;
  export: boolean;
  approve: boolean;
  finalize: boolean;
  updatedAt: string;
}

interface RolePermissionsResponse {
  roles: string[];
  modules: string[];
  permissions: Record<string, ApiPermissionRow[]>;
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  manager: "Manager",
  receptionist: "Receptionist",
  billing: "Billing",
  radiology_typist: "Radiology Typist",
  radiologist: "Radiologist",
  lab: "Lab",
  accountant: "Accountant",
};

const PERMISSIONS = [
  { key: "view", label: "View" },
  { key: "create", label: "Create" },
  { key: "edit", label: "Edit" },
  { key: "delete", label: "Delete" },
  { key: "print", label: "Print" },
  { key: "reprint", label: "Reprint" },
  { key: "refund", label: "Refund" },
  { key: "export", label: "Export" },
  { key: "approve", label: "Approve" },
  { key: "finalize", label: "Finalize" },
] as const;

function apiRowToUi(row: ApiPermissionRow): RolePermission {
  return {
    id: row.id,
    role: row.role,
    module: row.module,
    view: row.canView,
    create: row.canCreate,
    edit: row.canEdit,
    delete: row.canDelete,
    print: row.canPrint,
    reprint: row.canReprint,
    refund: row.canRefund,
    export: row.canExport,
    approve: row.canApprove,
    finalize: row.canFinalize,
    updatedAt: row.updatedAt,
  };
}

export default function RolePermissions({ onBack }: { onBack: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [changes, setChanges] = useState<Map<string, boolean>>(new Map());
  const [confirmReset, setConfirmReset] = useState(false);

  const { data, isLoading } = useQuery<RolePermissionsResponse>({
    queryKey: ["/api/admin/role-permissions"],
    queryFn: async () => {
      const res = await fetch("/api/admin/role-permissions", { headers: saAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load permissions");
      return res.json();
    },
  });

  const roles = data?.roles ?? [];
  const modules = data?.modules ?? [];
  // Default to first role once loaded
  const activeRole = selectedRole ?? (roles[0] || null);

  const permMap = useMemo(() => {
    const map = new Map<string, RolePermission>();
    if (!data?.permissions) return map;
    for (const [role, rows] of Object.entries(data.permissions)) {
      for (const row of rows) {
        map.set(`${role}|${row.module}`, apiRowToUi(row));
      }
    }
    // Fill missing modules with defaults (all false)
    for (const role of roles) {
      for (const mod of modules) {
        if (!map.has(`${role}|${mod}`)) {
          map.set(`${role}|${mod}`, {
            id: 0,
            role,
            module: mod,
            view: false,
            create: false,
            edit: false,
            delete: false,
            print: false,
            reprint: false,
            refund: false,
            export: false,
            approve: false,
            finalize: false,
            updatedAt: "",
          });
        }
      }
    }
    return map;
  }, [data, roles, modules]);

  const getPerm = (role: string, module: string, key: string): boolean => {
    const changeKey = `${role}|${module}|${key}`;
    if (changes.has(changeKey)) return changes.get(changeKey)!;
    const p = permMap.get(`${role}|${module}`);
    if (!p) return false;
    return (p as unknown as Record<string, boolean>)[key] ?? false;
  };

  const toggle = (role: string, module: string, key: string) => {
    const changeKey = `${role}|${module}|${key}`;
    const current = getPerm(role, module, key);
    setChanges(new Map(changes.set(changeKey, !current)));
    setDirty(new Set(dirty.add(changeKey)));
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const updates: Array<{ role: string; module: string; permission: string; value: boolean }> = [];
      dirty.forEach(key => {
        const [role, module, perm] = key.split("|");
        updates.push({ role, module, permission: perm, value: changes.get(key)! });
      });
      const res = await fetch("/api/admin/role-permissions", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...saAuthHeaders() },
        body: JSON.stringify({ updates }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Save failed");
      }
    },
    onSuccess: () => {
      toast({ title: "Saved", description: "Permission changes have been saved." });
      setDirty(new Set());
      setChanges(new Map());
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/role-permissions"] });
    },
    onError: (e: Error) => {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    },
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/role-permissions/seed", {
        method: "POST",
        headers: saAuthHeaders(),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Reset failed");
      }
    },
    onSuccess: () => {
      toast({ title: "Reset complete", description: "Default permissions restored." });
      setDirty(new Set());
      setChanges(new Map());
      setConfirmReset(false);
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/role-permissions"] });
    },
    onError: (e: Error) => {
      toast({ title: "Reset failed", description: e.message, variant: "destructive" });
    },
  });

  const hasChanges = dirty.size > 0;

  return (
    <div className="min-h-screen w-full bg-background p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={onBack}><ArrowLeft size={14} /></Button>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Role Permissions</h1>
              <p className="text-sm text-muted-foreground">Granular access control matrix for every module and action.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmReset(true)} disabled={resetMutation.isPending}>
              <RotateCcw size={13} className="mr-1.5" />Reset Defaults
            </Button>
            <Button size="sm" onClick={() => saveMutation.mutate()} disabled={!hasChanges || saveMutation.isPending}>
              <Save size={13} className="mr-1.5" />{saveMutation.isPending ? "Saving…" : "Save Changes"}
            </Button>
          </div>
        </div>

        {/* Role selector */}
        <div className="flex items-center gap-2 flex-wrap">
          {roles.map(role => (
            <Button
              key={role}
              variant={activeRole === role ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedRole(role)}
              className="capitalize"
            >
              {ROLE_LABELS[role] || role.replace(/_/g, " ")}
              {role === "super_admin" && <Lock size={11} className="ml-1.5 text-primary-foreground/70" />}
            </Button>
          ))}
          {roles.length === 0 && (
            <span className="text-sm text-muted-foreground">Loading roles…</span>
          )}
        </div>

        {/* Permissions table */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Shield size={14} className="text-primary" />
              {activeRole ? (ROLE_LABELS[activeRole] || activeRole.replace(/_/g, " ")) : "Select a role"} Permissions
            </div>
            {hasChanges && <Badge variant="secondary" className="text-[10px]">{dirty.size} unsaved changes</Badge>}
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[140px]">Module</TableHead>
                  {PERMISSIONS.map(p => (
                    <TableHead key={p.key} className="text-center w-[70px] text-[11px] uppercase">{p.label}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow><TableCell colSpan={11} className="text-center py-8 text-muted-foreground">Loading permissions…</TableCell></TableRow>
                )}
                {!isLoading && activeRole && modules.map(mod => (
                  <TableRow key={mod}>
                    <TableCell className="font-medium text-xs capitalize">{mod.replace(/_/g, " ")}</TableCell>
                    {PERMISSIONS.map(p => {
                      const val = getPerm(activeRole, mod, p.key);
                      const changeKey = `${activeRole}|${mod}|${p.key}`;
                      const isChanged = changes.has(changeKey);
                      return (
                        <TableCell key={p.key} className="text-center">
                          <Checkbox
                            checked={val}
                            onCheckedChange={() => toggle(activeRole, mod, p.key)}
                            className={isChanged ? "border-primary" : ""}
                          />
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
                {!isLoading && !activeRole && (
                  <TableRow><TableCell colSpan={11} className="text-center py-8 text-muted-foreground">Select a role to view permissions</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Legend */}
        <div className="text-xs text-muted-foreground flex items-center gap-4">
          <span className="flex items-center gap-1"><Checkbox checked disabled className="w-3 h-3" />Granted</span>
          <span className="flex items-center gap-1"><Checkbox checked={false} disabled className="w-3 h-3" />Denied</span>
          <span className="flex items-center gap-1"><Checkbox checked disabled className="w-3 h-3 border-primary" />Modified</span>
        </div>
      </div>

      {/* Reset confirmation */}
      <Dialog open={confirmReset} onOpenChange={setConfirmReset}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset to defaults?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will overwrite all custom permission settings and restore the factory defaults. This action cannot be undone.
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" size="sm" onClick={() => setConfirmReset(false)}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={() => resetMutation.mutate()} disabled={resetMutation.isPending}>
              Reset to Defaults
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
