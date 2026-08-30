"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Books, Gauge, ListMagnifyingGlass, SlidersHorizontal } from "@phosphor-icons/react";

const items = [
  { href: "/", label: "概览", icon: Gauge },
  { href: "/leads", label: "线索", icon: ListMagnifyingGlass },
  { href: "/knowledge", label: "知识", icon: Books },
  { href: "/settings", label: "控制", icon: SlidersHorizontal },
];

export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav className="mobile-nav" aria-label="移动端主导航">
      {items.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}>
            <Icon size={19} weight={active ? "fill" : "regular"} aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

