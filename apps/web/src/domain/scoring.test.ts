import { describe, expect, it } from "vitest";
import { demoListings } from "@/src/data/demo";
import { assessListing } from "./scoring";
import { nonPersonalSellerReason } from "./seller";

const now = new Date("2026-08-30T10:30:00+08:00");

describe("assessListing", () => {
  it("prioritizes a recent personal listing with complete evidence", () => {
    const assessment = assessListing(demoListings[0], now);

    expect(assessment.scores.personalSeller).toBeGreaterThanOrEqual(80);
    expect(assessment.scores.totalOpportunity).toBeGreaterThanOrEqual(65);
    expect(assessment.recommendedAction).toBe("notify");
    expect(assessment.riskLevel).toBe("low");
  });

  it("blocks listings containing explicit counterfeit terms", () => {
    const assessment = assessListing(demoListings[2], now);

    expect(assessment.scores.authenticityRisk).toBeGreaterThanOrEqual(70);
    expect(assessment.recommendedAction).toBe("skip");
    expect(assessment.evidence.some((item) => item.code === "listing-suspicious-terms")).toBe(true);
  });

  it("keeps missing evidence separate from authenticity conclusions", () => {
    const assessment = assessListing(demoListings[1], now);

    expect(assessment.riskLevel).toBe("insufficient");
    expect(assessment.missingInformation.length).toBeGreaterThan(0);
    expect(assessment.summary).toContain("信息缺口");
  });

  it("returns zero recency for invalid dates instead of throwing", () => {
    const assessment = assessListing({ ...demoListings[0], publishedAt: "invalid" }, now);

    expect(assessment.scores.recency).toBe(0);
  });

  it("labels a publisher with six observed same-category listings as non-personal", () => {
    const assessment = assessListing({
      ...demoListings[0],
      seller: { ...demoListings[0].seller, activeListingCount: 6, sameCategoryCount: 6, sameCategoryRatio: 1, signalScope: "observed-listings" },
    }, now);

    expect(assessment.scores.personalSeller).toBe(32);
    expect(assessment.evidence.some((item) => item.code === "seller-high-volume")).toBe(true);
    expect(assessment.evidence.some((item) => item.code === "seller-category-concentration")).toBe(true);
    expect(assessment.evidence.some((item) => item.code === "seller-observed-volume-guard")).toBe(true);
    expect(assessment.evidence.find((item) => item.code === "seller-high-volume")?.label).toBe("疑似非个人卖家");
  });

  it("does not use six mixed-category observed listings as the non-personal threshold", () => {
    const seller = { ...demoListings[0].seller, activeListingCount: 12, sameCategoryCount: 5, sameCategoryRatio: 5 / 12, signalScope: "observed-listings" as const };
    const assessment = assessListing({ ...demoListings[0], seller }, now);

    expect(nonPersonalSellerReason(seller)).toBeNull();
    expect(assessment.evidence.some((item) => item.code === "seller-high-volume")).toBe(false);
  });

  it("uses a verified sold count only when it exceeds 100", () => {
    expect(nonPersonalSellerReason({ ...demoListings[0].seller, completedSaleCount: 101 })).toBeNull();
    expect(nonPersonalSellerReason({ ...demoListings[0].seller, completedSaleCount: 101, completedSaleCountVerified: true })).toBe("已核验的公开已售数量为 101 件");
  });

  it("does not treat an unverified sold count as evidence", () => {
    const assessment = assessListing({
      ...demoListings[0],
      seller: { ...demoListings[0].seller, activeListingCount: 6, sameCategoryCount: 6, sameCategoryRatio: 1, completedSaleCount: 500 },
    }, now);

    expect(assessment.evidence.find((item) => item.code === "seller-observed-volume-guard")?.detail).toContain("上限为 32");
  });

  it("does not infer personal seller status from one observed search result", () => {
    const assessment = assessListing({
      ...demoListings[0],
      seller: { ...demoListings[0].seller, activeListingCount: 1, sameCategoryCount: 1, sameCategoryRatio: 1, signalScope: "observed-listings", hasPersonalStorySignals: false, hasNaturalSceneSignals: false },
    }, now);

    expect(assessment.evidence.some((item) => item.code === "seller-low-volume")).toBe(false);
    expect(assessment.evidence.some((item) => item.code === "seller-profile-incomplete")).toBe(true);
  });

  it("uses low seller volume as positive evidence only with a complete profile", () => {
    const assessment = assessListing({
      ...demoListings[0],
      seller: { ...demoListings[0].seller, activeListingCount: 2, sameCategoryCount: 1, sameCategoryRatio: 0.5, signalScope: "complete-profile" },
    }, now);

    expect(assessment.evidence.some((item) => item.code === "seller-low-volume")).toBe(true);
    expect(assessment.evidence.some((item) => item.code === "seller-profile-incomplete")).toBe(false);
  });
});
