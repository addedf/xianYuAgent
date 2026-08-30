import { AppShell } from "@/components/app-shell";
import { requireAdminPage } from "@/src/server/auth/admin-request";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  await requireAdminPage();
  return <AppShell>{children}</AppShell>;
}
