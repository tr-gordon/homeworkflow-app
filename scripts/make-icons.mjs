// Renders public/icon.svg to the PNG sizes the web manifest needs.
// Uses the Playwright Chromium available in the dev environment; run manually:
//   node scripts/make-icons.mjs
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";

// createRequire so a globally installed Playwright (NODE_PATH) can be found.
const { chromium } = createRequire(import.meta.url)("playwright");

const svg = readFileSync(new URL("../public/icon.svg", import.meta.url), "utf8");
const browser = await chromium.launch();
const page = await browser.newPage();

async function render(size, name, { padding = 0 } = {}) {
  await page.setViewportSize({ width: size, height: size });
  const inner = size - padding * 2;
  await page.setContent(
    `<body style="margin:0;background:#4f46e5;display:grid;place-items:center;height:100vh">
       <div style="width:${inner}px;height:${inner}px">${svg.replace("<svg ", `<svg width="${inner}" height="${inner}" `)}</div>
     </body>`,
  );
  writeFileSync(new URL(`../public/icons/${name}`, import.meta.url), await page.screenshot({ type: "png" }));
}

await render(192, "icon-192.png");
await render(512, "icon-512.png");
// Maskable icons need a safe zone: keep the artwork in the inner ~80%.
await render(512, "icon-maskable-512.png", { padding: 52 });
await browser.close();
