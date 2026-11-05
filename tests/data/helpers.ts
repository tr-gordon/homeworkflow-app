import { expect } from "vitest";
import { LocalRepo, MemoryStore } from "@/lib/data/local-repo";
import { RepoError, type RepoErrorCode } from "@/lib/data/errors";

export const clock = { now: new Date(2026, 10, 4, 16, 0, 0) };
export const advance = (seconds: number) => {
  clock.now = new Date(clock.now.getTime() + seconds * 1000);
};

let counter = 0;
/** One "device": its own localStorage and sessionStorage. Re-calling open() = a page refresh. */
export function device(demo = false) {
  const store = new MemoryStore();
  const session = new MemoryStore();
  const open = () =>
    new LocalRepo(store, session, {
      demo,
      clock: () => clock.now,
      newId: () => `id-${++counter}`,
      pinIterations: 1000, // fast for tests; production uses 150k
    });
  return { store, session, open };
}

export async function studentDevice() {
  const d = device();
  const repo = d.open();
  await repo.setup({ role: "student", displayName: "Sam Student", parentName: "Pat Parent" });
  await repo.setParentPin({ pin: "1234", parentName: "Pat Parent" });
  return { ...d, repo, studentId: (await repo.getViewer())!.id };
}

export async function parentDevice(name = "Pat Parent") {
  const d = device();
  const repo = d.open();
  await repo.setup({ role: "parent", displayName: name });
  return { ...d, repo };
}

export const newInput = {
  title: "Test essay",
  subject: "English",
  description: "",
  dueDate: "2026-11-20",
  difficulty: 3 as const,
  allocatedMinutes: 30,
  plannedDate: null,
};

export async function rejectsWith(p: Promise<unknown>, code: RepoErrorCode) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, `expected RepoError ${code}`).toBeInstanceOf(RepoError);
  expect((err as RepoError).code).toBe(code);
}
