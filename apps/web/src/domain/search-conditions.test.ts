import { describe, expect, it } from "vitest";
import { cityOptions, parseSearchKeywords, resolveSearchLocation } from "./search-conditions";

describe("search conditions", () => {
  it("keeps multiword phrases and removes duplicate searches", () => {
    expect(parseSearchKeywords(" 劳力士 日志型\n欧米茄海马，劳力士 日志型 ")).toEqual(["劳力士 日志型", "欧米茄海马"]);
    expect(() => parseSearchKeywords(" , ; ")).toThrow("至少输入");
    expect(() => parseSearchKeywords("a\nb\nc\nd\ne\nf")).toThrow("最多搜索 5 个");
  });

  it("maps nationwide, province and city selections to collector filters", () => {
    expect(resolveSearchLocation("", "")).toEqual({});
    expect(resolveSearchLocation("440000", "")).toEqual({ province: "广东" });
    expect(resolveSearchLocation("440000", "440100")).toEqual({ province: "广东", city: "广州" });
    expect(cityOptions("440000").some(({ name }) => name === "佛山市")).toBe(true);
    expect(() => resolveSearchLocation("440000", "110100")).toThrow("该省份下");
  });
});
