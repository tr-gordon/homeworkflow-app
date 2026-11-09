// End-to-end test of the alerts, using Playwright's controllable clock so no real waiting is needed.
//
//   NEXT_PUBLIC_BASE_PATH=/Homeworkflow npm run build
//   mkdir -p /tmp/site && ln -sfn "$PWD/out" /tmp/site/Homeworkflow && (cd /tmp/site && python3 -m http.server 3300 &)
//   BASE=http://localhost:3300/Homeworkflow node scripts/ui-alerts.cjs
//
// Needs Playwright (globally installed or via NODE_PATH). Uses only fictional names.
const { chromium } = require("playwright");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BASE = process.env.BASE || "http://localhost:3300/Homeworkflow";
const OUT = process.env.OUT || fs.mkdtempSync(path.join(os.tmpdir(), "hwf-alerts-"));
const origin = new URL(BASE).origin;
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
};
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const now = new Date();
const today = ymd(now);
const yesterday = ymd(new Date(now.getTime() - 86400000));
const MIN = 60 * 1000;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, acceptDownloads: true });
  await ctx.grantPermissions(["notifications"], { origin });
  const external = [];
  const errors = [];
  const page = await ctx.newPage();
  page.on("request", (r) => {
    const u = r.url();
    if (!u.startsWith(origin) && !u.startsWith("data:") && !u.startsWith("blob:")) external.push(u);
  });
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push("pageerror " + e.message));

  // Record the app-icon badge and vibration calls (headless Chromium has no real badge or motor).
  await page.addInitScript(() => {
    window.__badge = [];
    window.__vibrate = [];
    Object.defineProperty(navigator, "setAppBadge", { value: (n) => (window.__badge.push(n), Promise.resolve()), configurable: true });
    Object.defineProperty(navigator, "clearAppBadge", { value: () => (window.__badge.push(0), Promise.resolve()), configurable: true });
    Object.defineProperty(navigator, "vibrate", { value: (p) => (window.__vibrate.push(p), true), configurable: true });
    // Record Screen Wake Lock use (headless Chromium may refuse the real thing).
    window.__wake = { requests: 0, releases: 0 };
    Object.defineProperty(navigator, "wakeLock", {
      value: { request: async () => (window.__wake.requests++, { addEventListener() {}, release: async () => { window.__wake.releases++; } }) },
      configurable: true,
    });
    // Headless Chromium reports Notification.permission as "denied" even when the context granted it
    // (requestPermission() says "granted"). Real browsers agree with each other, so mirror that here.
    Object.defineProperty(Notification, "permission", { get: () => "granted", configurable: true });
    // Headless Chromium cannot display notifications at all ("No notification permission..."), so record
    // what the app asks the browser to show. Whether a phone then shows it is a manual check.
    window.__notifications = [];
    ServiceWorkerRegistration.prototype.showNotification = function (title, options) {
      window.__notifications.push({ title, body: options && options.body, tag: options && options.tag });
      return Promise.resolve();
    };
  });
  await page.clock.install({ time: now });

  // ---------- Setup and data
  await page.goto(BASE + "/");
  await page.getByRole("radio", { name: /A student's device/ }).click();
  await page.getByLabel("Student's first name or nickname").fill("Sam Sample");
  await page.getByRole("button", { name: "Get started" }).click();
  await page.getByRole("heading", { name: "Hi, Sam" }).waitFor();

  const add = async (title, due, alloc) => {
    await page.getByRole("link", { name: "Add", exact: true }).first().click();
    await page.getByLabel("What is it?").fill(title);
    await page.getByLabel("Subject").fill("Math");
    await page.getByLabel("Due date").fill(due);
    await page.getByRole("radio", { name: /3, Medium/ }).click();
    if (alloc) await page.getByLabel(/How long will you give it/).fill(String(alloc));
    await page.getByRole("button", { name: "Add assignment" }).click();
    await page.getByRole("heading", { name: title }).waitFor();
  };
  await add("Essay draft", today, 10);
  await add("Old worksheet", yesterday, null);
  await add("Reading", ymd(new Date(now.getTime() + 3 * 86400000)), 20);

  // ---------- Due-soon / overdue banner and badge
  await page.getByRole("link", { name: "Today", exact: true }).first().click();
  await page.getByRole("heading", { name: "Today's plan" }).waitFor();
  const banner = page.getByRole("status").filter({ hasText: "Heads up" });
  await banner.waitFor();
  const bannerText = await banner.innerText();
  check("banner shows overdue and due today", /1 overdue, 1 due today/.test(bannerText), `(${bannerText.replace(/\n+/g, " ").slice(0, 90)})`);
  check("banner names the work", /Old worksheet/.test(bannerText) && /Essay draft/.test(bannerText));
  await page.waitForTimeout(100);
  const badge = await page.evaluate(() => window.__badge);
  check("app icon badge set to 2 (overdue + due today)", badge.at(-1) === 2, `(${JSON.stringify(badge)})`);
  await page.screenshot({ path: path.join(OUT, "01-banner.png"), fullPage: true });
  await banner.getByRole("button", { name: "Dismiss" }).click();
  check("banner can be dismissed", (await banner.count()) === 0);
  await page.reload();
  await page.getByRole("heading", { name: "Today's plan" }).waitFor();
  check("dismissal lasts for the session", (await page.getByRole("status").filter({ hasText: "Heads up" }).count()) === 0);

  // ---------- Timer alerts: 10 min plan -> heads-up at 5 min, "time is up" at 10 min
  await page.getByRole("link", { name: /Essay draft/ }).first().click();
  await page.getByRole("button", { name: "Start timer" }).click();
  await page.getByRole("button", { name: "Pause" }).waitFor();
  // The alert box only: Next.js also renders an invisible role=alert route announcer.
  const alert = page.locator('div[role="alert"].fixed');
  check("no alert at the start", (await alert.count()) === 0);
  await page.clock.runFor(1500);
  const wake1 = await page.evaluate(() => window.__wake.requests);
  check("the screen is held awake while a timer with a plan runs", wake1 === 1, `(${wake1} request)`);
  await page.clock.fastForward(5 * MIN + 2000);
  await alert.filter({ hasText: "5 minutes left" }).waitFor({ timeout: 5000 });
  check("heads-up fires at 5 minutes", true, `(${(await alert.innerText()).replace(/\n+/g, " ")})`);
  const vib = await page.evaluate(() => window.__vibrate);
  check("vibration requested with the alert", vib.length >= 1, `(${JSON.stringify(vib)})`);
  await page.screenshot({ path: path.join(OUT, "02-warning.png"), fullPage: true });
  await alert.getByRole("button", { name: "OK" }).click();
  await page.clock.fastForward(5 * MIN);
  await alert.filter({ hasText: "Planned time is up" }).waitFor({ timeout: 5000 }).catch(() => {});
  const upText = await alert.innerText().catch(() => "");
  check("'planned time is up' fires at 10 minutes", /(Planned time is up|Past your planned time)/.test(upText), `(${upText.replace(/\n+/g, " ")})`);
  await alert.getByRole("button", { name: "OK" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Pause" }).waitFor();
  await page.clock.runFor(3000);
  check("no repeat after a refresh", (await alert.count()) === 0);
  await page.getByRole("button", { name: "Finish" }).click();
  await page.getByText(/Session saved/).waitFor();

  // ---------- Late wake: 20 min plan, phone "asleep" for 35 min -> only the 'past' alert, no stale heads-up
  await page.getByRole("link", { name: "Today", exact: true }).first().click();
  await page.getByRole("link", { name: /Reading/ }).first().click();
  await page.getByRole("button", { name: "Start timer" }).click();
  await page.getByRole("button", { name: "Pause" }).waitFor();
  await page.clock.fastForward(35 * MIN);
  await alert.waitFor({ timeout: 5000 });
  const late = await alert.innerText();
  check("late alert says how far past the plan, with no stale '5 minutes left'", /Past your planned time/.test(late) && /15 min over/.test(late) && !/5 minutes left/.test(late), `(${late.replace(/\n+/g, " ")})`);
  check("the alert offers +5 and +10 minutes", (await alert.getByRole("button", { name: "+5 min" }).count()) === 1 && (await alert.getByRole("button", { name: "+10 min" }).count()) === 1);
  await page.screenshot({ path: path.join(OUT, "02b-time-is-up.png"), fullPage: true });

  // it keeps nudging until dismissed
  const vibBefore = await page.evaluate(() => window.__vibrate.length);
  await page.clock.runFor(61000);
  const vibAfter = await page.evaluate(() => window.__vibrate.length);
  check("the time-is-up alert repeats (vibration) while it stays on screen", vibAfter >= vibBefore + 2, `(${vibBefore} -> ${vibAfter})`);

  // +10 min extends the plan, is recorded, and the alert comes round again at the new plan
  await alert.getByRole("button", { name: "+10 min" }).click();
  await page.waitForTimeout(100);
  check("+10 min closes the alert", (await alert.count()) === 0);
  await page.clock.runFor(2500);
  await alert.waitFor({ timeout: 5000 });
  const extended = await alert.innerText();
  check("the plan grew by 10 minutes and the alert fires again at the new plan", /over your 30 min plan/.test(extended), `(${extended.replace(/\n+/g, " ")})`);
  check("the screen shows the new planned time at once", await page.getByText("Planned 30 min").first().isVisible());
  check("the extension is in the history, made by the student", await page.getByText(/You changed the time from 20 min to 30 min/).first().isVisible());
  const vibDismissed = await page.evaluate(() => window.__vibrate.length);
  await alert.getByRole("button", { name: "OK" }).click();
  await page.clock.runFor(61000);
  check("dismissing stops the repeating", (await page.evaluate(() => window.__vibrate.length)) === vibDismissed);
  const relBefore = await page.evaluate(() => window.__wake.releases);
  await page.getByRole("button", { name: "Pause" }).click();
  await page.clock.runFor(1500);
  check("the screen is released when the timer is paused", (await page.evaluate(() => window.__wake.releases)) > relBefore);

  // ---------- Settings
  await page.getByRole("link", { name: "Settings", exact: true }).first().click();
  await page.getByRole("heading", { name: "Alerts" }).waitFor();
  await page.getByRole("button", { name: "Test alert" }).click();
  await alert.filter({ hasText: "Test alert" }).waitFor({ timeout: 3000 });
  check("Test alert button shows a sample alert", true);
  await alert.getByRole("button", { name: "OK" }).click();
  check("keep-screen-on defaults to on", await page.getByRole("switch", { name: /^Keep the screen on/ }).isChecked());
  const sound = page.getByRole("switch", { name: /^Sound/ });
  check("sound defaults to on", await sound.isChecked());
  await sound.uncheck();
  await page.reload();
  await page.getByRole("heading", { name: "Alerts" }).waitFor();
  await page.waitForTimeout(200);
  check("a changed preference persists", !(await page.getByRole("switch", { name: /^Sound/ }).isChecked()));
  const notif = page.getByRole("switch", { name: /^System notifications/ });
  check("system notifications default to off", !(await notif.isChecked()));
  await notif.check();
  await page.waitForTimeout(300);
  check("system notifications can be turned on once the browser allows them", await notif.isChecked());
  await page.screenshot({ path: path.join(OUT, "03-settings.png"), fullPage: true });

  // notification when the app is opened with work due: asked for once per day
  await page.getByRole("link", { name: "Today", exact: true }).first().click();
  await page.getByRole("heading", { name: "Today's plan" }).waitFor();
  await page.waitForTimeout(500);
  const asked = await page.evaluate(() => window.__notifications.filter((n) => n.tag === "attention"));
  check("app asks for one 'work due' notification when opened with work due", asked.length === 1 && /Homework needs attention/.test(asked[0].title) && /overdue/.test(asked[0].body), `(${JSON.stringify(asked)})`);
  await page.getByRole("link", { name: "Settings", exact: true }).first().click();
  await page.getByRole("link", { name: "Today", exact: true }).first().click();
  await page.getByRole("heading", { name: "Today's plan" }).waitFor();
  await page.waitForTimeout(500);
  const again = await page.evaluate(() => window.__notifications.filter((n) => n.tag === "attention").length);
  check("it is not repeated the same day", again === 1, `(${again})`);

  // a timer alert while the app is in the background also asks for a system notification
  await page.getByRole("link", { name: "Settings", exact: true }).first().click();
  await page.getByRole("heading", { name: "Alerts" }).waitFor();
  await page.evaluate(() => Object.defineProperty(document, "visibilityState", { get: () => "hidden", configurable: true }));
  await page.getByRole("button", { name: "Test alert" }).click();
  await page.waitForTimeout(300);
  const bg = await page.evaluate(() => window.__notifications.map((n) => n.title));
  check("a background alert also asks for a system notification", bg.includes("Test alert"), `(${JSON.stringify(bg)})`);
  await page.evaluate(() => Object.defineProperty(document, "visibilityState", { get: () => "visible", configurable: true }));
  await alert.getByRole("button", { name: "OK" }).click();

  // A browser that has NOT allowed notifications: the toggle stays off and says why.
  {
    const bare = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const bp = await bare.newPage();
    await bp.goto(BASE + "/");
    await bp.getByRole("radio", { name: /A student's device/ }).click();
    await bp.getByLabel("Student's first name or nickname").fill("Riley Sample");
    await bp.getByRole("button", { name: "Get started" }).click();
    await bp.getByRole("heading", { name: "Hi, Riley" }).waitFor();
    await bp.getByRole("link", { name: "Settings", exact: true }).first().click();
    await bp.getByRole("heading", { name: "Alerts" }).waitFor();
    await bp.waitForTimeout(300);
    await bp.getByRole("switch", { name: /^System notifications/ }).click({ force: true });
    await bp.waitForTimeout(500);
    check("without browser permission the toggle stays off and explains why", !(await bp.getByRole("switch", { name: /^System notifications/ }).isChecked()) && (await bp.getByText(/Blocked in the browser settings/).isVisible()));
    await bare.close();
  }

  // ---------- Calendar reminders
  await page.getByRole("link", { name: "Share", exact: true }).first().click();
  await page.getByRole("heading", { name: "Calendar reminders" }).waitFor();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Add reminders to my calendar/ }).click()]);
  const icsPath = path.join(OUT, dl.suggestedFilename());
  await dl.saveAs(icsPath);
  const ics = fs.readFileSync(icsPath, "utf8");
  const unfolded = ics.replace(/\r\n[ \t]/g, "");
  check("calendar file has a readable name", /^homeworkflow-reminders-sam-sample-\d{4}-\d{2}-\d{2}\.ics$/.test(dl.suggestedFilename()), `(${dl.suggestedFilename()})`);
  check("calendar file is a valid iCalendar with CRLF lines", unfolded.startsWith("BEGIN:VCALENDAR\r\n") && unfolded.trimEnd().endsWith("END:VCALENDAR") && !/[^\r]\n/.test(ics));
  check("calendar has the due dates and two alarms each", /SUMMARY:Due: Essay draft/.test(unfolded) && /SUMMARY:Due: Old worksheet/.test(unfolded) && (unfolded.match(/BEGIN:VALARM/g) || []).length >= 6);
  check("calendar has the planned time in the description", /planned 10 min/.test(unfolded));
  await page.screenshot({ path: path.join(OUT, "04-share-calendar.png"), fullPage: true });

  check("every request stayed on this origin", external.length === 0, external.slice(0, 3).join(" "));
  check("no console errors or CSP violations", errors.length === 0, errors.slice(0, 3).join(" || "));
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots: ${OUT}`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error("SCRIPT ERROR", e.message.split("\n").slice(0, 8).join("\n"));
  process.exit(2);
});
