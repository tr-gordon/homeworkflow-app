import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script without type declarations
import { findProblems } from "../../scripts/check-privacy.mjs";

function project(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "hwf-privacy-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

describe("check-privacy (X1)", () => {
  it("passes ordinary app code", () => {
    expect(findProblems(project({ "src/a.ts": "const x = localStorage.getItem('k'); // https://www.w3.org/2000/svg" }))).toEqual([]);
  });

  it.each([
    ["fetch", "await fetch('/x')"],
    ["XMLHttpRequest", "new XMLHttpRequest()"],
    ["WebSocket", "new WebSocket('wss://a')"],
    ["sendBeacon", "navigator.sendBeacon('/log')"],
  ])("flags %s in app code", (_n, code) => {
    expect(findProblems(project({ "src/a.ts": code })).length).toBeGreaterThan(0);
  });

  it("flags an external URL (analytics, CDN, API)", () => {
    expect(findProblems(project({ "src/a.tsx": '<script src="https://cdn.example.com/x.js" />' })).join()).toMatch(/external URL/);
  });

  it("lets the service worker call fetch for same-origin caching, but not reach external URLs", () => {
    expect(findProblems(project({ "public/sw.js": "fetch(request)" }))).toEqual([]);
    expect(findProblems(project({ "public/sw.js": "fetch('https://evil.example/x')" })).join()).toMatch(/external URL/);
  });

  it("flags secret-looking public env names", () => {
    expect(findProblems(project({ ".env.example": "NEXT_PUBLIC_API_KEY=\n" })).join()).toMatch(/looks like a secret/);
  });
});
