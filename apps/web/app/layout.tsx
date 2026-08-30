import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "闲鱼二奢机会雷达",
    template: "%s | 闲鱼二奢机会雷达",
  },
  description: "面向二奢回收商家的本地货源机会雷达、鉴别助手与沟通副驾。",
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "oklch(0.982 0.002 230)",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
