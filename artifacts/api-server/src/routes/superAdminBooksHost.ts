/**
 * Host-side Super Admin book helpers that run BEFORE the USB plugin router.
 *
 * Fixes assign-doctors "Internal server error" caused by the USB plugin SQL
 * referencing `orders.appointment_id` (column does not exist). This route
 * shadows the plugin path so a care-api rebuild unblocks Save even before
 * the pen-drive plugin is rebuilt.
 */
import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { doctorsTable, ledgersTable } from "@workspace/db/schema";
import { requireSuperAdmin } from "../middleware/requireSuperAdmin";
import { logger } from "../lib/logger";

export const superAdminBooksHostRouter: IRouter = Router();

const AssignParams = z.object({ id: z.coerce.number().int().positive() });
const AssignBody = z.object({ doctorIds: z.array(z.number().int().positive()) });

superAdminBooksHostRouter.post(
  "/books/:id/assign-doctors",
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const paramsParsed = AssignParams.safeParse(req.params);
    const bodyParsed = AssignBody.safeParse(req.body);
    if (!paramsParsed.success || !bodyParsed.success) {
      res.status(400).json({
        error: "Invalid request",
        details: [
          ...(paramsParsed.success ? [] : paramsParsed.error.issues),
          ...(bodyParsed.success ? [] : bodyParsed.error.issues),
        ],
      });
      return;
    }

    const id = paramsParsed.data.id;
    const { doctorIds } = bodyParsed.data;

    try {
      const [ledger] = await db.select().from(ledgersTable).where(eq(ledgersTable.id, id));
      if (!ledger) {
        res.status(404).json({ error: "Book not found" });
        return;
      }

      // Move currently-assigned doctors not in the new list back to default book.
      await db
        .update(doctorsTable)
        .set({ ledgerId: 1 })
        .where(
          and(
            eq(doctorsTable.ledgerId, id),
            doctorIds.length > 0
              ? sql`${doctorsTable.id} NOT IN (${sql.join(
                  doctorIds.map((d) => sql`${d}`),
                  sql`, `,
                )})`
              : sql`true`,
          ),
        );

      if (doctorIds.length > 0) {
        await db.update(doctorsTable).set({ ledgerId: id }).where(inArray(doctorsTable.id, doctorIds));

        // Retroactively retag related rows. Appointments use doctor_id —
        // orders has no appointment_id column.
        const idList = sql.join(
          doctorIds.map((d) => sql`${d}`),
          sql`, `,
        );
        await db.execute(sql`UPDATE orders SET ledger_id = ${id} WHERE doctor_id IN (${idList})`);
        await db.execute(
          sql`UPDATE bills SET ledger_id = ${id} WHERE order_id IN (SELECT id FROM orders WHERE doctor_id IN (${idList}))`,
        );
        await db.execute(
          sql`UPDATE patients SET ledger_id = ${id} WHERE id IN (SELECT patient_id FROM orders WHERE doctor_id IN (${idList}))`,
        );
        await db.execute(sql`UPDATE appointments SET ledger_id = ${id} WHERE doctor_id IN (${idList})`);
      }

      res.json({ assigned: doctorIds.length });
    } catch (err) {
      logger.error({ err, bookId: id, doctorCount: doctorIds.length }, "host assign-doctors failed");
      res.status(500).json({
        error: "Failed to assign doctors to book",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  },
);
