import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { XianyuAuthRequiredNotice } from "./xianyu-auth-required-notice";

describe("XianyuAuthRequiredNotice", () => {
  it("explains why real items are unavailable and links to account connection", () => {
    const html = renderToStaticMarkup(<XianyuAuthRequiredNotice />);

    expect(html).toContain("先完成闲鱼账号鉴权");
    expect(html).toContain("系统不会发起商品搜索");
    expect(html).toContain('href="/settings#xianyu-account"');
    expect(html).toContain("扫码，或在闲鱼官方窗口");
    expect(html).toContain("前往账号连接");
  });
});
