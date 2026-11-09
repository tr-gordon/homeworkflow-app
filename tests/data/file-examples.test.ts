import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseChangesFile, snapshotSchema, verifyChanges } from "@/lib/data/sync";
import { device } from "./helpers";
import { clock } from "./helpers";

/** The sample files in docs/file-formats must stay valid, or the documentation lies. */
const read = (name: string): unknown => JSON.parse(readFileSync(`docs/file-formats/${name}`, "utf8"));
const SECRET = (read("snapshot.example.json") as { pairingSecret: string }).pairingSecret;

describe("sample files in docs/file-formats", () => {
  it("both snapshots pass the real schema", () => {
    expect(snapshotSchema.safeParse(read("snapshot.example.json")).success).toBe(true);
    expect(snapshotSchema.safeParse(read("snapshot.blank.json")).success).toBe(true);
  });

  it("both changes files parse and carry a valid signature", async () => {
    for (const [name, version] of [["changes-v1.example.json", 1], ["changes-v2.example.json", 2]] as const) {
      const parsed = parseChangesFile(read(name));
      expect(parsed?.version, name).toBe(version);
      expect(await verifyChanges(parsed!.raw, SECRET), name).toBe(true);
      expect(await verifyChanges(parsed!.raw, SECRET + "x"), name + " wrong secret").toBe(false);
    }
  });

  it("work end to end: a parent imports the snapshot, the student restores it and accepts the changes", async () => {
    clock.now = new Date("2026-11-09T19:00:00.000Z");
    const parent = device().open();
    await parent.setup({ role: "parent", displayName: "Pat Parent" });
    expect(await parent.importSnapshot(read("snapshot.example.json"))).toMatchObject({ kind: "imported", assignments: 3 });

    const student = device().open();
    await student.setup({ role: "student", displayName: "Alex Example", parentName: "Pat Parent" });
    expect(await student.importSnapshot(read("snapshot.example.json"))).toMatchObject({ kind: "restored", assignments: 3 });

    expect(await student.importChanges(read("changes-v1.example.json"))).toMatchObject({ applied: 1 });
    expect(await student.importChanges(read("changes-v2.example.json"))).toMatchObject({ applied: 3 });
    const math = (await student.listAssignments("student-example-0001")).find((a) => a.id === "assignment-example-math")!;
    expect(math).toMatchObject({ allocatedMinutes: 50, plannedStart: "16:30", withParent: true, location: "Home" });
  });
});
