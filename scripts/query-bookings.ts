import { db } from "../lib/db/src";
import { onlineBookingsTable } from "../lib/db/src/schema";
import { desc } from "drizzle-orm";
import dotenv from "dotenv";
dotenv.config();

async function run() {
  try {
    const bookings = await db
      .select()
      .from(onlineBookingsTable)
      .orderBy(desc(onlineBookingsTable.id))
      .limit(10);
    
    console.log(JSON.stringify(bookings, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

run();
