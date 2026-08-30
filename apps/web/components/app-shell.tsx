import Link from "next/link";
import { PauseCircle, Scan, ShieldCheck } from "@phosphor-icons/react/dist/ssr";
import { MobileNav } from "./mobile-nav";
import { SidebarNav } from "./sidebar-nav";
import { AdminLogoutButton } from "./admin-logout-button";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <Link className="brand-lockup" href="/" aria-label="闲鱼二奢机会雷达首页">
          <span className="brand-mark" aria-hidden="true">
            <Scan size={22} weight="bold" />
          </span>
          <span>
            <strong>机会雷达</strong>
            <small>二奢鉴别工作台</small>
          </span>
        </Link>

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
          <span className="mobile-mode">演示模式</span>
        </header>
        <main className="workspace">{children}</main>
        <MobileNav />
      </div>
    </div>
  );
}
