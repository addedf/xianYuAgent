"use client";

import Link from "next/link";
import { CaretLeft, CaretRight, PauseCircle, Scan, ShieldCheck } from "@phosphor-icons/react";
import { useSyncExternalStore } from "react";
import { MobileNav } from "./mobile-nav";
import { SidebarNav } from "./sidebar-nav";
import { AdminLogoutButton } from "./admin-logout-button";

function readSidebarPreference() {
  try {
    return window.localStorage.getItem("xianyu-sidebar-collapsed") === "true";
  } catch {
    return false;
  }
}

function subscribeSidebarPreference(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener("xianyu-sidebar-preference-change", onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener("xianyu-sidebar-preference-change", onChange);
  };
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const sidebarCollapsed = useSyncExternalStore(subscribeSidebarPreference, readSidebarPreference, () => false);

  function toggleSidebar() {
    try {
      window.localStorage.setItem("xianyu-sidebar-collapsed", String(!sidebarCollapsed));
      window.dispatchEvent(new Event("xianyu-sidebar-preference-change"));
    } catch {
      // Leave the menu expanded when browser storage is unavailable.
    }
  }

  return (
    <div className="app-shell" data-sidebar-collapsed={sidebarCollapsed}>
      <aside className="app-sidebar">
        <div className="sidebar-brand-row">
          <Link className="brand-lockup" href="/" aria-label="闲鱼二奢机会雷达首页">
            <span className="brand-mark" aria-hidden="true">
              <Scan size={22} weight="bold" />
            </span>
            <span className="brand-copy">
              <strong>机会雷达</strong>
              <small>二奢鉴别工作台</small>
            </span>
          </Link>
          <button
            className="sidebar-collapse-toggle"
            type="button"
            onClick={toggleSidebar}
            aria-label={sidebarCollapsed ? "展开菜单" : "折叠菜单"}
            aria-expanded={!sidebarCollapsed}
            title={sidebarCollapsed ? "展开菜单" : "折叠菜单"}
          >
            {sidebarCollapsed ? <CaretRight size={17} weight="bold" /> : <CaretLeft size={17} weight="bold" />}
          </button>
        </div>

        <SidebarNav />

        <div className="sidebar-control" aria-label="外发安全状态">
          <div className="sidebar-control-title">
            <PauseCircle size={18} weight="fill" aria-hidden="true" />
            <strong>主动询价已暂停</strong>
          </div>
          <p>当前只做监控、判断与通知。真实消息适配器尚未启用。</p>
        </div>

        <div className="sidebar-trust">
          <ShieldCheck size={17} weight="fill" aria-hidden="true" />
          <span>本地运行 · 凭据不入日志</span>
        </div>
        <AdminLogoutButton />
      </aside>

      <div className="app-content">
        <header className="mobile-header">
          <Link className="mobile-brand" href="/">
            <Scan size={20} weight="bold" aria-hidden="true" />
            <strong>机会雷达</strong>
          </Link>
        </header>
        <main className="workspace">{children}</main>
        <MobileNav />
      </div>
    </div>
  );
}
