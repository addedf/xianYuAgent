import { describe, expect, it } from "vitest";
import { isPriceReferenceEligible } from "./price-reference";

const now = new Date("2026-09-25T10:00:00.000Z");
const base = { listingId: "listing-1", currency: "CNY", priceType: "actual_sale", conditionGrade: "good", market: "CN-mainland", sampleCount: 3, sampleEvidence: [{ sourceLabel: "A", amount: 100, observedAt: "2026-08-01" }, { sourceLabel: "B", amount: 110, observedAt: "2026-08-02" }, { sourceLabel: "C", amount: 120, observedAt: "2026-08-03" }], observedAt: new Date("2026-09-01T10:00:00.000Z") };

describe("isPriceReferenceEligible", () => {
  it("accepts a linked, recent CNY actual sale reference with at least three samples", () => {
    expect(isPriceReferenceEligible(base, now)).toBe(true);
  });
  it("does not execute on unlinked, stale, future, cross-currency, asking or sparse data", () => {
    expect(isPriceReferenceEligible({ ...base, listingId: null }, now)).toBe(false);
    expect(isPriceReferenceEligible({ ...base, observedAt: new Date("2026-06-01T10:00:00.000Z") }, now)).toBe(false);
    expect(isPriceReferenceEligible({ ...base, observedAt: new Date("2026-09-26T10:00:00.000Z") }, now)).toBe(false);
    expect(isPriceReferenceEligible({ ...base, currency: "USD" }, now)).toBe(false);
    expect(isPriceReferenceEligible({ ...base, priceType: "asking" }, now)).toBe(false);
    expect(isPriceReferenceEligible({ ...base, market: "other" }, now)).toBe(false);
    expect(isPriceReferenceEligible({ ...base, conditionGrade: "unknown" }, now)).toBe(false);
    expect(isPriceReferenceEligible({ ...base, sampleCount: 2 }, now)).toBe(false);
    expect(isPriceReferenceEligible({ ...base, sampleEvidence: [] }, now)).toBe(false);
  });
});
