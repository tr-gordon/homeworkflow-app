# HomeworkFlow file formats (samples and field guide)

HomeworkFlow shares data between a student's phone and a parent's phone as two small JSON files. These
samples show exactly what the app reads and writes. JSON has no comments, so every field is explained below.

| File | Who makes it | Who opens it | What it is |
|---|---|---|---|
| [`snapshot.example.json`](./snapshot.example.json) | Student device (Share screen) | Parent device | A read-only copy of the student's homework, with three made-up assignments |
| [`snapshot.blank.json`](./snapshot.blank.json) | nobody (template) | | The same file with no assignments, to build by hand |
| [`changes-v1.example.json`](./changes-v1.example.json) | Parent device | Student device | Time changes only. Written whenever only the allocation changed |
| [`changes-v2.example.json`](./changes-v2.example.json) | Parent device | Student device | Any field: time, work day, start time, "together", place |

All sample data is fictional ("Alex Example", "Pat Parent"). The signing secret in the samples
(`EXAMPLE-ONLY-...`) is public: **never use it, or these files, for a real student.** The automated tests
(`tests/data/file-examples.test.ts`) check that every sample here is accepted by the real app, including the signatures, so the samples
cannot drift from the code.

## Snapshot (`kind: "snapshot"`, `version: 1`)

| Field | Meaning |
|---|---|
| `app` | Always `"homeworkflow"` |
| `kind` | Always `"snapshot"` |
| `version` | `1`. A newer number is refused with "update the app" |
| `exportedAt` | When the file was made (ISO time). A parent device ignores a file older than the one it already has |
| `student.id`, `student.displayName` | Which student. Name up to 40 characters. First name or nickname is enough |
| `pairingSecret` | Random secret (20 to 100 characters). The parent's changes files are signed with it. **Anyone holding it can send changes**, so share the file only with the parent |
| `assignments[]` | See below (up to 5000) |
| `sessions[]` | Timer records, one per start (up to 20000) |
| `history[]` | Who changed what and when (up to 20000) |

**Assignment:** `id`, `studentId` (must equal `student.id`), `title`, `subject`, `description`, `dueDate`
(`YYYY-MM-DD`), `difficulty` (1 to 5), `stage` (`not_started`, `getting_started`, `halfway`, `almost_done`, `completed`),
`allocatedMinutes` (1 to 600 or `null`), `plannedDate` (`YYYY-MM-DD` or `null`), `plannedStart` (`"HH:MM"` 24 hour or `null`; needs a
`plannedDate`), `withParent` (`true` = done together with a parent), `location` (up to 40 characters or `null`), `archivedAt` (time or
`null`), `completedAt`, `createdAt`, `updatedAt`. The four newest fields (`plannedStart`, `withParent`, `location`, `archivedAt`) may be left out;
the app fills in `null`/`false`.

**Timer session:** `id`, `assignmentId` (must be one of the assignments), `studentId`, `state` (`running`, `paused`, `finished`),
`startedAt`, `lastResumedAt` (only while running), `accumulatedSeconds` (time counted so far), `finishedAt`. A session that was running when the
file was made is shown paused at that moment on the parent's phone.

**History entry:** `id`, `assignmentId`, `field` (which value changed; default `allocatedMinutes`), then either `oldMinutes`/`newMinutes`
(for time) or `oldValue`/`newValue` (for the other fields), `changedBy`, `changedByName`, `changedByRole` (`student`, `parent`, `system`),
`changedAt`, `status` (`applied`, or `superseded` for a late change that lost to a newer one).

Rules the app enforces on import: every assignment, session and history entry must belong to the named student; the file must be under
5 MB; stages and ranges must be valid. Anything else is refused with a plain message and nothing is changed.

**Careful:** opening a snapshot on a *student* device with no homework yet **restores it** (it replaces that device's data). On a student device
that already has homework, it is only accepted if it is the same student. A parent device keeps one copy per student and replaces it.

## Changes (`kind: "changes"`)

| Field | Meaning |
|---|---|
| `app`, `kind`, `version` | `"homeworkflow"`, `"changes"`, `1` or `2` |
| `exportedAt` | When the file was made |
| `studentId` | Must equal the student's `student.id`. A file for someone else is refused |
| `parentName` | Shown in the history as who made the changes |
| `changes[]` | Version 1: `id`, `assignmentId`, `oldMinutes`, `newMinutes`, `changedAt`. Version 2: `id`, `assignmentId`, `field`, `from`, `to`, `changedAt` |
| `mac` | Signature (base64 HMAC-SHA256, see below) |

`field` is one of `allocatedMinutes`, `plannedDate`, `plannedStart`, `withParent`, `location`. Values: minutes 1 to 600; dates
`YYYY-MM-DD`; start `"HH:MM"` (needs a work day); `withParent` true/false; `location` up to 40 characters; `null` clears a value.

How the student's phone treats the file: it checks the signature **before** reading anything else, refuses a file for another student,
applies changes oldest first, skips ids it has already applied (opening twice is safe), pulls a `changedAt` that is more than 5 minutes
in the future back to now, and keeps the newest change per field (a late older one is kept in history as not applied). Values are
re-checked even in a correctly signed file.

### Signature

`mac` = base64 of HMAC-SHA256, keyed with the snapshot's `pairingSecret`, over this exact text (JSON, no spaces):

```
["homeworkflow","changes",<version>,<studentId>,<exportedAt>,<parentName>,<rows>]
```

where each row is `[id, assignmentId, oldMinutes, newMinutes, changedAt]` for version 1 and
`[id, assignmentId, field, from, to, changedAt]` for version 2. The version is part of the signed text, so a version 1 signature cannot be reused as
version 2. **If you edit a changes file by hand, the signature no longer matches and the student's phone rejects it**, which is the point.

## Hand-building a snapshot

Start from `snapshot.blank.json`: set a new `student.id` (any unique text), the name, a long random `pairingSecret`, and add assignments
using the field list above. Check it by importing it on a throwaway browser profile, not on a real device. A sample like this can also
stand in for a backup, since a snapshot is also how a student's data is backed up and restored.
