// End-to-end test of location and archive/restore, on a student device and a parent device.
//
//   NEXT_PUBLIC_BASE_PATH=/homeworkflow-app npm run build
//   (serve ./out under /homeworkflow-app with any static server)
//   BASE=http://localhost:3500/homeworkflow-app node scripts/ui-organize.cjs
//
// Needs Playwright (globally installed or via NODE_PATH). Uses only fictional names.
const { chromium } = require("playwright");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BASE = process.env.BASE || "http://localhost:3500/homeworkflow-app";
const OUT = process.env.OUT || fs.mkdtempSync(path.join(os.tmpdir(), "hwf-organize-"));
const origin = new URL(BASE).origin;
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
};
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const day = (offset) => ymd(new Date(Date.now() + offset * 86400000));

(async () => {
  const browser = await chromium.launch();
  const external = [];
  const errors = [];
  const mk = async (name) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
    const page = await ctx.newPage();
    page.on("dialog", (d) => d.accept()); // confirm("Archive N ...?")
    page.on("request", (r) => {
      const u = r.url();
      if (!u.startsWith(origin) && !u.startsWith("data:") && !u.startsWith("blob:")) external.push(u);
    });
    page.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
    page.on("pageerror", (e) => errors.push(`${name}: pageerror ${e.message}`));
    return { ctx, page };
  };
  const S = await mk("student");
  const s = S.page;
  const banner = s.locator('div[role="status"]', { hasText: "Heads up" });

  await s.goto(BASE + "/");
  await s.getByRole("radio", { name: /A student's device/ }).click();
  await s.getByLabel("Student's first name or nickname").fill("Sam Sample");
  await s.getByRole("button", { name: "Get started" }).click();
  await s.getByRole("heading", { name: "Hi, Sam" }).waitFor();

  const add = async (title, due, place) => {
    await s.getByRole("link", { name: "Add", exact: true }).first().click();
    await s.getByLabel("What is it?").fill(title);
    await s.getByLabel("Subject").fill("Math");
    await s.getByLabel("Due date").fill(due);
    await s.getByRole("radio", { name: /3, Medium/ }).click();
    await s.getByLabel(/How long will you give it/).fill("30");
    if (place === "Library") await s.getByRole("button", { name: "Library", exact: true }).click();
    else if (place) await s.getByLabel(/Where will you work on it/).fill(place);
    await s.getByRole("button", { name: "Add assignment" }).click();
    await s.getByRole("heading", { name: title }).waitFor();
  };
  const home = async () => {
    await s.getByRole("link", { name: "Today", exact: true }).first().click();
    await s.getByRole("heading", { name: "Today's plan" }).waitFor();
  };

  // ---------- location
  await add("Library report", day(-1), "Library");
  check("a place chip fills the location", await s.getByText("At Library").first().isVisible());
  await add("Math sheet", day(0), "Grandma's house");
  await add("Old poster", day(-3), null);
  await add("Finished thing", day(4), "Home"); // not overdue: it gets completed later
  await home();
  check("location shows on the dashboard", (await s.getByText("At Library").first().isVisible()) && (await s.getByText("At Grandma's house").first().isVisible()));
  await s.screenshot({ path: path.join(OUT, "01-dashboard-locations.png"), fullPage: true });

  // a too-long place is refused
  await s.getByRole("link", { name: "Add", exact: true }).first().click();
  await s.getByLabel("What is it?").fill("Long place");
  await s.getByLabel("Subject").fill("Math");
  await s.getByLabel("Due date").fill(day(2));
  await s.getByRole("radio", { name: /3, Medium/ }).click();
  const place = s.getByLabel(/Where will you work on it/);
  check("the place field is limited to 40 characters", (await place.getAttribute("maxlength")) === "40");
  await home();

  // ---------- archive overdue from the banner
  await banner.waitFor();
  const t = await banner.innerText();
  check("banner counts overdue and due today", /2 overdue/.test(t) && /1 due today/.test(t), `(${t.replace(/\n+/g, " ").slice(0, 100)})`);
  const archiveBtn = banner.getByRole("button", { name: /Archive overdue/ });
  const overdueN = Number(/\((\d+)\)/.exec(await archiveBtn.innerText())[1]);
  await archiveBtn.click();
  await s.getByText(/Archived \(/).first().waitFor();
  check("'Archive overdue' moves overdue work to Archived", overdueN === 2 && (await s.getByText(/Archived \(2\)/).count()) >= 1, `(${overdueN} archived)`);
  const after = (await banner.count()) ? await banner.innerText() : "";
  check("archived work no longer nags (overdue count gone from the banner)", !/overdue/.test(after), `(${after.replace(/\n+/g, " ").slice(0, 80) || "no banner"})`);
  await s.screenshot({ path: path.join(OUT, "02-after-archive-overdue.png"), fullPage: true });

  // ---------- restore from the Archived list
  await s.getByText(/Archived \(/).first().click();
  await s.getByRole("button", { name: "Restore" }).first().click();
  await s.waitForTimeout(500);
  check("restoring brings it back to the dashboard (overdue again)", (await banner.count()) === 1 && /overdue/.test(await banner.innerText()));
  await banner.getByRole("button", { name: /Archive overdue/ }).click(); // archive it again
  await s.waitForTimeout(500);

  // ---------- complete one, then archive all completed
  await s.getByRole("link", { name: /Finished thing/ }).first().click();
  await s.getByRole("radio", { name: "Completed" }).click();
  await s.getByRole("radio", { name: "Completed", checked: true }).waitFor();
  await home();
  await s.getByText(/Completed \(1\)/).first().click();
  await s.getByRole("button", { name: "Archive all completed" }).click();
  await s.waitForTimeout(500);
  check("'Archive all completed' empties the Completed list", (await s.getByText(/Completed \(/).count()) === 0);

  // ---------- archive from the detail page; blocked while a timer runs
  await s.getByRole("link", { name: /Math sheet/ }).first().click();
  await s.getByRole("button", { name: "Start timer" }).click();
  await s.getByRole("button", { name: "Pause" }).waitFor();
  await s.getByRole("button", { name: "Archive", exact: true }).click();
  check("archiving is blocked while its timer is running, with a clear message", await s.getByText(/Finish or stop the timer/).isVisible());
  await s.getByRole("button", { name: "Finish" }).click();
  await s.getByText(/Session saved/).waitFor();
  await s.getByRole("button", { name: "Archive", exact: true }).click();
  await s.getByRole("heading", { name: "Today's plan" }).waitFor();
  check("archiving from the detail page returns to the dashboard", true);
  check("the archived assignment is gone from the plan", (await s.getByRole("link", { name: /Math sheet/ }).count()) === 0);

  // an archived assignment's page offers Restore and no timer
  await s.getByText(/Archived \(/).first().click();
  await s.getByRole("link", { name: /Math sheet/ }).first().click();
  await s.getByRole("heading", { name: "Archived" }).first().waitFor();
  check("an archived assignment shows Restore and no timer", (await s.getByRole("button", { name: "Restore" }).count()) >= 1 && (await s.getByRole("button", { name: "Start timer" }).count()) === 0);
  await s.screenshot({ path: path.join(OUT, "03-archived-detail.png"), fullPage: true });
  await home();

  // ---------- the calendar file leaves out archived work and carries the place
  await s.getByRole("link", { name: "Share", exact: true }).first().click();
  await s.getByRole("button", { name: /Add reminders to my calendar/ }).click();
  check("with everything archived or finished there is nothing to put in the calendar, and it says so", await s.getByText("No active assignments to add.").isVisible());

  // restore one with a place, so the calendar and the parent have something to show
  await home();
  await s.getByText(/Archived \(/).first().click();
  await s.locator("article", { hasText: "Library report" }).getByRole("button", { name: "Restore" }).click();
  await s.waitForTimeout(400);
  await s.getByRole("link", { name: "Share", exact: true }).first().click();
  const [ics2] = await Promise.all([s.waitForEvent("download"), s.getByRole("button", { name: /Add reminders to my calendar/ }).click()]);
  const icsPath2 = path.join(OUT, "second-" + ics2.suggestedFilename());
  await ics2.saveAs(icsPath2);
  const cal2 = fs.readFileSync(icsPath2, "utf8").replace(/\r\n[ \t]/g, "");
  check("calendar events carry the place", /LOCATION:Library/.test(cal2) && /SUMMARY:Due: Library report/.test(cal2));
  check("archived work is still left out of the calendar", !/Old poster|Math sheet/.test(cal2));

  // ---------- parent device sees location, and archived work read-only
  const [snap] = await Promise.all([s.waitForEvent("download"), s.getByRole("button", { name: "Share my homework file" }).click()]);
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
  await p.getByText(/Updated Sam Sample/).waitFor();
  await p.getByRole("link", { name: "Dashboard", exact: true }).first().click();
  await p.getByRole("heading", { name: /Sam Sample's homework/ }).waitFor();
  await p.getByRole("tab", { name: /All active/ }).click();
  check("the parent sees the place on assignments", await p.getByText("At Library").first().isVisible());
  const archivedTab = p.getByRole("tab", { name: /Archived \(/ });
  check("the parent has an Archived list", (await archivedTab.count()) === 1);
  await archivedTab.click();
  check("archived work is read-only for the parent (no Change time)", (await p.getByRole("button", { name: "Change time" }).count()) === 0 && (await p.locator("article").count()) >= 1);
  await p.screenshot({ path: path.join(OUT, "04-parent-archived.png"), fullPage: true });
  await p.getByRole("tab", { name: /Needs attention/ }).click();
  const pt = await p.locator("body").innerText();
  check("archived overdue work does not count in the parent's overdue tile", !(await p.getByText("Old poster").count()));
  void pt;

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
