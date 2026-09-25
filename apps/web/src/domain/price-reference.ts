import type { MarketplaceListing } from "./listing";

export function isPriceReferenceEligible(record: { listingId: string | null; currency: string; priceType: string; conditionGrade: string; market: string; sampleCount: number; sampleEvidence: unknown; observedAt: Date }, now = new Date()): boolean {
  return record.listingId !== null && record.currency === "CNY" && record.priceType === "actual_sale"
    && record.conditionGrade !== "unknown" && record.market === "CN-mainland"
    && record.sampleCount >= 3 && Array.isArray(record.sampleEvidence) && record.sampleEvidence.length === record.sampleCount
    && record.observedAt.getTime() <= now.getTime()
    && record.observedAt.getTime() > now.getTime() - 90 * 86_400_000;
}

/** Only approved, linked references are attached to a listing. The immutable record ID resolves its source and observation time. */
export function priceReferenceSnapshot(listing: MarketplaceListing) {
  if (!listing.marketReferencePrice || !listing.marketReferenceId || !listing.marketReferenceVersion) return null;
  return {
    id: listing.marketReferenceId,
    version: listing.marketReferenceVersion,
    amount: listing.marketReferencePrice,
    currency: "CNY",
    priceType: "actual_sale",
  };
}
