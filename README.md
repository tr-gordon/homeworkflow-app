# HomeworkFlow

A mobile-first homework time-management PWA for a student and a parent. The student plans,
times and tracks assignments; a parent can see them and adjust planned time, and every change
records who and when.

**There is no server, database or account.** Like the MEDS app, it is a static site: all data
lives in the browser's `localStorage` on each person's own device, and nothing is uploaded.
A student's device and a parent's device share homework by passing small files.

- Requirements: [`PRD.md`](./PRD.md) &nbsp;·&nbsp; Design: [`architecture.md`](./architecture.md)
- Stack: Next.js 16 (static export), TypeScript, Tailwind CSS 4, Vitest

## Try it

```bash
npm install
```

```bash
NEXT_PUBLIC_DEMO_MODE=true npm run dev
```

Open http://localhost:3000. Demo mode loads **fictional** sample data (Alex and Jordan Sample)
under its own storage key, with a banner and a "Parent view" button (no PIN needed in demo).

Without `NEXT_PUBLIC_DEMO_MODE`, the first screen asks whose device it is:

- **A student's device:** add homework, timer, daily plan. Optionally set a parent name and PIN
  so a parent can open a **parent view** on the same device.
- **A parent's device:** open the student's homework from a file, adjust time, send changes back.

## How a parent sees and adjusts homework

On a **shared device**, tap "Parent view", enter the PIN, adjust time. It applies immediately and
closes when the tab closes.

On **two devices**, by file (Share tab on both):

1. Student: *Share my homework file* → send the file to the parent (message, email, AirDrop).
2. Parent: *Open a homework file*. The dashboard shows the homework as of that file's date.
3. Parent changes planned times, then *Send my changes to &lt;student&gt;* → send the file back.
4. Student: *Open a changes file*. The new times apply automatically (no approve/reject), and the
   history shows who changed what and when.

Changes files are signed with a key that came inside the student's file, so only someone who
has that file can produce one the student's app accepts, and edited files are rejected. If both
sides changed the same time, the newest change wins and the older one is kept in history as
"not applied". Treat the student's file as private: it holds all their data and the key.

The same file is a **backup**: *Restore from a backup* puts it back on a fresh device. Clearing the
browser's site data deletes everything unless you have saved one.

## Alerts

- **Timer alerts:** with a planned time, a heads-up 5 minutes before it is used up (plans under 10
  minutes skip it) and an alert when it is, with a beep and vibration. If the phone slept past the plan,
  the alert says how far past.
- **Due soon and overdue:** a banner on the dashboard, and the number on the app icon for an installed
  app. A parent sees it per student, as of the last file.
- **System notifications** are opt-in (Settings): timer alerts while the app is in the background, and one
  note a day when you open the app with work due.
- **If the timer runs out:** the alert repeats until you dismiss it, and has **+5 / +10 min** buttons (the new
  time is recorded in the history). While a timer with a plan runs, the screen is kept on so the phone does not
  sleep through it (Settings can turn that off).
- **Calendar reminders:** Share, *Add reminders to my calendar* makes an `.ics` file with alarms (5 pm the
  day before and 7:30 am on the due day). Your calendar fires them even when HomeworkFlow is closed. A
  parent can export a student's due dates to their own calendar too.

There is no server, so nothing can wake a closed app: the in-app alerts and notifications work while
the app is open or when you next look at it, and calendar reminders are the way to be alerted when it is
closed. Settings has a *Test alert* button.

## Place and archive

- **Where:** each assignment can have a place (Home, Library, School or your own text). It shows on cards and the
  plan, and goes into the calendar reminders.
- **Archive instead of delete:** on an assignment, **Archive** hides it from the dashboard, alerts and calendar but
  keeps its time and history; finished work still improves your time estimates. **Archive overdue** (on the
  heads-up banner) and **Archive all completed** tidy up in one tap, and **Archived** lists everything with
  **Restore**. Delete is for mistakes: it cannot be undone. A parent sees archived work read-only.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run typecheck` / `npm run lint` | `tsc --noEmit` / ESLint |
| `npm test` | Domain, data layer, sync (two simulated devices) and guard tests |
| `npm run build` | Static export to `out/` |
| `npm run check:privacy` | Fails if app code uses network APIs or external URLs |
| `npm run check` | The whole gate in order |

End-to-end browser tests (manual, need Playwright): `scripts/ui-smoke.cjs` (two devices, files, offline),
`scripts/ui-alerts.cjs` (alerts with a fake clock), `scripts/ui-organize.cjs` (place and archive), `scripts/ui-network.cjs` (a stalled connection must not
freeze the app; updates still arrive) and `scripts/ui-robust.cjs` (older phones, and a screen that breaks).
Headers explain how to run them.
Not covered by any test: a phone actually showing a system notification, the app-icon badge, and calendar
apps importing the `.ics` file. Check those once on a real phone.
It drives two browser contexts as two devices and checks the file exchange, tamper rejection,
offline use and that nothing leaves the origin.

## Hosting (GitHub Pages)

`npm run build` creates plain files in `out/`; any static host works. This repository publishes to
GitHub Pages with `.github/workflows/pages.yml`, which is **manual only** (it never runs on push):

1. Repository Settings, Pages, **Source: GitHub Actions** (once).
2. Actions tab, "Deploy static app (manual)", **Run workflow**.
3. The site appears at `https://<owner>.github.io/<repo>/`. The workflow sets
   `NEXT_PUBLIC_BASE_PATH=/<repo>` for the build, so the app works under that sub-path.

The workflow runs the privacy check, typecheck, lint and tests before building. Publishing is safe
because the site contains no personal data: everything people enter stays in their own browser.

Other hosts: Cloudflare Pages or Netlify work the same way (build command `npm run build`,
output directory `out`). Serving locally needs `https` or `localhost`, because the PIN and file
signatures use the browser's Web Crypto, which needs a secure context.

To install: open the site on a phone and use "Add to Home Screen". After the first visit the whole app
opens instantly and works offline, even on a bad connection. A new version is picked up on the next
open after you publish it (the first open after a deploy still shows the old one).

## Privacy and security

- Stored on the device: first names, assignments, time data. No email, accounts, analytics or ads.
- App code makes no network requests (checked by `check:privacy`); a Content-Security-Policy with
  `connect-src 'self'` makes the browser enforce it in production builds.
- Honest limits: the parent PIN is a **soft lock** (the hash is in the same browser storage, so
  developer tools can bypass it); files are plain JSON, so send them over a channel you trust;
  the timer uses the device's clock.

## Layout

```
src/lib/domain/   pure logic: stages, dates, estimates, timer maths, daily plan
src/lib/data/     state schema, LocalRepo, sync (files + signing), PIN, demo seed
src/components, src/app   UI (static routes; assignment is /assignment?id=)
public/           manifest, icons, service worker
scripts/          check-privacy, icon generation, Playwright smoke test
tests/            domain, data, sync, guard
```

## Known limitations

Not real time (parent data is as of the last file). Alerts need the app open (calendar reminders excepted). Data lives only on the
device. See `architecture.md` section 9 and `PRD.md` section 8 for open questions.
