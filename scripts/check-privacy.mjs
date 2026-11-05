#!/usr/bin/env node
// Guards the "your data stays on your device" promise (PRD X1). Run by `npm run check`.
//
// HomeworkFlow has no server, so app code must never talk to the network. Fails if
// anything under src/ (or the config files) uses a network API or hard-codes an
// external URL, or if a secret-looking NEXT_PUBLIC_ variable name appears.
// (public/sw.js legitimately calls fetch() to cache the app's own same-origin
// files, so it is only checked for external URLs.)
// The browser enforces the same rule at runtime through the CSP in src/app/layout.tsx.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCAN_DIRS = ["src", "public"];
const SCAN_FILES = ["next.config.ts", ".env.example", "package.json"];
const EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".css", ".html", ".svg", ".webmanifest", ".example", ""]);
const SKIP = new Set(["node_modules", ".git"]);

const NETWORK_APIS = [
  [/\bfetch\s*\(/, "fetch()"],
  [/\bXMLHttpRequest\b/, "XMLHttpRequest"],
  [/\bWebSocket\b/, "WebSocket"],
  [/\bEventSource\b/, "EventSource"],
  [/\bsendBeacon\b/, "navigator.sendBeacon"],
  [/\bimport\s*\(\s*["'`]https?:/, "dynamic import of a URL"],
];
// Allowed external-looking strings: XML/SVG namespaces and docs links in comments are not requests,
// but to stay strict only these exact prefixes are tolerated.
const ALLOWED_URL = [/^https?:\/\/www\.w3\.org\//, /^https?:\/\/localhost/, /^https?:\/\/127\.0\.0\.1/, /^https:\/\/react\.dev\/errors/];
const URL_RE = /https?:\/\/[^\s"'`)<>]+/g;
const PUBLIC_SECRET = /NEXT_PUBLIC_[A-Z0-9_]*(SECRET|SERVICE|PRIVATE|PASSWORD|TOKEN|KEY)/;

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (EXT.has(path.extname(entry))) yield full;
  }
}

/** Returns human-readable problems found under `root`. */
export function findProblems(root) {
  const files = [...SCAN_DIRS.flatMap((d) => [...walk(path.join(root, d))]), ...SCAN_FILES.map((f) => path.join(root, f)).filter((f) => existsSync(f))];
  const problems = [];
  for (const file of files) {
    const rel = path.relative(root, file);
    const text = readFileSync(file, "utf8");
    const isServiceWorker = rel === path.join("public", "sw.js");
    if (!isServiceWorker) {
      for (const [re, name] of NETWORK_APIS) if (re.test(text)) problems.push(`${rel}: uses ${name}`);
    }
    for (const m of text.matchAll(URL_RE)) {
      if (!ALLOWED_URL.some((a) => a.test(m[0]))) problems.push(`${rel}: external URL ${m[0].slice(0, 60)}`);
    }
    if (PUBLIC_SECRET.test(text)) problems.push(`${rel}: a NEXT_PUBLIC_ variable name looks like a secret`);
  }
  return problems;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const problems = findProblems(root);
  if (problems.length > 0) {
    console.error("Privacy check FAILED:\n" + problems.map((p) => `  - ${p}`).join("\n"));
    process.exit(1);
  }
  console.log("Privacy check passed: no network APIs or external URLs in app code.");
}
