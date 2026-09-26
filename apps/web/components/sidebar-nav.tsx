"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Books,
  CaretRight,
  Gauge,
  ListMagnifyingGlass,
  Prohibit,
  SlidersHorizontal,
} from "@phosphor-icons/react";

const navItems = [
  { href: "/", label: "今日概览", icon: Gauge },
  { href: "/leads", label: "线索审阅", icon: ListMagnifyingGlass },
  { href: "/exclusions", label: "排除管理", icon: Prohibit },
  { href: "/knowledge", label: "经验知识库", icon: Books },
  { href: "/settings", label: "连接与控制", icon: SlidersHorizontal },
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="sidebar-nav" aria-label="主导航">
      {navItems.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link key={item.href} href={item.href} className="sidebar-link" aria-label={item.label} title={item.label} aria-current={active ? "page" : undefined}>
            <Icon size={19} weight={active ? "fill" : "regular"} aria-hidden="true" />
            <span>{item.label}</span>
            <CaretRight className="sidebar-link-caret" size={15} aria-hidden="true" />
          </Link>
        );
      })}
    </nav>
  );
}
