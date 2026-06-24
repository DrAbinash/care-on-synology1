import { Router } from "express";
import { superAdminRouter } from "./routes/super-admin";
import { backupRouter } from "./routes/backup";
import { systemRouter } from "./routes/system";
import { auditLogsRouter } from "./routes/audit-logs";
import { rolePermissionsRouter } from "./routes/role-permissions";
import systemHealthRouter from "./routes/system-health";
import commissionRouter from "./routes/commission";
import { doctorLedgerRouter } from "./routes/doctor-ledger";
import { requireSuperAdmin } from "./middleware/requireSuperAdmin";
import { requireSuperAdminUsb } from "./middleware/requireSuperAdminUsb";

const pluginRouter = Router();

pluginRouter.use("/super-admin", superAdminRouter);
pluginRouter.use("/backup", requireSuperAdmin, backupRouter);
pluginRouter.use("/system", requireSuperAdmin, systemRouter);
pluginRouter.use("/admin/audit-logs", requireSuperAdminUsb, requireSuperAdmin, auditLogsRouter);
pluginRouter.use("/admin/role-permissions", requireSuperAdminUsb, requireSuperAdmin, rolePermissionsRouter);
pluginRouter.use("/admin/system-health", requireSuperAdminUsb, requireSuperAdmin, systemHealthRouter);
pluginRouter.use("/commission", requireSuperAdmin, commissionRouter);
pluginRouter.use("/doctor-ledger", requireSuperAdmin, doctorLedgerRouter);

export default pluginRouter;
