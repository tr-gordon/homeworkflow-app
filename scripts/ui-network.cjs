// A stalled connection must never freeze the app, and updates must still arrive.
// Serves ./out itself with a switchable stall, so no other server is needed.
//
//   NEXT_PUBLIC_BASE_PATH=/homeworkflow-app npm run build
//   BASE_PATH=/homeworkflow-app node scripts/ui-network.cjs
//
// Needs Playwright (globally installed or via NODE_PATH). Uses only fictional names.
const { chromium } = require("playwright");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const BASE_PATH = (process.env.BASE_PATH || "/homeworkflow-app").replace(/\/$/, "");
const ROOT = path.resolve(process.env.OUT_DIR || path.join(__dirname, "..", "out"));
const STALL_MS = 20000;
const PORT = 3810;
const BASE = `http://localhost:${PORT}${BASE_PATH}`;
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
};

let delay = 0;
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".txt": "text/plain", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/__delay") {
    delay = Number(u.searchParams.get("ms") || 0);
    res.end("ok");
    return;
  }
  if (!u.pathname.startsWith(BASE_PATH)) { res.statusCode = 404; res.end(); return; }
  let p = path.join(ROOT, decodeURIComponent(u.pathname.slice(BASE_PATH.length)));
  if (!p.startsWith(ROOT)) { res.statusCode = 403; res.end(); return; }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, "index.html");
  setTimeout(() => {
    if (!fs.existsSync(p)) { res.statusCode = 404; res.end("not found"); return; }
    res.setHeader("Content-Type", types[path.extname(p)] || "application/octet-stream");
    fs.createReadStream(p).pipe(res);
  }, delay);
});

(async () => {
  if (!fs.existsSync(path.join(ROOT, "index.html"))) throw new Error(`No build in ${ROOT}. Run the build first.`);
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const stall = (ms) => ctx.request.get(`http://localhost:${PORT}/__delay?ms=${ms}`);
  const timed = async (fn) => {
    const t0 = Date.now();
    try { await fn(); return Date.now() - t0; } catch { return null; }
  };

  // normal first visit (installs the service worker and its cache)
  await page.goto(BASE + "/");
  await page.getByRole("radio", { name: /A student's device/ }).click();
  await page.getByLabel("Student's first name or nickname").fill("Sam Sample");
  await page.getByRole("button", { name: "Get started" }).click();
  await page.getByRole("heading", { name: "Hi, Sam" }).waitFor();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await page.getByRole("heading", { name: "Today's plan" }).waitFor();
  await page.waitForTimeout(800);

  // the network now stalls: connected, but nothing arrives for 20 s
  await stall(STALL_MS);
  const limit = STALL_MS + 10000;
  const reload = await timed(async () => {
    await page.reload({ timeout: limit, waitUntil: "commit" });
    await page.getByRole("heading", { name: "Today's plan" }).waitFor({ timeout: limit });
  });
  check("opening the app is instant while the network stalls", reload !== null && reload < 3000, `(${reload} ms; the stall is ${STALL_MS} ms)`);
  const tap = await timed(async () => {
    await page.getByRole("link", { name: "Add", exact: true }).first().click();
    await page.getByRole("heading", { name: "Add an assignment" }).waitFor({ timeout: limit });
  });
  check("tapping a page you have not opened yet responds within a few seconds", tap !== null && tap < 6000, `(${tap} ms)`);
  const data = await page.evaluate(() => JSON.parse(localStorage.getItem("homeworkflow.v2")).displayName);
  check("the data is untouched", data === "Sam Sample");

  // offline altogether
  await stall(0);
  await ctx.setOffline(true);
  const off = await timed(async () => {
    await page.goto(BASE + "/student/", { timeout: 15000 });
    await page.getByRole("heading", { name: "Today's plan" }).waitFor({ timeout: 15000 });
  });
  check("opens offline", off !== null, `(${off} ms)`);
  await ctx.setOffline(false);

  // updates still arrive: instant from cache now, fresh on the next open.
  // (A fresh browser profile: a set-up device would redirect away from the page carrying the marker.)
  const marked = path.join(ROOT, "setup", "index.html");
  const original = fs.readFileSync(marked, "utf8");
  const upd = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const up = await upd.newPage();
  const marker = () => up.evaluate(() => document.querySelector('meta[name="hwf-marker"]')?.getAttribute("content") ?? "none");
  try {
    await up.goto(BASE + "/setup/");
    await up.getByRole("heading", { name: "Welcome" }).waitFor();
    await up.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await up.reload();
    await up.getByRole("heading", { name: "Welcome" }).waitFor();
    const before = await marker();
    fs.writeFileSync(marked, original.replace("</head>", '<meta name="hwf-marker" content="v2"></head>')); // a new deploy
    await up.reload();
    await up.getByRole("heading", { name: "Welcome" }).waitFor();
    await up.waitForTimeout(1500); // the background refresh
    const first = await marker();
    await up.reload();
    await up.getByRole("heading", { name: "Welcome" }).waitFor();
    const second = await marker();
    check("a new deploy arrives (at the latest on the second open)", before === "none" && second === "v2", `(before: ${before}, first open: ${first}, second open: ${second})`);
  } finally {
    fs.writeFileSync(marked, original);
    await upd.close();
  }

  await browser.close();
  server.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error("SCRIPT ERROR", e.message.split("\n").slice(0, 6).join("\n"));
  server.close();
  process.exit(2);
});
