import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { basePath } from "@/lib/config";

/**
 * Content-Security-Policy as a meta tag (static hosts can't set headers).
 * `connect-src 'self'` means the page cannot send data to any other host, even
 * if a bug or injected script tried: the app's "your data stays on your device"
 * promise is enforced by the browser. Inline scripts are required by the Next.js
 * static runtime; dev mode also needs eval for hot reload, so the policy is only
 * applied to production builds.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
].join("; ");

export const metadata: Metadata = {
  title: { default: "HomeworkFlow", template: "%s · HomeworkFlow" },
  description: "Plan, time and track homework. Private to a student and their linked parent.",
  manifest: `${basePath}/manifest.webmanifest`,
  // No public pages and no public profiles: keep everything out of search indexes.
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "HomeworkFlow", statusBarStyle: "default" },
  icons: { icon: `${basePath}/icon.svg`, apple: `${basePath}/icons/icon-192.png` },
  referrer: "no-referrer",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f6fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1220" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {process.env.NODE_ENV === "production" ? <meta httpEquiv="Content-Security-Policy" content={CSP} /> : null}
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
