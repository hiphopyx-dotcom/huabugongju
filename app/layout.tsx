import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "剧爆棚 · AI影像创作工作台",
  description: "剧本、分镜、画布、剪辑和云端项目工作台。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
