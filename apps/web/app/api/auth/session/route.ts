import { isAdminApiRequest } from "@/src/server/auth/admin-request";
import { adminAuthConfigurationError } from "@/src/server/auth/admin-session";
import { getServerEnv } from "@/src/server/env";

export async function GET(request: Request) {
  return Response.json({
    configured: !adminAuthConfigurationError(getServerEnv()),
    authenticated: isAdminApiRequest(request),
  });
}
