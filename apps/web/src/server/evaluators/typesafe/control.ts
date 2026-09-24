import { eq } from "drizzle-orm";
import { getDatabase } from "@/src/server/db/client";
import { systemControls } from "@/src/server/db/schema";

export async function isJevControlEnabled(): Promise<boolean> {
  const { db } = getDatabase();
  const [control] = await db.select({ enabled: systemControls.enabled }).from(systemControls).where(eq(systemControls.controlKey, "jev-evaluation")).limit(1);
  return control?.enabled === true;
}
