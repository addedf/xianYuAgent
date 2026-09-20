import { getSystemHealth } from "@/src/server/health";
import { adminApiError } from "@/src/server/auth/admin-request";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = adminApiError(request);
  if (guard) return guard;
  const services = await getSystemHealth();
  const requiredServices = services.filter((service) => service.name !== "wecom");
  return Response.json({
    mode: requiredServices.some((service) => service.state !== "ready") ? "demo" : "connected",
    services,
    checkedAt: new Date().toISOString(),
  });
}
