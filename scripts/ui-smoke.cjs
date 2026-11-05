// End-to-end smoke test of the STATIC build with two separate browser contexts acting as two devices
// (a student's phone and a parent's phone) exchanging files. Not part of `npm run check`.
//
//   NEXT_PUBLIC_BASE_PATH=/Homeworkflow npm run build
//   mkdir -p /tmp/site && ln -sfn "$PWD/out" /tmp/site/Homeworkflow && (cd /tmp/site && python3 -m http.server 3300 &)
//   BASE=http://localhost:3300/Homeworkflow node scripts/ui-smoke.cjs
//
// Needs Playwright (globally installed or via NODE_PATH). Uses only fictional names.
const { chromium } = require("playwright");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BASE = process.env.BASE || "http://localhost:3300/Homeworkflow";
const OUT = process.env.OUT || fs.mkdtempSync(path.join(os.tmpdir(), "hwf-smoke-"));
const origin = new URL(BASE).origin;
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
};
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = new Date();
const yesterday = new Date(today.getTime() - 86400000);
const tomorrow = new Date(today.getTime() + 86400000);

(async () => {
  const browser = await chromium.launch();
  const problems = { console: [], external: [] };
  let offlineWindow = false; // failed background prefetches while deliberately offline are expected
  const newDevice = async (name, viewport) => {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, acceptDownloads: true, serviceWorkers: "allow" });
    const page = await ctx.newPage();
    page.on("console", (m) => m.type() === "error" && !offlineWindow && problems.console.push(`${name}: ${m.text()}`));
    page.on("pageerror", (e) => problems.console.push(`${name}: pageerror ${e.message}`));
    page.on("request", (r) => {
      const u = r.url();
      if (!u.startsWith(origin) && !u.startsWith("data:") && !u.startsWith("blob:")) problems.external.push(u);
    });
    return { ctx, page };
  };
  const noOverflow = async (page, label) => {
    const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    check(`no horizontal scroll: ${label}`, w[0] <= w[1], `(${w[0]} vs ${w[1]})`);
  };

  const S = await newDevice("student", { width: 390, height: 844 });
  const P = await newDevice("parent", { width: 390, height: 844 });
  const s = S.page;
  const p = P.page;

  // ---------- Student device: first run
  await s.goto(BASE + "/");
  await s.getByRole("heading", { name: "Welcome" }).waitFor();
  check("first run shows setup (no sign-in, no accounts)", !(await s.locator("body").innerText()).match(/password|sign in/i));
  await s.screenshot({ path: path.join(OUT, "01-setup.png"), fullPage: true });
  await s.getByRole("radio", { name: /A student's device/ }).click();
  await s.getByLabel("Student's first name or nickname").fill("Sam Sample");
  await s.getByLabel("Parent's name").fill("Pat Sample");
  await s.getByLabel("Parent PIN (4 to 8 digits)").fill("2468");
  await s.getByRole("button", { name: "Get started" }).click();
  await s.getByRole("heading", { name: "Hi, Sam" }).waitFor();
  check("student setup lands on the student dashboard", true);
  check("served under the sub-path", s.url().includes(new URL(BASE).pathname));

  // ---------- Add assignments
  const add = async (title, due, alloc) => {
    await s.getByRole("link", { name: "Add", exact: true }).first().click();
    await s.getByLabel("What is it?").fill(title);
    await s.getByLabel("Subject").fill("Math");
    await s.getByLabel("Due date").fill(due);
    await s.getByRole("radio", { name: /3, Medium/ }).click();
    if (alloc) await s.getByLabel(/How long will you give it/).fill(String(alloc));
    await s.getByRole("button", { name: "Add assignment" }).click();
    await s.getByRole("heading", { name: title }).waitFor();
  };
  await add("Fractions worksheet", ymd(today), 30);
  await add("Geometry practice", ymd(yesterday), 20);
  await add("Reading log", ymd(tomorrow), null);
  check("assignments created and opened (query-string route)", /assignment\/?\?id=/.test(s.url()));
  await s.getByRole("link", { name: "Today", exact: true }).first().click();
  await s.getByRole("heading", { name: "Today's plan" }).waitFor();
  check("overdue assignment flagged with text and icon", await s.getByText("1 day overdue").first().isVisible());
  check("progress shown as words, not percentages", !(await s.locator("body").innerText()).match(/\d+\s?%/));
  await s.screenshot({ path: path.join(OUT, "02-student-dashboard.png"), fullPage: true });
  await noOverflow(s, "student dashboard");

  // ---------- Timer survives a refresh
  await s.getByRole("link", { name: /Fractions worksheet/ }).first().click();
  await s.getByRole("button", { name: "Start timer" }).click();
  await s.getByRole("button", { name: "Pause" }).waitFor();
  await s.waitForTimeout(3200);
  await s.reload();
  await s.getByRole("button", { name: "Pause" }).waitFor();
  const clock = await s.getByRole("timer").innerText();
  const secs = clock.split(":").reduce((a, x) => a * 60 + Number(x), 0);
  check("timer still running after a page refresh", secs >= 3, `(shows ${clock})`);
  await s.getByRole("button", { name: "Pause" }).click();
  await s.getByRole("button", { name: "Resume" }).waitFor();
  await s.reload();
  await s.getByRole("button", { name: "Resume" }).waitFor();
  check("paused state survives a refresh", true);
  await s.getByRole("button", { name: "Resume" }).click();
  await s.getByRole("button", { name: "Finish" }).click();
  await s.getByText(/Session saved/).waitFor();
  await s.getByRole("radio", { name: "Halfway" }).click();
  await s.getByRole("radio", { name: "Halfway", checked: true }).waitFor();
  check("timer finished and stage set in words", true);

  // ---------- Parent view on the shared student device (PIN)
  await s.getByRole("button", { name: "Parent view" }).click();
  await s.getByLabel("Parent PIN").fill("0000");
  await s.getByRole("button", { name: "Open" }).click();
  await s.getByText("That PIN isn't right.").waitFor();
  check("wrong PIN is refused", true);
  await s.getByLabel("Parent PIN").fill("2468");
  await s.getByRole("button", { name: "Open" }).click();
  await s.getByRole("heading", { name: /Sam Sample's homework/ }).waitFor();
  check("correct PIN opens the parent view", true);
  await s.getByRole("tab", { name: /All active/ }).click();
  const card = s.locator("article", { hasText: "Fractions worksheet" });
  await card.getByRole("button", { name: "Change time" }).click();
  await card.getByLabel("Planned minutes").fill("45");
  await card.getByRole("button", { name: "Save time" }).click();
  await card.getByText("Planned 45 min").waitFor();
  check("parent view changed the allocation directly (no approval)", true);
  await s.screenshot({ path: path.join(OUT, "03-parent-view-on-student-device.png"), fullPage: true });
  await s.getByRole("button", { name: "Student view" }).click();
  await s.getByRole("heading", { name: "Today's plan" }).waitFor();
  await s.getByRole("link", { name: /Fractions worksheet/ }).first().click();
  await s.getByRole("heading", { name: "Fractions worksheet" }).waitFor();
  const hist1 = await s.locator("ol").innerText();
  check("student sees the parent's change with name and role", /Pat Sample \(parent\) changed the time from 30 min to 45 min/.test(hist1), `(${hist1.replace(/\n+/g, " | ").slice(0, 120)})`);
  await noOverflow(s, "student detail");

  // ---------- Student exports a snapshot file
  await s.getByRole("link", { name: "Share", exact: true }).first().click();
  await s.getByRole("heading", { name: "Share", exact: true }).waitFor();
  const [dl] = await Promise.all([s.waitForEvent("download"), s.getByRole("button", { name: "Share my homework file" }).click()]);
  const snapshotPath = path.join(OUT, dl.suggestedFilename());
  await dl.saveAs(snapshotPath);
  check("snapshot downloaded with a readable name", /^homeworkflow-snapshot-sam-sample-\d{4}-\d{2}-\d{2}\.json$/.test(dl.suggestedFilename()), `(${dl.suggestedFilename()})`);
  await s.screenshot({ path: path.join(OUT, "04-student-share.png"), fullPage: true });

  // ---------- Parent device: set up, import the snapshot, change time, export changes
  await p.goto(BASE + "/");
  await p.getByRole("heading", { name: "Welcome" }).waitFor();
  await p.getByRole("radio", { name: /A parent's device/ }).click();
  await p.getByLabel("Your first name").fill("Pat Sample");
  await p.getByRole("button", { name: "Get started" }).click();
  await p.getByRole("heading", { name: /Hi, Pat/ }).waitFor();
  check("parent device shows the empty state with a way to import", await p.getByRole("link", { name: "Open a homework file" }).isVisible());
  await p.getByRole("link", { name: "Open a homework file" }).click();
  await p.locator('input[aria-label="Open a homework file"]').setInputFiles(snapshotPath);
  await p.getByText(/Updated Sam Sample: 3 assignment/).waitFor();
  check("parent imported the student's snapshot", true);
  await p.getByRole("link", { name: "Dashboard", exact: true }).first().click();
  await p.getByRole("heading", { name: /Sam Sample's homework/ }).waitFor();
  check("parent sees data-as-of banner", await p.getByText(/as of/).first().isVisible());
  await p.getByRole("tab", { name: /All active/ }).click();
  check("parent sees all of the student's assignments", (await p.locator("article").count()) === 3);
  check("parent cannot edit or delete (no controls)", (await p.getByRole("button", { name: /Delete assignment|Start timer/ }).count()) === 0);
  await p.screenshot({ path: path.join(OUT, "05-parent-dashboard.png"), fullPage: true });
  await noOverflow(p, "parent dashboard");
  const pcard = p.locator("article", { hasText: "Fractions worksheet" });
  await pcard.getByRole("button", { name: "Change time" }).click();
  await pcard.getByLabel("Planned minutes").fill("50");
  await pcard.getByRole("button", { name: "Save time" }).click();
  await pcard.getByText("Planned 50 min").waitFor();
  check("parent changed allocation; unsent banner shown", await p.getByText(/1 time change not sent/).isVisible());
  await p.getByRole("link", { name: "Share", exact: true }).first().click();
  const [dl2] = await Promise.all([p.waitForEvent("download"), p.getByRole("button", { name: /Send my changes to Sam Sample/ }).click()]);
  const changesPath = path.join(OUT, dl2.suggestedFilename());
  await dl2.saveAs(changesPath);
  check("changes file downloaded", /^homeworkflow-changes-/.test(dl2.suggestedFilename()), `(${dl2.suggestedFilename()})`);
  await p.screenshot({ path: path.join(OUT, "06-parent-share.png"), fullPage: true });

  // ---------- Student imports the parent's changes
  await s.goto(BASE + "/share/");
  await s.getByRole("heading", { name: "Share", exact: true }).waitFor();
  await s.locator('input[aria-label="Open a changes file"]').setInputFiles(changesPath);
  await s.getByText(/Changes from Pat Sample: 1 applied/).waitFor();
  check("student applied the parent's signed changes", true);
  await s.locator('input[aria-label="Open a changes file"]').setInputFiles(changesPath);
  await s.getByText(/1 already imported/).waitFor();
  check("importing the same file again is harmless", true);

  // tampered file: raise the minutes after signing
  const tampered = JSON.parse(fs.readFileSync(changesPath, "utf8"));
  tampered.changes[0].newMinutes = 600;
  tampered.changes[0].id = "forged-id";
  const tamperedPath = path.join(OUT, "tampered.json");
  fs.writeFileSync(tamperedPath, JSON.stringify(tampered));
  await s.locator('input[aria-label="Open a changes file"]').setInputFiles(tamperedPath);
  await s.getByText(/wasn't made from this student's snapshot/).waitFor();
  check("a tampered changes file is rejected", true);
  const junkPath = path.join(OUT, "junk.json");
  fs.writeFileSync(junkPath, "not json at all");
  await s.locator('input[aria-label="Open a changes file"]').setInputFiles(junkPath);
  await s.getByText(/isn't a HomeworkFlow file/).waitFor();
  check("a non-HomeworkFlow file is rejected", true);

  await s.getByRole("link", { name: "Today", exact: true }).first().click();
  await s.getByRole("link", { name: /Fractions worksheet/ }).first().click();
  await s.getByRole("heading", { name: "Fractions worksheet" }).waitFor();
  const hist2 = await s.locator("ol").innerText();
  check("history shows the parent's file-based change", /Pat Sample \(parent\) changed the time from 45 min to 50 min/.test(hist2), `(${hist2.replace(/\n+/g, " | ").slice(0, 150)})`);
  check("allocation is now 50 min", await s.getByText("Planned 50 min").first().isVisible());
  await s.screenshot({ path: path.join(OUT, "07-student-detail-after-import.png"), fullPage: true });

  // ---------- Offline (service worker)
  await s.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await s.reload();
  await s.waitForTimeout(1500);
  offlineWindow = true;
  await S.ctx.setOffline(true);
  await s.goto(BASE + "/student/");
  await s.getByRole("heading", { name: "Today's plan" }).waitFor({ timeout: 10000 });
  check("app opens offline with the student's data", await s.getByText("Fractions worksheet").first().isVisible());
  await S.ctx.setOffline(false);
  offlineWindow = false;

  // ---------- Desktop layout and storage facts
  const desk = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await desk.goto(BASE + "/");
  await desk.getByRole("heading", { name: "Welcome" }).waitFor();
  check("fresh browser profile starts empty (data is per device)", true);
  const keys = await s.evaluate(() => Object.keys(localStorage));
  check("data lives in localStorage under one key", keys.filter((k) => k.startsWith("homeworkflow.")).length === 1, `(${keys.join(", ")})`);

  check("every request stayed on this origin (nothing sent to third parties)", problems.external.length === 0, problems.external.slice(0, 3).join(" "));
  check("no console errors or CSP violations", problems.console.length === 0, problems.console.slice(0, 3).join(" || "));
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots: ${OUT}`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error("SCRIPT ERROR", e.message.split("\n").slice(0, 8).join("\n"));
  process.exit(2);
});
