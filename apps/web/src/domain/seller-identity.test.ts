import { describe, expect } from "vitest";
import { test } from "vitest";

import {
  isAnonymousNickname,
  sellerIdentityCandidates,
  strongIdentityKey,
  weakIdentityKey,
} from "./seller-identity";

test("弱身份键与采集器 seller_key 同格式", () => {
  expect(weakIdentityKey("张三", "广东广州")).toBe("张三|广东广州");
  expect(weakIdentityKey(" 张三 ", " 广东广州 ")).toBe("张三|广东广州");
  expect(weakIdentityKey(null, null)).toBe("|");
});

test("稳定身份键带平台前缀", () => {
  expect(strongIdentityKey("2208691234567")).toBe("xianyu-user-2208691234567");
});

test("匿名占位识别：空昵称与占位词都算匿名", () => {
  expect(isAnonymousNickname("")).toBe(true);
  expect(isAnonymousNickname("匿名卖家")).toBe(true);
  expect(isAnonymousNickname("用户_77881740")).toBe(false);
});

test("只有弱身份时返回单一候选", () => {
  expect(sellerIdentityCandidates({ displayName: "小明", region: "广州" })).toEqual([
    { key: "小明|广州", type: "nickname-area" },
  ]);
});

test("有稳定 ID 时弱身份与稳定身份都参与匹配（改昵称后黑名单仍生效）", () => {
  const candidates = sellerIdentityCandidates({ displayName: "小明", region: "广州", stableId: "123" });
  expect(candidates).toEqual([
    { key: "xianyu-user-123", type: "stable" },
    { key: "小明|广州", type: "nickname-area" },
  ]);
});

test("匿名占位身份标记为 anonymous，供排除服务拒绝整组拉黑", () => {
  const candidates = sellerIdentityCandidates({ displayName: "匿名卖家", region: "天河区" });
  expect(candidates).toEqual([{ key: "匿名卖家|天河区", type: "anonymous" }]);
});

test("稳定键与弱键相同时不重复返回", () => {
  // 构造不可能的输入（昵称恰好是前缀形式），防御性验证去重。
  const candidates = sellerIdentityCandidates({ displayName: "xianyu-user-1", region: "", stableId: "x" });
  const keys = candidates.map((candidate) => candidate.key);
  expect(new Set(keys).size).toBe(keys.length);
});
