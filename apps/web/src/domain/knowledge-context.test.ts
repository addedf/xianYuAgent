import { describe, expect, it } from "vitest";
import { demoListings } from "@/src/data/demo";
import type { KnowledgeEntry } from "./listing";
import { knowledgeHash, knowledgeUsed, selectKnowledge } from "./knowledge-context";

const listing = demoListings[0];
function entry(id: string, changes: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id, entryType: "identification", category: "watch", brand: "劳力士", model: "日志型 126234",
    title: id, summary: "核对实物细节", confidence: "reviewed", version: 1,
    sourceLabel: "人工经验", updatedAt: "2026-09-24T00:00:00.000Z", usageCount: 0,
    active: true, effectChannel: "jev-context", reviewStatus: "approved", sourceType: "manual",
    ...changes,
  };
}

describe("selectKnowledge", () => {
  it("only injects approved and active entries with an exact scope", () => {
    const entries = [
      entry("matching"),
      entry("category-general", { brand: undefined, model: undefined }),
      entry("wrong-model", { model: "日志型 126200" }),
      entry("wrong-brand", { brand: "欧米茄", model: undefined }),
      entry("pending", { reviewStatus: "pending" }),
      entry("disabled", { active: false }),
      entry("archive", { effectChannel: "manual-only" }),
      entry("case", { entryType: "case" }),
    ];
    expect(selectKnowledge(entries, listing).map((item) => item.id)).toEqual(["matching", "category-general"]);
  });

  it("uses a deterministic priority and both budgets", () => {
    const entries = [entry("reviewed"), entry("verified", { confidence: "verified" }), entry("too-long", { confidence: "verified", summary: "x".repeat(100), updatedAt: "2026-09-23T00:00:00.000Z" })];
    expect(selectKnowledge(entries, listing, 1).map((item) => item.id)).toEqual(["verified"]);
    expect(selectKnowledge(entries, listing, 10, 25).map((item) => item.id)).toEqual(["verified"]);
  });

  it("changes its fingerprint when an injected version changes", () => {
    const before = selectKnowledge([entry("a")], listing);
    const after = selectKnowledge([entry("a", { version: 2 })], listing);
    expect(knowledgeUsed(before)).toEqual(["a:1"]);
    expect(knowledgeHash(before)).not.toBe(knowledgeHash(after));
    expect(knowledgeHash(before)).toBe(knowledgeHash([...before].reverse()));
  });
});
