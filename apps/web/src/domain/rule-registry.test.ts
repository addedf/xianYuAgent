import { describe, expect, it } from "vitest";
import { RULE_PHASES, buildRuleRegistry } from "./rule-registry";
import { defaultRuleViews } from "./rule-views";

const jevPrompt = {
  instruction: "测试指令：仅评估商品数据。",
  rubrics: {
    personalSellerScore: ["档一", "档二", "档三", "档四", "档五"],
    authenticityRiskScore: ["档一", "档二", "档三", "档四", "档五"],
    completenessScore: ["档一", "档二", "档三", "档四", "档五"],
  } as Record<string, readonly string[]>,
};

describe("buildRuleRegistry", () => {
  it("按四个链路阶段产出全部生效项", () => {
    const registry = buildRuleRegistry(defaultRuleViews(), 55, 30, "2026.09.25-v6", jevPrompt);
    expect(RULE_PHASES).toEqual(["前置过滤", "事实提取", "JEV 上下文", "收敛与动作"]);
    expect(registry).toHaveLength(13);
    for (const phase of RULE_PHASES) expect(registry.some((item) => item.phase === phase)).toBe(true);
    expect(registry.every((item) => item.currentValue.length > 0)).toBe(true);
  });

  it("数据库规则用人话化取值，代码阈值项展示可读摘要并保留原始 JSON", () => {
    const registry = buildRuleRegistry(defaultRuleViews(), 55, 30, "2026.09.25-v6", jevPrompt);
    const counterfeit = registry.find((item) => item.code === "listing-counterfeit-terms");
    expect(counterfeit?.currentValue).toContain("命中词硬阻断");
    expect(counterfeit?.source).toBe("代码默认");
    const seller = registry.find((item) => item.code === "seller-non-personal-thresholds");
    expect(seller?.currentValue).toContain("标记疑似非个人卖家");
    const weights = registry.find((item) => item.code === "finalize-weights");
    expect(weights?.currentValue).toContain("个人卖家 30%");
    expect(weights?.currentValue).not.toContain("{");
    expect(weights?.rawValue).toContain("personalSeller");
    const factThresholds = registry.find((item) => item.code === "facts-signal-thresholds");
    expect(factThresholds?.currentValue).toContain("模板相似度 72%");
  });

  it("停用的规则标记停用且取值显示已停用", () => {
    const rules = defaultRuleViews().map((rule) => (rule.code === "listing-extreme-price-gap" ? { ...rule, enabled: false } : rule));
    const registry = buildRuleRegistry(rules, 55, 30, "2026.09.25-v6", jevPrompt);
    const price = registry.find((item) => item.code === "listing-extreme-price-gap");
    expect(price?.enabled).toBe(false);
    expect(price?.currentValue).toBe("已停用");
    expect(registry.filter((item) => item.enabled)).toHaveLength(12);
  });

  it("JEV 指令项在 currentValue 摘要版本号，折叠 detail 含指令与 rubric 全文", () => {
    const registry = buildRuleRegistry(defaultRuleViews(), 55, 30, "2026.09.25-v6", jevPrompt);
    const instruction = registry.find((item) => item.code === "jev-instruction");
    expect(instruction?.currentValue).toContain("2026.09.25-v6");
    expect(instruction?.currentValue).toContain("3 项评分 rubric");
    expect(instruction?.detail).toContain("测试指令：仅评估商品数据。");
    expect(instruction?.detail).toContain("【personalSellerScore】");
    expect(instruction?.detail).toContain("5. 档五");
  });
});
