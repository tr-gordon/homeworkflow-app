// The app must keep working (or fail visibly and safely) on older phones and when a screen breaks.
//
//   NEXT_PUBLIC_BASE_PATH=/homeworkflow-app npm run build
//   (serve ./out under /homeworkflow-app, e.g. via scripts/ui-network.cjs's server or any static server)
//   BASE=http://localhost:3500/homeworkflow-app node scripts/ui-robust.cjs
//
// Needs Playwright (globally installed or via NODE_PATH). Uses only fictional names.
const { chromium } = require("playwright");
const BASE = process.env.BASE || "http://localhost:3500/homeworkflow-app";
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
};

(async () => {
  const browser = await chromium.launch();

  // ---- an older phone: no crypto.randomUUID (iOS before 15.4), no <dialog>.showModal()
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      Object.defineProperty(Crypto.prototype, "randomUUID", { value: undefined, configurable: true });
      HTMLDialogElement.prototype.showModal = undefined;
    });
    await page.goto(BASE + "/");
    await page.getByRole("radio", { name: /A student's device/ }).click();
    await page.getByLabel("Student's first name or nickname").fill("Sam Sample");
    await page.getByLabel("Parent's name").fill("Pat Sample");
    await page.getByLabel("Parent PIN (4 to 8 digits)").fill("2468");
    await page.getByRole("button", { name: "Get started" }).click();
    await page.getByRole("heading", { name: "Hi, Sam" }).waitFor();
    check("starts and sets up without crypto.randomUUID", true);
    const id = await page.evaluate(() => JSON.parse(localStorage.getItem("homeworkflow.v2")).students[0].id);
    check("ids are still valid UUIDs", /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id), `(${id})`);
    await page.getByRole("button", { name: "Parent view" }).click();
    await page.getByLabel("Parent PIN").fill("2468");
    await page.getByRole("button", { name: "Open" }).click();
    await page.getByRole("heading", { name: /Sam Sample's homework/ }).waitFor();
    check("the PIN dialog works without showModal()", true);
    check("no script errors on the older phone", errors.length === 0, errors.slice(0, 2).join(" | "));
    await ctx.close();
  }

  // ---- a screen that fails to render: a recovery screen, not a blank page, and the data is untouched
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(BASE + "/");
    await page.getByRole("radio", { name: /A student's device/ }).click();
    await page.getByLabel("Student's first name or nickname").fill("Sam Sample");
    await page.getByRole("button", { name: "Get started" }).click();
    await page.getByRole("heading", { name: "Hi, Sam" }).waitFor();
    const before = await page.evaluate(() => localStorage.getItem("homeworkflow.v2"));
    // The dashboard writes today's date with toLocaleDateString: make that blow up.
    await page.addInitScript(() => {
      Date.prototype.toLocaleDateString = () => {
        throw new Error("simulated rendering failure");
      };
    });
    await page.reload();
    await page.getByRole("heading", { name: "Something went wrong" }).waitFor({ timeout: 10000 });
    check("a broken screen shows a recovery message, not a blank page", true);
    check("the message says the homework is safe", await page.getByText(/Your homework is safe/).isVisible());
    check("it offers Try again and Reload", (await page.getByRole("button", { name: "Try again" }).count()) === 1 && (await page.getByRole("button", { name: "Reload the app" }).count()) === 1);
    const after = await page.evaluate(() => localStorage.getItem("homeworkflow.v2"));
    check("the saved data is exactly as it was", before === after);
    await ctx.close();
  }

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error("SCRIPT ERROR", e.message.split("\n").slice(0, 6).join("\n"));
  process.exit(2);
});
