import { getSystemHealth } from "@/src/server/health";
import { adminApiError } from "@/src/server/auth/admin-request";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = adminApiError(request);
  if (guard) return guard;
  const services = await getSystemHealth();
  return Response.json({
    mode: services.some((service) => service.state === "not-configured") ? "demo" : "connected",
    services,
    checkedAt: new Date().toISOString(),
  });
}
