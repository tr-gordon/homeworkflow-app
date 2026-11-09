# PRD: HomeworkFlow

Status: MVP, no-database version. Owner: the human (parent). Last reviewed: 2026-11-04.

## 1. Problem

A 13-year-old has several assignments with different due dates and difficulty.
They struggle to decide how long each will take, when to work on it, and
whether they are on track. A parent wants to help without nagging and without
approving every decision.

## 2. Product shape

HomeworkFlow is a **static, installable web app with no server, no database and
no accounts**, in the same style as the MEDS app: everything is stored in the
browser's `localStorage` on the user's own device, and the app is just files on a
static host. A student's device and a parent's device share homework by passing small
files (see section 5, "Sharing").

## 3. Goals

1. Let the student own their homework plan: capture assignments, allocate and
   change time per assignment, track real time, and see what to do today.
2. Let a parent see the student's assignments and adjust time allocations with
   no approval step, with every change attributed and dated.
3. Improve estimates over time from the student's own completed work.
4. Collect nothing: no accounts, no analytics, no third-party requests. Data stays on the device.

## 4. Non-goals

- Live sync between devices (needs a server). Sharing is by file, so it is not instant.
- Accounts, passwords, email, and push notifications from a server or third-party push service (see N5).
- School/LMS integration, native apps, rewards or social features.
- Strong access control on a shared device (the parent PIN is a soft lock).

## 5. Functional requirements

### Assignments
- **A1** The student creates, edits, completes and deletes assignments with title,
  subject, description (optional), due date, difficulty (1 to 5), status (stage),
  allocated minutes (optional) and planned work date (optional).
- **A2** "Status" is the five-stage scale in P1; there is no separate done flag.
  `completedAt` is set when the stage becomes `completed` and cleared if it moves back.
- **A3** A parent can see all of a student's assignments (from a snapshot file, or in the
  PIN-protected parent view on the student's device). A parent cannot create, edit
  (apart from allocation) or delete assignments, and cannot run timers.

### Allocation and estimates
- **T1** The student sets and changes allocated minutes at any time.
- **T2** A parent can change allocated minutes with no approval step. On a shared
  device it applies at once. From a parent's own device it travels as a changes file
  that is applied automatically when the student opens it (no accept/reject).
- **T3** Every allocation change (including the first) is recorded: old value, new
  value, who (name and role) and when. History is visible to the student and parents.
- **T4** Rule-based estimates: start from difficulty (1 to 5 maps to 15/25/40/60/90 min).
  With at least 3 finished assignments with timer data at the same difficulty, blend toward
  the student's median actual time (weight grows with sample size, up to 80%). Prefer
  same-subject samples when there are at least 3. Always show the basis. Never auto-applied.

### Timer
- **R1** Start, pause, resume, finish. One active timer at a time.
- **R2** Timer state is saved in storage, so a refresh or closing the app loses nothing.
  Elapsed time uses the device clock.
- **R3** A single running stretch counts at most 4 hours (forgotten timers).
- **R4** Finishing ends the session and offers a stage update; sessions add up.

### Organising: place and archive
- **W1** *Where.* An optional place per assignment ("Home", "Library", "School" as quick choices, or any
  text up to 40 characters). It shows on cards, the plan and the parent dashboard, and becomes the
  location of its calendar reminders. Older saved data and files without it still load.
- **C1** *Archive, don't delete.* The student can archive an assignment (one, all overdue from the
  heads-up banner, or all completed) and restore it. Archived work is hidden from the dashboard, plan,
  alerts, icon badge and calendar reminders, but its time and history are kept and finished work still feeds
  the time estimates. It stays listed under "Archived" (student) and as a read-only "Archived" list (parent).
  Delete remains, for mistakes. An assignment with a running or paused timer cannot be archived, and an
  archived one cannot be timed until restored.
- **C2** Archiving is the student's own action: the parent view and a parent's device cannot archive or
  restore.

### Progress, planned vs actual, plan
- **P1** Stages: not started, getting started, halfway, almost done, completed. Shown as
  words, never as percentages or a filling progress bar.
- **V1** Planned vs actual minutes shown per assignment and in totals, to student and parent.
- **D1** Daily plan: overdue, due today, planned for today (including carried over),
  and unplanned work due within 2 days as suggestions.
- **D2** Overdue = due before today (device-local date) and not completed. Shown with
  text and an icon, not colour alone.
- **S1** Student dashboard (mobile first). **S2** Parent dashboard (mobile and desktop):
  workload tiles, planned vs actual, filters, inline allocation change, history.

### Sharing (replaces accounts and linking)
- **F1** On first run a device is set up as a **student's device** or a **parent's device**.
- **F2** *Snapshot*: the student device exports a file with the student's assignments,
  time and history. A parent device imports it for a read-only copy, labelled with its
  date. Newer files refresh it; an older file is ignored. A timer that was running when the
  file was made is shown frozen at that moment.
- **F3** *Changes*: a parent device exports a file of its allocation changes, signed
  (HMAC-SHA256) with a secret that travels inside the snapshot. The student device accepts
  only validly signed files made for that student, applies them with the parent's own
  timestamp, and skips ones already applied (idempotent).
- **F4** *Conflicts*: newest change wins by timestamp. An older change that arrives late
  is kept in history as "not applied". Parent changes dated in the future are clamped to now.
- **F5** *Shared device*: a student device can open a **parent view** after a PIN (4 to 8
  digits, salted PBKDF2, 5 wrong tries lock it for a minute). It closes with the browser tab.
- **F6** *Backup/restore*: the snapshot file doubles as a backup; it can restore the same
  student onto a fresh device.

### Alerts (no server)
- **N1** *Timer alerts.* While a timer with a planned time is running, the student gets a heads-up
  5 minutes before the plan is used up (skipped for plans under 10 minutes) and an alert when it is
  used up. An alert shows on screen, with a beep and vibration (each can be turned off), and as a system
  notification if the app is in the background and notifications are on. Each alert fires once per timer
  and plan (a refresh does not repeat it; a longer plan can alert again). If the phone slept past the
  plan, the alert says how far past ("15 min over"), never a stale "5 minutes left".
  To make it more reliable: the screen is kept on while a timer with a plan runs (a setting, on by
  default; released on pause); the "time is up" alert repeats a beep and vibration every 30 seconds
  (at most 10 times) until dismissed; and it offers **+5 / +10 min**, which extends the plan, is recorded
  in the history as the student's change, and lets the alerts fire again at the new plan.
- **N2** *Due-soon and overdue.* A dashboard banner lists overdue and due-today work (dismissible for
  the day). On the student's own view the installed app's icon shows that count as a badge. A parent
  sees it per student, as of the last file.
- **N3** *System notifications* are opt-in (off by default, enabled in Settings only after the browser
  allows them). Besides timer alerts, at most one "work needs attention" notification per day when
  the app is opened with work due.
- **N4** *Calendar reminders.* The student, or a parent for an imported student, exports due dates and
  planned work as an `.ics` file with alarms (5 pm the day before and 7:30 am on the due day; 3:30 pm on a
  planned work day). The phone's calendar fires them, so they work with the app closed. Re-importing
  updates the same events; calendars do not remove events for finished or deleted work.
- **N5** *Honest limits.* With no server, nothing can wake a closed app, so N1 to N3 only work while the
  app is open or when it is next looked at; calendar reminders (N4) are the only closed-app alert. A
  push service (for example OneSignal, as MEDS uses) would need an external account, send device identifiers
  to a third party and break X1, so it is not used.
- **N6** Alert preferences are stored apart from the homework data and can never block or damage it.

## 6. Security and privacy requirements

- **X1** No data leaves the device. App code makes no network requests; a build-time
  check (`check:privacy`) and a Content-Security-Policy with `connect-src 'self'` enforce it.
- **X2** Everything stored is validated on every load (zod). Unreadable data is never
  overwritten: a copy is kept and the user chooses to erase.
- **X3** Files from outside are untrusted: parsed and validated, size-limited, all
  records checked to belong to the named student, signature verified before any change.
- **X4** Data minimisation: first name or nickname, assignments, time data. No email,
  date of birth, school, photo, location, analytics or ads.
- **X5** No public pages or profiles; no search indexing.
- **X6** Demo mode uses fictional data under a separate storage key and shows a banner.
- **X7** Honest limits, shown in the UI: the PIN is a soft lock; a snapshot file contains
  the signing secret and all the student's data, so share it only with the parent.

## 7. Success criteria

- A student can add an assignment, allocate time, run a timer across a page refresh,
  and finish it, using only a phone, with no setup beyond choosing a name.
- A parent on another phone can see the student's homework from a file, change a time,
  and the student's history shows who changed it and when after opening the parent's file.
- Tampered or foreign files are rejected (tested).
- Typecheck, lint, tests and the static build pass.

## 8. Decisions and open questions

Decided with the owner: no server or database; parent access by same-device PIN view plus
a file round trip; the Supabase prototype is kept only in git history.

Decided with the owner (enhancement round): archive rather than delete, student-only, for overdue and
finished work; place is per assignment; timer alerts get wake lock, repeat and +5/+10; start time and
"work together" come next, settable by the student or the parent.

Decided without the owner (revisit if wrong):
1. "No approval" means no accept/reject step. The student still has to open the parent's
   file; an old unopened file changes nothing.
2. Parent edits only allocation. Planned work date stays with the student.
3. Subject is free text. One `stage` column is the status. Hard delete.
4. Several parents can each hold the snapshot and send changes; names come from the signed file.
5. A student can erase their own device data (and so can anyone using that browser).

6. Alert times (heads-up at 5 minutes, 5 pm / 7:30 am / 3:30 pm calendar alarms) are fixed
   choices, since homework has no time of day. Make them settings if they don't suit.

Open:
- Should the parent be able to start or stop timers? (Currently no.)
- Is a third-party push service acceptable after all, for alerts when the app is closed?
- Is a 4 hour timer cap right?
- Hosting: GitHub Pages needs a public repo on a free plan. See README.

## 9. Future work

Optional encrypted cloud sync, a push service for alerts when the app is closed, manual time correction with an
audit trail, recurring assignments, school import, QR-code transfer of small files.
