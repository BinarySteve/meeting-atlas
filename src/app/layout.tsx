import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "./app-shell";
import { APP_DESCRIPTION, APP_NAME, APP_SHORT_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_SHORT_NAME}` },
  description: APP_DESCRIPTION,
  applicationName: APP_NAME,
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: APP_SHORT_NAME },
  formatDetection: { telephone: false },
  icons: { icon: [{ url: "/icons/meeting-atlas-32.png", type: "image/png", sizes: "32x32" }, { url: "/icons/meeting-atlas-192.png", type: "image/png", sizes: "192x192" }], apple: [{ url: "/icons/meeting-atlas-apple-180.png", type: "image/png", sizes: "180x180" }] },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#315efb" };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body><AppShell>{children}</AppShell></body>
    </html>
  );
}
