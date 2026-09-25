import { and, eq } from "drizzle-orm";
import type { KnowledgeEntry } from "@/src/domain/listing";
import { getDatabase } from "@/src/server/db/client";
import { knowledgeEntries } from "@/src/server/db/schema";

/** Only approved entries enter JEV. A failed read must not silently score without expected knowledge. */
export async function loadActiveKnowledgeEntries(): Promise<KnowledgeEntry[]> {
  const { db } = getDatabase();
  const rows = await db.select().from(knowledgeEntries).where(and(
    eq(knowledgeEntries.active, true),
    eq(knowledgeEntries.reviewStatus, "approved"),
    eq(knowledgeEntries.effectChannel, "jev-context"),
  ));
  return rows.map((row) => ({
    id: row.id,
    entryType: row.entryType as KnowledgeEntry["entryType"],
    category: row.category as KnowledgeEntry["category"],
    brand: row.brand ?? undefined,
    model: row.model ?? undefined,
    title: row.title,
    summary: row.currentSummary,
    confidence: row.confidence as KnowledgeEntry["confidence"],
    version: row.currentVersion,
    sourceLabel: row.sourceLabel,
    updatedAt: row.updatedAt.toISOString(),
    usageCount: 0,
    active: row.active,
    effectChannel: "jev-context",
    reviewStatus: "approved",
  }));
}
