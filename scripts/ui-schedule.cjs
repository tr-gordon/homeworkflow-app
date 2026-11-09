// End-to-end test of start time and "work together": a student device and a parent device, with a fake clock.
//
//   NEXT_PUBLIC_BASE_PATH=/homeworkflow-app npm run build
//   (serve ./out under /homeworkflow-app with any static server)
//   BASE=http://localhost:3500/homeworkflow-app node scripts/ui-schedule.cjs
//
// Needs Playwright (globally installed or via NODE_PATH). Uses only fictional names.
const { chromium } = require("playwright");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BASE = process.env.BASE || "http://localhost:3500/homeworkflow-app";
const OUT = process.env.OUT || fs.mkdtempSync(path.join(os.tmpdir(), "hwf-schedule-"));
const origin = new URL(BASE).origin;
const MIN = 60 * 1000;
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
};
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const at4pm = new Date();
at4pm.setHours(16, 0, 0, 0);
const today = ymd(at4pm);
const due = ymd(new Date(at4pm.getTime() + 3 * 86400000));

(async () => {
  const browser = await chromium.launch();
  const external = [];
  const errors = [];
  const mk = async (name) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
    const page = await ctx.newPage();
    page.on("request", (r) => {
      const u = r.url();
      if (!u.startsWith(origin) && !u.startsWith("data:") && !u.startsWith("blob:")) external.push(u);
    });
    page.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
    page.on("pageerror", (e) => errors.push(`${name}: pageerror ${e.message}`));
    await page.clock.install({ time: at4pm }); // 4:00 pm today on both phones
    return { ctx, page };
  };
  const alertBox = (page) => page.locator('div[role="alert"].fixed');

  const S = await mk("student");
  const s = S.page;
  await s.goto(BASE + "/");
  await s.getByRole("radio", { name: /A student's device/ }).click();
  await s.getByLabel("Student's first name or nickname").fill("Sam Sample");
  await s.getByRole("button", { name: "Get started" }).click();
  await s.getByRole("heading", { name: "Hi, Sam" }).waitFor();

  // ---------- student plans two things for 4:30 pm today, one together with a parent
  const add = async (title, together) => {
    await s.getByRole("link", { name: "Add", exact: true }).first().click();
    await s.getByLabel("What is it?").fill(title);
    await s.getByLabel("Subject").fill("Science");
    await s.getByLabel("Due date").fill(due);
    await s.getByRole("radio", { name: /3, Medium/ }).click();
    await s.getByLabel(/How long will you give it/).fill("45");
    await s.getByLabel(/Work on it on/).fill(today);
    await s.getByLabel(/Start time/).fill("16:30");
    if (together) {
      await s.getByRole("switch", { name: "Work together with a parent" }).check();
      await s.getByRole("button", { name: "Library", exact: true }).click();
    }
    await s.getByRole("button", { name: "Add assignment" }).click();
    await s.getByRole("heading", { name: title }).waitFor();
  };
  await add("Science lab", true);
  check("detail shows start, together and place", (await s.getByText("With a parent").first().isVisible()) && (await s.getByText("At Library").first().isVisible()) && (await s.getByText(/Work: .*4:30 pm/).first().isVisible()));
  await add("Solo reading", false);

  // a start time needs a work day: the field is off until a day is picked
  await s.getByRole("link", { name: "Add", exact: true }).first().click();
  await s.getByRole("heading", { name: "Add an assignment" }).waitFor(); // not the previous page's hidden edit form
  check("the start time field is disabled until a work day is chosen", await s.getByLabel(/Start time/).isDisabled());
  await s.getByLabel(/Work on it on/).fill(today);
  check("and enabled once one is", !(await s.getByLabel(/Start time/).isDisabled()));
  await s.getByRole("link", { name: "Today", exact: true }).first().click();
  await s.getByRole("heading", { name: "Today's plan" }).waitFor();
  check("today's plan shows the start time and 'with a parent'", (await s.getByText("4:30 pm").first().isVisible()) && (await s.getByText("With a parent").first().isVisible()));
  await s.screenshot({ path: path.join(OUT, "01-student-plan.png"), fullPage: true });

  // ---------- start-time alerts on the student's phone
  await s.clock.runFor(20 * MIN + 2000); // 4:20 pm
  await alertBox(s).waitFor({ timeout: 5000 });
  const soon = await alertBox(s).innerText();
  check("heads-up 10 minutes before the start", /Starting in 10 minutes/.test(soon), `(${soon.replace(/\n+/g, " ")})`);
  check("two things at the same time are in ONE alert, and the together one says so", /Science lab together with a parent at Library/.test(soon) && /Solo reading/.test(soon));
  check("the alert has an Open link to the assignment", (await alertBox(s).getByRole("link", { name: "Open" }).count()) === 1);
  await s.screenshot({ path: path.join(OUT, "02-start-heads-up.png"), fullPage: true });
  await alertBox(s).getByRole("button", { name: "OK" }).click();
  await s.clock.runFor(10 * MIN);
  await alertBox(s).waitFor({ timeout: 5000 });
  check("'time to start' fires at the start time", /Time to start/.test(await alertBox(s).innerText()));
  await alertBox(s).getByRole("button", { name: "OK" }).click();
  await s.clock.runFor(3 * MIN);
  check("no repeats after dismissing", (await alertBox(s).count()) === 0);

  // ---------- parent device
  const [snap] = await Promise.all([
    (async () => {
      await s.getByRole("link", { name: "Share", exact: true }).first().click();
      return s.waitForEvent("download");
    })(),
    (async () => {
      await s.getByRole("heading", { name: "Share", exact: true }).waitFor();
      await s.getByRole("button", { name: "Share my homework file" }).click();
    })(),
  ]);
  const snapPath = path.join(OUT, snap.suggestedFilename());
  await snap.saveAs(snapPath);

  const P = await mk("parent");
  const p = P.page;
  await p.goto(BASE + "/");
  await p.getByRole("radio", { name: /A parent's device/ }).click();
  await p.getByLabel("Your first name").fill("Pat Sample");
  await p.getByRole("button", { name: "Get started" }).click();
  await p.getByRole("link", { name: "Open a homework file" }).click();
  await p.locator('input[aria-label="Open a homework file"]').setInputFiles(snapPath);
  await p.getByText(/Updated Sam Sample: 2 assignment/).waitFor();
  await p.getByRole("link", { name: "Dashboard", exact: true }).first().click();
  await p.getByRole("heading", { name: /Sam Sample's homework/ }).waitFor();
  const together = p.getByRole("tab", { name: /Together \(1\)/ });
  check("the parent has a Together list with just the together work", (await together.count()) === 1);
  await together.click();
  const card = p.locator("article", { hasText: "Science lab" });
  check("the parent's card says 'With you' and shows the start time and place", (await card.getByText("With you").count()) === 1 && (await card.getByText(/4:30 pm/).count()) === 1 && (await card.getByText("At Library").count()) === 1);
  check("the solo work is not in the Together list", (await p.getByText("Solo reading").count()) === 0);
  await p.screenshot({ path: path.join(OUT, "03-parent-together.png"), fullPage: true });

  // the parent's phone is alerted for the together work only
  await p.clock.runFor(20 * MIN + 2000);
  await alertBox(p).waitFor({ timeout: 5000 });
  const pAlert = await alertBox(p).innerText();
  check("the parent is alerted before the together work", /Starting in 10 minutes/.test(pAlert) && /Science lab together with Sam Sample at Library/.test(pAlert), `(${pAlert.replace(/\n+/g, " ")})`);
  check("the parent is not alerted for solo work", !/Solo reading/.test(pAlert));
  await alertBox(p).getByRole("button", { name: "OK" }).click();
  await p.clock.runFor(10 * MIN);
  await alertBox(p).waitFor({ timeout: 5000 });
  const pNow = await alertBox(p).innerText();
  check("and at the start: 'Time to work together'", /Time to work together/.test(pNow) && !/Solo reading/.test(pNow), `(${pNow.replace(/\n+/g, " ")})`);
  await alertBox(p).getByRole("button", { name: "OK" }).click();

  // ---------- the parent changes the schedule (no approval), from their own device
  await p.getByRole("tab", { name: /Together/ }).click();
  await card.getByRole("button", { name: "Schedule" }).click();
  check("the editor needs a work day before a start time", !(await card.getByLabel("Start time").isDisabled()) && (await card.getByLabel("Work day").inputValue()) === today);
  await card.getByLabel("Start time").fill("17:00");
  await card.getByLabel("Where").fill("Home");
  await card.getByRole("button", { name: "Save schedule" }).click();
  await card.getByText(/5:00 pm/).first().waitFor();
  check("the parent's change shows at once", (await card.getByText("At Home").count()) === 1);
  check("the unsent changes are counted", await p.getByText(/2 changes not sent to Sam Sample yet/).isVisible());
  await p.getByRole("link", { name: "Share", exact: true }).first().click();
  const [chg] = await Promise.all([p.waitForEvent("download"), p.getByRole("button", { name: /Send my changes to Sam Sample/ }).click()]);
  const chgPath = path.join(OUT, chg.suggestedFilename());
  await chg.saveAs(chgPath);
  const file = JSON.parse(fs.readFileSync(chgPath, "utf8"));
  check("the changes file is version 2 and signed", file.version === 2 && typeof file.mac === "string" && file.changes.length === 2, `(v${file.version}, ${file.changes.length} changes: ${file.changes.map((c) => c.field).join(", ")})`);
  await p.screenshot({ path: path.join(OUT, "04-parent-share.png"), fullPage: true });

  // parent's calendar: only the together work, as a timed block with alarms
  const [pics] = await Promise.all([p.waitForEvent("download"), p.getByRole("button", { name: /Add reminders to my calendar for Sam Sample/ }).click()]);
  const pcal = (() => {
    const f = path.join(OUT, "parent-" + pics.suggestedFilename());
    return { f, load: async () => (await pics.saveAs(f), fs.readFileSync(f, "utf8").replace(/\r\n[ \t]/g, "")) };
  })();
  const pcalText = await pcal.load();
  check("the parent's calendar has only the together work", /Together: Science lab/.test(pcalText) && !/Solo reading/.test(pcalText));
  check("as a timed block at the new start time with alarms", /DTSTART:\d{8}T170000/.test(pcalText) && /TRIGGER:-PT15M/.test(pcalText) && /TRIGGER:PT0S/.test(pcalText) && /LOCATION:Home/.test(pcalText));

  // ---------- the student gets the changes
  await s.goto(BASE + "/share/");
  await s.getByRole("heading", { name: "Share", exact: true }).waitFor();
  await s.locator('input[aria-label="Open a changes file"]').setInputFiles(chgPath);
  await s.getByText(/Changes from Pat Sample: 2 applied/).waitFor();
  check("the student applied both changes automatically", true);
  await s.getByRole("link", { name: "Today", exact: true }).first().click();
  await s.getByRole("heading", { name: "Today's plan" }).waitFor();
  check("the plan shows the new start time", (await s.getByText("5:00 pm").first().isVisible()) && (await s.getByText("At Home").first().isVisible()));
  await s.getByRole("link", { name: /Science lab/ }).first().click();
  await s.getByRole("heading", { name: "Science lab" }).waitFor();
  const hist = await s.locator("ol").innerText();
  check("history says who changed the start time and the place", /Pat Sample \(parent\) changed the start time from 4:30 pm to 5:00 pm/.test(hist) && /Pat Sample \(parent\) changed the place from Library to Home/.test(hist), `(${hist.replace(/\n+/g, " | ").slice(0, 170)})`);
  await s.screenshot({ path: path.join(OUT, "05-student-history.png"), fullPage: true });

  // the student's own calendar has everything, timed
  await s.getByRole("link", { name: "Share", exact: true }).first().click();
  const [sics] = await Promise.all([s.waitForEvent("download"), s.getByRole("button", { name: /Add reminders to my calendar/ }).click()]);
  const sPath = path.join(OUT, "student-" + sics.suggestedFilename());
  await sics.saveAs(sPath);
  const scal = fs.readFileSync(sPath, "utf8").replace(/\r\n[ \t]/g, "");
  check("the student's calendar has both timed work blocks", /Together: Science lab/.test(scal) && /Work on: Solo reading/.test(scal) && (scal.match(/DTSTART:\d{8}T\d{6}/g) || []).length === 2);

  check("every request stayed on this origin", external.length === 0, external.slice(0, 3).join(" "));
  check("no console errors", errors.length === 0, errors.slice(0, 3).join(" || "));
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots: ${OUT}`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error("SCRIPT ERROR", e.message.split("\n").slice(0, 8).join("\n"));
  process.exit(2);
});
