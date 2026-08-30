import { describe, expect, it } from "vitest";
import { isSameOriginMutation } from "./admin-request";

describe("isSameOriginMutation", () => {
  it("uses the actual host header when an application server normalizes request.url", () => {
    const request = new Request("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" },
    });
    expect(isSameOriginMutation(request)).toBe(true);
  });

  it("rejects cross-origin and originless mutations", () => {
    expect(isSameOriginMutation(new Request("http://localhost:3000/api/auth/login", { method: "POST" }))).toBe(false);
    expect(isSameOriginMutation(new Request("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { host: "localhost:3000", origin: "https://evil.example" },
    }))).toBe(false);
  });
});
