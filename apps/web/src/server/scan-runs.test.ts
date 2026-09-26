import { describe, expect, it } from "vitest";

import { coverageNoteOf, taskScopeHash } from "./scan-runs";

describe("taskScopeHash", () => {
  const base = { keyword: "劳力士", province: "广东", city: "广州", minPrice: 5000, maxPrice: 150000 };

  it("追踪最新的时间窗属于范围：publishDays 不同则范围不同", () => {
    expect(taskScopeHash(base, "fresh")).not.toBe(taskScopeHash({ ...base, publishDays: 3 }, "fresh"));
  });

  it("扩大覆盖不带时间窗：publishDays 不影响范围，跨轮累积同一范围", () => {
    expect(taskScopeHash(base, "expand")).toBe(taskScopeHash({ ...base, publishDays: 3 }, "expand"));
  });

  it("同范围同模式哈希稳定；不同关键词不同范围", () => {
    expect(taskScopeHash({ ...base, publishDays: 3 }, "fresh")).toBe(taskScopeHash({ ...base, publishDays: 3 }, "fresh"));
    expect(taskScopeHash(base, "fresh")).not.toBe(taskScopeHash({ ...base, keyword: "欧米茄" }, "fresh"));
    expect(taskScopeHash(base, "fresh")).not.toBe(taskScopeHash(base, "expand"));
  });
});

describe("coverageNoteOf", () => {
  it("全部完成时如实报告覆盖页范围", () => {
    const note = coverageNoteOf({ startPage: 1, requestedPages: 3, completedPages: 3, failedPages: [], stopReason: "all-pages-done" });
    expect(note).toContain("第 1～3 页");
    expect(note).toContain("不宣称已扫完");
  });

  it("部分失败时列出未覆盖页，不标记为成功覆盖", () => {
    const note = coverageNoteOf({ startPage: 4, requestedPages: 3, completedPages: 2, failedPages: [5], stopReason: "page-failed" });
    expect(note).toContain("第 4～5 页");
    expect(note).toContain("第 5 页失败未覆盖");
  });

  it("全部失败与超时运行不冒充覆盖", () => {
    expect(coverageNoteOf({ startPage: 1, requestedPages: 2, completedPages: 0, failedPages: [1, 2], stopReason: "all-pages-failed" })).toContain("无页面成功覆盖");
    expect(coverageNoteOf({ startPage: 1, requestedPages: 2, completedPages: 0, failedPages: [], stopReason: "stale-timeout" })).toContain("覆盖情况未知");
  });
});
