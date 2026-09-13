import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const viewport: Viewport = { themeColor: "#101418" };

export const metadata: Metadata = {
  title: {
    default: "YASEZ Commerce — AI that turns messages into orders",
    template: "%s · YASEZ Commerce",
  },
  description: "Multi-tenant AI sales & order automation for small businesses: real inventory checks, order confirmation, and human handoff.",
  icons: { icon: "/icon.svg" },
  openGraph: {
    title: "YASEZ Commerce — AI that turns messages into orders",
    description: "Connect WhatsApp. The AI checks real stock, confirms orders, and hands off to humans when needed.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
