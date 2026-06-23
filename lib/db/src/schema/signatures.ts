import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";

// Uploaded doctor / radiologist / pathologist signature blocks. The image is a
// base64 PNG (small, hand-signed scan). Reports reference one of these by id
// and the rendered print includes the signature image plus printed name +
// qualification + registration number.
export const signaturesTable = pgTable("signatures", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),                  // "Dr. R. Sharma"
  role: text("role").notNull().default("Doctor"),// "Pathologist" | "Radiologist" | "Lab Director" | "Doctor"
  qualification: text("qualification").notNull().default(""),  // "MD (Pathology)"
  registrationNo: text("registration_no").notNull().default(""), // medical reg
  imageDataUrl: text("image_data_url").notNull(),// base64 data: URL
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type Signature = typeof signaturesTable.$inferSelect;
