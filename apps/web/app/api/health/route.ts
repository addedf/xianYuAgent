import { getSystemHealth } from "@/src/server/health";

export const dynamic = "force-dynamic";

export async function GET() {
  const services = await getSystemHealth();
  return Response.json({
    mode: services.some((service) => service.state === "not-configured") ? "demo" : "connected",
    services,
    checkedAt: new Date().toISOString(),
  });
}

