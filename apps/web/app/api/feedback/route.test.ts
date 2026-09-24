import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adminApiError: vi.fn(() => null),
  insert: vi.fn(),
}));

vi.mock("@/src/server/auth/admin-request", () => ({ adminApiError: mocks.adminApiError }));
vi.mock("@/src/server/db/client", () => ({
  getDatabase: () => ({ db: { insert: mocks.insert } }),
}));

import { POST } from "./route";

const listingId = "11111111-1111-4111-8111-111111111111";
const assessmentId = "22222222-2222-4222-8222-222222222222";

function request(body: unknown) {
  return new Request("http://127.0.0.1:3000/api/feedback", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000" },
    body: JSON.stringify(body),
  });
}

describe("feedback route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: "33333333-3333-4333-8333-333333333333" }]),
      }),
    });
  });

  it("persists a manual opinion with its assessment reference", async () => {
    const response = await POST(request({ listingId, assessmentId, feedbackType: "manual-feedback", reason: "补充序列号照片后再判断。" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
    expect(mocks.insert).toHaveBeenCalledOnce();
  });

  it("requires written content instead of a preset judgement button", async () => {
    const response = await POST(request({ listingId, feedbackType: "manual-feedback", reason: "   " }));

    expect(response.status).toBe(400);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
