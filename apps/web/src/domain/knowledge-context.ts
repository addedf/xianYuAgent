import { createHash } from "node:crypto";
import type { KnowledgeEntry, MarketplaceListing } from "./listing";

export type KnowledgeContext = Pick<KnowledgeEntry, "id" | "version" | "entryType" | "title" | "summary">[];

const rank = { verified: 0, reviewed: 1, draft: 2 } as const;

function sameScope(entry: KnowledgeEntry, listing: MarketplaceListing): boolean {
  if (entry.category !== listing.category) return false;
  if (entry.brand && entry.brand.trim().toLocaleLowerCase() !== listing.brand.trim().toLocaleLowerCase()) return false;
  if (entry.model && entry.model.trim().toLocaleLowerCase() !== (listing.model ?? "").trim().toLocaleLowerCase()) return false;
  return true;
}

export function selectKnowledge(entries: KnowledgeEntry[], listing: MarketplaceListing, maxEntries = 10, maxCharacters = 6000): KnowledgeContext {
  const candidates = entries.filter((entry) => entry.active !== false
    && entry.reviewStatus === "approved"
    && entry.effectChannel === "jev-context"
    && entry.entryType !== "case"
    && sameScope(entry, listing));
  candidates.sort((a, b) => rank[a.confidence] - rank[b.confidence]
    || Number(Boolean(b.model)) - Number(Boolean(a.model))
    || Number(Boolean(b.brand)) - Number(Boolean(a.brand))
    || Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
    || a.id.localeCompare(b.id));
  const selected: KnowledgeContext = [];
  let used = 0;
  for (const entry of candidates) {
    if (selected.length >= maxEntries) break;
    const length = entry.title.length + entry.summary.length;
    if (used + length > maxCharacters) continue;
    selected.push({ id: entry.id, version: entry.version, entryType: entry.entryType, title: entry.title, summary: entry.summary });
    used += length;
  }
  return selected;
}

export function knowledgeHash(entries: KnowledgeContext): string {
  const versions = entries.map((entry) => `${entry.id}:${entry.version}`).sort().join("|");
  return createHash("sha256").update(`knowledge-selector-v1|${versions}`).digest("hex").slice(0, 32);
}

export function knowledgeUsed(entries: KnowledgeContext): string[] {
  return entries.map((entry) => `${entry.id}:${entry.version}`);
}
