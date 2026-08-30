import type { Metadata } from "next";
import { AdminLoginForm } from "@/components/admin-login-form";

export const metadata: Metadata = { title: "管理员登录" };

export default function LoginPage() {
  return (
    <main className="login-page">
      <AdminLoginForm />
    </main>
  );
}
