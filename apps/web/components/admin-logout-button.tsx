"use client";

import { SignOut } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function AdminLogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function logout() {
    setLoading(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace("/login");
      router.refresh();
      setLoading(false);
    }
  }

  return (
    <button className="sidebar-logout" disabled={loading} onClick={logout} type="button">
      <SignOut size={16} aria-hidden="true" />
      <span>{loading ? "正在退出" : "退出管理"}</span>
    </button>
  );
}
