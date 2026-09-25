import { describe, expect, it } from "vitest";
import { DEFAULT_PRE_FILTER_CONFIGS } from "./pre-filters";
import { DEFAULT_SELLER_RULE_THRESHOLDS } from "./seller-rules";
import { describeRuleConditions, defaultRuleViews, PIPELINE_RULE_CODES } from "./rule-views";

describe("defaultRuleViews", () => {
  it("covers all three pipeline rules with code defaults", () => {
    const views = defaultRuleViews();
    expect(views.map((view) => view.code)).toEqual(PIPELINE_RULE_CODES);
    expect(views.every((view) => view.enabled && view.history.length === 0)).toBe(true);
    expect(views[0].conditions).toEqual({ ...DEFAULT_SELLER_RULE_THRESHOLDS });
    expect(views[1].conditions).toEqual({ terms: DEFAULT_PRE_FILTER_CONFIGS.counterfeitTerms });
    expect(views[2].conditions).toEqual({ priceRatioBelow: 0.18 });
  });
});

describe("describeRuleConditions", () => {
  it("renders seller thresholds with overrides", () => {
    expect(describeRuleConditions("seller-non-personal-thresholds", {}, { sameCategoryMinCount: 8, completedSaleMinCount: 200, onSaleMinCount: 60 }))
      .toBe("同品类已采集 8 条、主页在售达到 60 件或已核实售出超过 200 件，标记疑似非个人卖家。");
  });

  it("renders counterfeit terms and price ratio", () => {
    expect(describeRuleConditions("listing-counterfeit-terms", { terms: ["高仿", "复刻"] }))
      .toBe("命中词硬阻断：高仿、复刻。命中即在评分前拦截。");
    expect(describeRuleConditions("listing-extreme-price-gap", { priceRatioBelow: 0.18 }))
      .toBe("挂牌价低于参考价 18% 的线索在评分前拦截。");
  });

  it("falls back to JSON for unknown codes or malformed conditions", () => {
    expect(describeRuleConditions("custom-rule", { minScore: 3 })).toBe('{"minScore":3}');
    expect(describeRuleConditions("listing-counterfeit-terms", { terms: "not-an-array" })).toBe("未配置词表，使用代码默认词表。");
  });
});
