const { Pool } = require('pg');

async function run() {
  const connectionString = 'postgresql://erp:changeme@100.65.255.115:5400/diagnostic_erp';
  const pool = new Pool({ connectionString });
  try {
    console.log("Connecting to database...");

    // 1. Inspect existing roles
    const existing = await pool.query(`SELECT DISTINCT role FROM role_permissions;`);
    console.log("Current roles in role_permissions table:", existing.rows.map(r => r.role));

    // 2. Clear old obsolete roles
    console.log("Deleting old obsolete roles ('reception', 'lab_technician')...");
    const delRes = await pool.query(`DELETE FROM role_permissions WHERE role IN ('reception', 'lab_technician');`);
    console.log(`Deleted ${delRes.rowCount} rows.`);

    // 3. Define the modules
    const PERMISSION_MODULES = [
      "dashboard", "patients", "appointments", "queue", "billing", "payments",
      "orders", "tests", "reports", "radiology", "lab", "doctors", "commission",
      "accounting", "inventory", "expenses", "form_f", "settings", "backups", "audit"
    ];

    // 4. Seed super_admin (all true)
    console.log("Seeding super_admin role permissions...");
    for (const mod of PERMISSION_MODULES) {
      await pool.query(`
        INSERT INTO role_permissions (role, module, can_view, can_create, can_edit, can_delete, can_print, can_reprint, can_refund, can_export, can_approve, can_finalize)
        VALUES ($1, $2, true, true, true, true, true, true, true, true, true, true)
        ON CONFLICT (role, module) DO NOTHING;
      `, ["super_admin", mod]);
    }

    // 5. Seed admin (all true except backups/audit)
    console.log("Seeding admin role permissions...");
    for (const mod of PERMISSION_MODULES) {
      const isRestricted = mod === "backups" || mod === "audit";
      await pool.query(`
        INSERT INTO role_permissions (role, module, can_view, can_create, can_edit, can_delete, can_print, can_reprint, can_refund, can_export, can_approve, can_finalize)
        VALUES ($1, $2, true, $3, $3, $3, true, true, true, true, true, true)
        ON CONFLICT (role, module) DO NOTHING;
      `, ["admin", mod, !isRestricted]);
    }

    // 6. Seed manager (all true except backups, settings, audit)
    console.log("Seeding manager role permissions...");
    for (const mod of PERMISSION_MODULES) {
      const isRestricted = mod === "backups" || mod === "audit" || mod === "settings";
      await pool.query(`
        INSERT INTO role_permissions (role, module, can_view, can_create, can_edit, can_delete, can_print, can_reprint, can_refund, can_export, can_approve, can_finalize)
        VALUES ($1, $2, $3, $3, $3, $3, true, true, true, true, true, true)
        ON CONFLICT (role, module) DO NOTHING;
      `, ["manager", mod, !isRestricted]);
    }

    // 7. Seed receptionist
    console.log("Seeding receptionist role permissions...");
    const receptionPerms = {
      patients: { canView: true, canCreate: true, canEdit: true, canPrint: true },
      appointments: { canView: true, canCreate: true, canEdit: true, canPrint: true },
      queue: { canView: true, canCreate: true, canEdit: false, canPrint: true },
      billing: { canView: true, canCreate: false, canEdit: false, canPrint: true },
      payments: { canView: true, canCreate: true, canEdit: false, canPrint: true },
      dashboard: { canView: true },
    };
    for (const mod of PERMISSION_MODULES) {
      const m = receptionPerms[mod] || {};
      await pool.query(`
        INSERT INTO role_permissions (role, module, can_view, can_create, can_edit, can_delete, can_print, can_reprint, can_refund, can_export, can_approve, can_finalize)
        VALUES ($1, $2, $3, $4, $5, false, $6, false, false, false, false, false)
        ON CONFLICT (role, module) DO NOTHING;
      `, [
        "receptionist",
        mod,
        m.canView ?? false,
        m.canCreate ?? false,
        m.canEdit ?? false,
        m.canPrint ?? false
      ]);
    }

    // 8. Seed billing
    console.log("Seeding billing role permissions...");
    const billingPerms = {
      billing: { canView: true, canCreate: true, canEdit: true, canPrint: true, canReprint: true, canRefund: true },
      payments: { canView: true, canCreate: true, canEdit: true, canPrint: true, canReprint: true },
      orders: { canView: true, canCreate: true, canEdit: true, canPrint: true },
      reports: { canView: true, canPrint: true, canExport: true },
      dashboard: { canView: true },
      queue: { canView: true, canCreate: true },
    };
    for (const mod of PERMISSION_MODULES) {
      const m = billingPerms[mod] || {};
      await pool.query(`
        INSERT INTO role_permissions (role, module, can_view, can_create, can_edit, can_delete, can_print, can_reprint, can_refund, can_export, can_approve, can_finalize)
        VALUES ($1, $2, $3, $4, $5, false, $6, $7, $8, $9, false, false)
        ON CONFLICT (role, module) DO NOTHING;
      `, [
        "billing",
        mod,
        m.canView ?? false,
        m.canCreate ?? false,
        m.canEdit ?? false,
        m.canPrint ?? false,
        m.canReprint ?? false,
        m.canRefund ?? false,
        m.canExport ?? false
      ]);
    }

    // 9. Seed lab
    console.log("Seeding lab role permissions...");
    const labPerms = {
      lab: { canView: true, canCreate: true, canEdit: true, canPrint: true },
      tests: { canView: true, canPrint: true },
      reports: { canView: true, canCreate: true, canEdit: true, canPrint: true, canExport: true },
      samples: { canView: true, canCreate: true, canEdit: true },
    };
    for (const mod of PERMISSION_MODULES) {
      const m = labPerms[mod] || {};
      await pool.query(`
        INSERT INTO role_permissions (role, module, can_view, can_create, can_edit, can_delete, can_print, can_reprint, can_refund, can_export, can_approve, can_finalize)
        VALUES ($1, $2, $3, $4, $5, false, $6, false, false, $7, false, false)
        ON CONFLICT (role, module) DO NOTHING;
      `, [
        "lab",
        mod,
        m.canView ?? false,
        m.canCreate ?? false,
        m.canEdit ?? false,
        m.canPrint ?? false,
        m.canExport ?? false
      ]);
    }

    // 10. Seed accountant
    console.log("Seeding accountant role permissions...");
    const accountantPerms = {
      accounting: { canView: true, canCreate: true, canEdit: true, canPrint: true, canExport: true },
      banking: { canView: true, canCreate: true, canEdit: true, canPrint: true },
      reports: { canView: true, canPrint: true, canExport: true },
      expenses: { canView: true, canCreate: true, canEdit: true },
      commission: { canView: true, canCreate: true, canEdit: true, canPrint: true },
      dashboard: { canView: true },
    };
    for (const mod of PERMISSION_MODULES) {
      const m = accountantPerms[mod] || {};
      await pool.query(`
        INSERT INTO role_permissions (role, module, can_view, can_create, can_edit, can_delete, can_print, can_reprint, can_refund, can_export, can_approve, can_finalize)
        VALUES ($1, $2, $3, $4, $5, false, $6, false, false, $7, false, false)
        ON CONFLICT (role, module) DO NOTHING;
      `, [
        "accountant",
        mod,
        m.canView ?? false,
        m.canCreate ?? false,
        m.canEdit ?? false,
        m.canPrint ?? false,
        m.canExport ?? false
      ]);
    }

    console.log("Seeding completed successfully!");

    const finalRoles = await pool.query(`SELECT DISTINCT role FROM role_permissions;`);
    console.log("New distinct roles in role_permissions table:", finalRoles.rows.map(r => r.role));

  } catch (err) {
    console.error("Operation failed:", err.message);
  } finally {
    await pool.end();
  }
}

run();
