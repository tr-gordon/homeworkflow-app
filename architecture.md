# Architecture

Companion to [`PRD.md`](./PRD.md). Requirement IDs (A1, T3, F3 ...) refer to it.

## 1. Overview

```
Browser (static PWA: Next.js client components, Tailwind)
   │  reads/writes
   ▼
localStorage["homeworkflow.v2"]   (ONE validated JSON blob per device)

student device ──snapshot.json──▶ parent device
student device ◀──changes.json─── parent device (HMAC-signed)
```

There is no server, API or database. `next build` (static export) writes plain files to
`out/`; any static host serves them. After the first visit a service worker lets the app open
offline. Like MEDS, state is a single JSON document in `localStorage`.

| Layer | Where | Notes |
|---|---|---|
| Pure domain logic | `src/lib/domain/*` | Stages, dates, estimates, timer maths, daily plan. No I/O. |
| Validation | `src/lib/validation.ts`, `src/lib/data/state.ts` | zod schemas for input and for stored state. |
| Data layer | `src/lib/data/*` | `HomeworkRepo` interface; `LocalRepo` is the only implementation. |
| Sync | `src/lib/data/sync.ts` | File formats, HMAC signing, conflict rule. |
| UI | `src/app`, `src/components` | Client components. Routes are static (`/assignment?id=`). |

## 2. State (`src/lib/data/state.ts`)

```
version, deviceId, role: "student"|"parent"|null, displayName
parentName, pin{salt,hash,iterations}, pinFailures, pinLockedUntil   (student device)
students[], assignments[], sessions[], history[]
outbox[]                                  (parent device: changes not yet confirmed)
pairingSecret                             (student device: signs/authenticates parent files)
snapshots{ studentId: {exportedAt, importedAt, pairingSecret} }      (parent device)
demo
```

- Every load is parsed with zod. If parsing fails the raw text is copied to
  `homeworkflow.v2.corrupt` and the app stops (`corrupt_data`); real data is never
  overwritten. (Demo data is simply re-seeded.)
- State is re-read on every call, so two tabs and page refreshes stay consistent.
- `sessionStorage` holds only "parent view is open", so closing the tab returns a shared
  device to the student.
- Status is one `stage` column; `completedAt` is derived in `updateAssignment`.

## 3. Roles and permissions (A3, T2, F5)

Enforced in `LocalRepo` (there is no server to enforce them):

| Viewer | Can |
|---|---|
| Student view (student device) | CRUD own assignments, timers, own allocation |
| Parent view (student device, after PIN) | Read; change allocation and schedule (applied directly) |
| Parent device | Read imported students; change allocation and schedule (queued in the outbox) |

Everything else raises `forbidden`. Rows you may not read behave as if they don't exist.
These checks guard against mistakes and casual use, not against a determined person with
developer tools on the same browser; the UI says so.

## 4. Sharing by file (F2 to F4)

**Snapshot** (student → parent): `{app, kind:"snapshot", version, exportedAt, student, pairingSecret,
assignments, sessions, history}`. Parent import replaces that student's data, freezes
running timers at `exportedAt`, ignores files older than the current one, then re-applies the
parent's own unsent changes on top (newest wins) so nothing the parent did is lost. Outbox
entries that appear in the new snapshot's history are dropped.

**Changes** (parent → student): `{..., kind:"changes", studentId, parentName, changes[], mac}`.
`mac` = HMAC-SHA256 over a fixed-order canonical array of every field, keyed by the pairing
secret that came inside the snapshot. The student device verifies it (constant time) before
touching any data, then:

- rejects wrong `studentId`, bad or missing signatures, malformed files;
- applies changes oldest first via `applyAllocationChange`:
  - duplicate id → skipped (idempotent re-import);
  - missing assignment → counted, skipped;
  - `changedAt` more than 5 minutes ahead → clamped to now;
  - newest-wins: if a newer applied change already exists the change is stored as
    `superseded` (visible in history) and the allocation is untouched.

Security properties: integrity and "made by someone holding this student's snapshot". Not
provided: confidentiality in transit (the files are plain JSON; use a channel you trust), or
protection against a parent who leaks the snapshot (the secret rides in it by design).

## 4b. Parent PIN (`pin.ts`)

PBKDF2-SHA256, 150,000 iterations, random 16 byte salt, constant-time compare; 5 failures lock
for 60 s. Changing an existing PIN needs the current one. It is a soft guard: the hash lives
in the same storage as the data.

## 5. Timer (R1 to R4)

`src/lib/domain/timer.ts` holds the pure transitions and the 4 h cap. State persists in
`sessions[]` on every transition; the live stretch is derived from `lastResumedAt` and the
device clock, so refreshes lose nothing. One active session per student is enforced in
`timerStart`.

## 6. Frontend

- Mobile first, Tailwind; touch targets at least 44px; no horizontal scroll at 390px; respects
  `prefers-color-scheme` and `prefers-reduced-motion`.
- Routes: `/` (redirect), `/setup`, `/student`, `/new`, `/assignment?id=`, `/parent`, `/share`,
  `/settings`. Static export has no dynamic segments, hence the query string.
- "Today" is the device-local date; due dates are plain `YYYY-MM-DD` strings.
- A `Providers` gate runs first: storage blocked → explanation; unreadable data → recovery card.
- Progress is words only (P1).

## 7. PWA and hosting

- Manifest with relative paths and a service worker that derives its URLs from its scope, so
  the app works at a root domain or under a sub-path (`NEXT_PUBLIC_BASE_PATH=/Homeworkflow`).
- Service worker (`public/sw.js`, same-origin only). A slow or stalled connection must never freeze an
  app whose data is all local, so:
  - **page loads** are answered from the cache at once and refreshed in the background (a new
    version arrives on the next open); only a first-ever visit waits for the network;
  - **hashed build files** are cache-first, and at install every page and its scripts are cached, so
    a page that was never opened still opens on a bad connection;
  - **Next.js prefetch/navigation requests** (and HEAD checks) get a 2 second limit, then fail
    fast, which makes Next fall back to a normal page load that the cache answers instantly.
  Homework data is not in any cache; it is in localStorage.
- `app/error.tsx` and `app/global-error.tsx` show a recovery screen instead of a blank page if a
  screen fails to render; the data is stored apart from the screen code and is untouched.
- Older phones: `lib/ids.ts` falls back when `crypto.randomUUID` is missing (iOS before 15.4, plain
  http); the PIN dialog works without `<dialog>.showModal()`; the PIN and signed files need Web Crypto,
  which only exists on https/localhost, and say so plainly (`data/secure.ts`) instead of crashing.
- CSP meta tag (production builds): `connect-src 'self'` so the page cannot send data to other
  hosts. Inline scripts are allowed because the Next.js static runtime needs them.
- `agentRules: false` in `next.config.ts` stops `next dev` generating agent instruction files.

## 4c. Field-level changes and the two file versions (H1 to H7)

- A change is `{id, assignmentId, field, from, to, changedAt}` with `field` one of `allocatedMinutes`, `plannedDate`,
  `plannedStart`, `withParent`, `location` (`domain/changes.ts`). `normalizeFieldValue` validates each field
  (whole minutes 1 to 600, a real date, 24-hour HH:MM, a boolean, a place of at most 40 characters).
- `sync.applyFieldChange` is the single place a change is applied, for the parent's local edit, the student's
  import and the re-apply after a newer snapshot. It is idempotent by id, validates again (a signed file can carry
  nonsense: `invalid`, counted, never half-applied), clamps future dates, resolves **newest-wins per field**
  (`superseded` entries stay in the history), and refuses a start time with no work day. Writing a field keeps the rule
  between fields (no work day clears the start time).
- `LocalRepo.setSchedule` is the one entry point for the student and the parent. The student's own edits (form or
  `setSchedule`) are logged field by field so the history and the conflict rule see them. A parent's change on their
  own device also goes to the outbox; the parent view applies directly. `updateAssignment` stays student-only.
- **Files.** Version 1 (the first release): `changes[{id, assignmentId, oldMinutes, newMinutes, changedAt}]`. Version 2:
  `changes[{id, assignmentId, field, from, to, changedAt}]`. The signed bytes are a fixed-order array that includes
  the version and differs in shape per version, so a signature cannot be moved between versions. The exporter writes
  version 1 when every change is an allocation change, so a student app that has not updated yet (updates take two
  opens) still reads it. The importer accepts both and answers `newer_version` for anything above 2. Snapshots stay at
  version 1: the new assignment fields default safely, in both directions.
- **Stored data.** `history` gained `field/oldValue/newValue` (defaults make old records allocation changes);
  `outbox` entries are converted from the old shape when read, so a parent's unsent changes survive the upgrade.
- **Alerts.** `domain/alerts.ts` holds `dueStartAlerts` (today's unfinished, unarchived, timed work; parents only for
  together work; 10 minute lead; 10 minute grace; never stale), `combineStartAlerts` (one alert for everything due now)
  and `startAlertKey` (moving the start time allows a re-alert). `TimerAlertsHost` runs it every 15 seconds and on
  becoming visible, for students and parents alike. `domain/ics.ts` writes timed floating events with `-PT15M` and
  `PT0S` alarms; midnight rollover is handled by `addMinutesLocal`.

## 7a. Place and archive (W1, C1, C2)

- Two additive assignment fields, `location` (max 40) and `archivedAt`, both defaulting to null in the stored
  state and in snapshot files, so older data and files load unchanged (the state version stays 2).
- `LocalRepo.archiveAssignments(ids)` is student-view only and all-or-nothing: an unknown id archives none, and a
  running or paused timer on any of them blocks the batch (`assignment_busy`). `restoreAssignment` is idempotent.
  `timerStart` refuses an archived assignment (`assignment_archived`). Neither touches the allocation history.
- `domain/archive.ts` holds the rules (`visibleOnly`, `archivedOnly`, "overdue to archive", "completed to
  archive"). Every screen that builds a plan, a count, an alert, a badge or a calendar passes through
  `visibleOnly`, so archived work cannot reappear in one place by accident. `buildIcs` also skips archived items and writes
  `LOCATION` on both events.
- Archived finished work stays in `samplesFromAssignments`, so estimates keep improving.
- A small `DATA_CHANGED_EVENT` lets code outside a screen (the alert's "+10 min", archive buttons) make every
  mounted screen reload.

## 7b. Alerts (N1 to N6)

All local; nothing is sent anywhere.

- `domain/alerts.ts` (pure): `timerAlertState` (heads-up and "used up" from elapsed seconds against the
  plan), `alertsToFire` (each alert once; if already past the plan only "reached" fires), `alertKey`
  (session + plan + kind, so a longer plan can alert again), messages, and `buildAttention`
  (overdue and due-today counts and titles).
- Reliability extras: `lib/wake-lock.ts` (Screen Wake Lock while a timer with a plan is running; every failure
  is silent, it is re-requested after the browser drops it when the page is hidden), a repeat timer on the
  "time is up" alert (every 30 s, at most 10 times), and `extendedPlan` for "+5 / +10 min".
- `components/TimerAlertsHost.tsx` is mounted for the student's own view. Every second, and when the tab
  becomes visible again, it reads the saved running timer (`repo.getActiveTimer()`) and derives alerts
  from the device clock, so a sleeping phone still alerts when looked at. It marks an alert fired
  before delivering it, so a refresh or second tab does not repeat it.
- `lib/notify.ts`: Web Audio beep (unlocked by the first tap), `navigator.vibrate`, system notifications
  through the service worker (the only route that works on phones), and `setAppBadge`. Each
  checks the API exists and swallows failures.
- `lib/alerts-store.ts`: preferences and the "already alerted" keys in their own localStorage key
  (`homeworkflow.alerts.v1`), validated with defaults, and every method is total, so damaged
  alert data cannot affect homework data.
- `components/AttentionBanner.tsx`: banner, icon badge (student view only) and the once-a-day
  notification; the parent sees per-student lines.
- `domain/ics.ts` (pure): RFC 5545 builder with CRLF lines, 75-octet folding that never splits a
  character, escaping, stable `UID`s and a `SEQUENCE` from `updatedAt` so a re-import updates events. All-day
  events with `VALARM`s; completed work is left out.
- `public/sw.js` handles notification taps by focusing or opening the app.

Not possible without a server: waking a closed app (see N5). Headless Chromium cannot display
notifications at all, so tests assert that the app *asks* for the right notification (once a day), not
that a phone shows it.

## 8. Testing

| Layer | Tool | Proves |
|---|---|---|
| Domain | Vitest | Estimates, overdue, plan, timer maths. |
| Data layer | Vitest over an in-memory store | CRUD, role permissions, PIN lockout, timer persistence across refresh, allocation history, corrupt storage, demo mode. |
| Sync | Vitest, two simulated devices | Round trip, idempotency, conflicts, tampering, wrong student, outbox, backup/restore. |
| Alerts | Vitest (domain, store, repo) | Thresholds and boundaries, fire-once, late wake, attention counts, `.ics` structure/folding/escaping, damaged alert data. |
| Guard | `scripts/check-privacy.mjs` + test | No network APIs or external URLs in app code. |
| End to end (alerts) | Playwright with a fake clock (`scripts/ui-alerts.cjs`, manual) | Heads-up at 5 min, "time is up" at 10, no repeat after refresh, late wake, banner, badge, notification requests, settings, calendar file. |
| End to end (schedule) | Playwright with a fake clock (`scripts/ui-schedule.cjs`, manual) | Start time and together on the form; start alerts on the student's and the parent's phone (parent only for together work, combined when simultaneous); the parent's Schedule editor; the signed v2 file; the student's history; timed calendar files. |
| End to end (organise) | Playwright (`scripts/ui-organize.cjs`, manual) | Place chips and limit; archive overdue / completed / from the detail page; blocked by a running timer; restore; calendar without archived work and with the place; the parent's read-only Archived list. |
| End to end (network) | Playwright (`scripts/ui-network.cjs`, manual) | A 20 s network stall does not delay opening the app (65 ms) or tapping to a new page (2.4 s), it opens offline, and a new deploy arrives by the second open. |
| End to end (robustness) | Playwright (`scripts/ui-robust.cjs`, manual) | No `randomUUID`, no `showModal()`: still works; a screen that throws shows the recovery message and leaves the data untouched. |
| End to end | Playwright (`scripts/ui-smoke.cjs`, manual) | Real browsers as two devices: setup, timer refresh, PIN, file exchange, tamper rejection, offline, no off-origin requests. |

Not covered: installing to a phone's home screen, the native share sheet (the download path is
tested), other browsers/engines, very large data sets.

## 9. Known limitations

- Not real time. The parent sees data as of the last snapshot file.
- Alerts only work while the app is open (or on the next look); only calendar reminders fire when it is closed.
- Data exists only on the device: clearing site data loses it unless a backup file exists.
- Device clock drives the timer and conflict ordering.
- localStorage is about 5 MB; plenty for homework, but not unlimited.
- A first-ever visit needs the network (nothing is cached yet); after install the app opens instantly.
- A new version arrives on the second open after a deploy, because page loads come from the cache first.
- No strict CSP for scripts (`unsafe-inline`); the network lock is the main protection.
