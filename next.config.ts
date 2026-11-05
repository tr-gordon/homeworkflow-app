import type { NextConfig } from "next";

// Normalise "", "/x", "x/" to "" or "/x" (same rules as src/lib/config.ts).
const raw = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").trim().replace(/^\/+|\/+$/g, "");
const basePath = raw === "" ? "" : `/${raw}`;

/**
 * HomeworkFlow is a fully static app (like MEDS): `next build` writes plain
 * files to ./out that any static host can serve (for example GitHub Pages).
 * There is no server, no API and no database. Security headers therefore can't be
 * set by this app; the Content-Security-Policy is delivered as a <meta> tag in
 * src/app/layout.tsx instead.
 */
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  basePath,
  // Next 16 otherwise generates and edits agent instruction files (AGENTS.md) during
  // `next dev` when it detects an AI coding agent. Keep repo files under manual control.
  agentRules: false,
  reactStrictMode: true,
};

export default nextConfig;
