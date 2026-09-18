import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "MYOPC 工作台", description: "让每一次行动改变下一轮的起点", icons: { icon: "/icon.svg" } };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}

