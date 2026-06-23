import { db } from "../../lib/db/src";
import { paymentLogsTable } from "../../lib/db/src/schema";
import { desc } from "drizzle-orm";
import dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

async function run() {
  try {
    const logs = await db
      .select()
      .from(paymentLogsTable)
      .orderBy(desc(paymentLogsTable.id))
      .limit(10);
    
    console.log(JSON.stringify(logs, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

run();
