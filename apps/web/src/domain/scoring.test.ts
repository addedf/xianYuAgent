import { describe, expect, it } from "vitest";
import { demoListings } from "@/src/data/demo";
import { assessListing } from "./scoring";

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
});

