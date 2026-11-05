/**
 * Runtime mode. HomeworkFlow has no server, no database and no accounts: data
 * lives in this browser's localStorage. The only switch is demo mode, which
 * seeds FICTIONAL sample data under a separate storage key (PRD X6).
 *
 * NEXT_PUBLIC_BASE_PATH is the sub-path when hosted on GitHub Pages
 * (for example "/Homeworkflow"). Both values are public build-time settings.
 */

export type AppMode = { kind: "local" } | { kind: "demo" };

export interface RawEnv {
  NEXT_PUBLIC_DEMO_MODE?: string;
}

export function resolveMode(env: RawEnv): AppMode {
  return env.NEXT_PUBLIC_DEMO_MODE?.trim().toLowerCase() === "true" ? { kind: "demo" } : { kind: "local" };
}

/** Normalises "", "/x", "x/" and "/x/" to "" or "/x". */
export function normalizeBasePath(raw: string | undefined): string {
  const t = (raw ?? "").trim().replace(/^\/+|\/+$/g, "");
  return t === "" ? "" : `/${t}`;
}

// Next.js inlines NEXT_PUBLIC_* only for direct `process.env.NAME` references.
export const appMode: AppMode = resolveMode({ NEXT_PUBLIC_DEMO_MODE: process.env.NEXT_PUBLIC_DEMO_MODE });
export const basePath: string = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH);
