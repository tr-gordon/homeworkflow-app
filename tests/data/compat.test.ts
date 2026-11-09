import { describe, expect, it, vi } from "vitest";
import { newId } from "@/lib/ids";
import { requireSubtle } from "@/lib/data/secure";
import { hashPin, verifyPin } from "@/lib/data/pin";
import { signChanges, verifyChanges, type UnsignedChangesFile } from "@/lib/data/sync";
import { RepoError } from "@/lib/data/errors";
import { LocalRepo, MemoryStore } from "@/lib/data/local-repo";

/** A fake crypto whose getRandomValues fills the buffer with `fill(index)`. */
const fakeCrypto = (fill: (i: number) => number) => ({
  getRandomValues: (bytes: Uint8Array): Uint8Array => {
    for (let i = 0; i < bytes.length; i++) bytes[i] = fill(i);
    return bytes;
  },
});

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("newId (browsers without crypto.randomUUID)", () => {
  it("uses randomUUID when the browser has it", () => {
    expect(newId({ ...fakeCrypto(() => 0), randomUUID: () => "from-randomUUID" })).toBe("from-randomUUID");
  });

  it("falls back to a valid, random UUID v4 from getRandomValues", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 200; i++) {
      // Real random bytes, but no randomUUID: this is what an old browser offers.
      const id = newId({ getRandomValues: (bytes) => globalThis.crypto.getRandomValues(bytes) });
      expect(id).toMatch(V4);
      ids.add(id);
    }
    expect(ids.size).toBe(200);
  });

  it("sets the version and variant bits even for all-zero and all-one input", () => {
    expect(newId(fakeCrypto(() => 0))).toBe("00000000-0000-4000-8000-000000000000");
    expect(newId(fakeCrypto(() => 255))).toMatch(V4);
  });

  it("lets the whole app start without randomUUID", async () => {
    const original = globalThis.crypto.randomUUID;
    Object.defineProperty(globalThis.crypto, "randomUUID", { value: undefined, configurable: true });
    try {
      const repo = new LocalRepo(new MemoryStore(), new MemoryStore());
      await repo.setup({ role: "student", displayName: "Sam" });
      const a = await repo.createAssignment({ title: "T", subject: "S", description: "", dueDate: "2026-12-01", difficulty: 2, allocatedMinutes: null, plannedDate: null });
      expect(a.id).toMatch(V4);
    } finally {
      Object.defineProperty(globalThis.crypto, "randomUUID", { value: original, configurable: true });
    }
  });
});

describe("pages without Web Crypto (plain http)", () => {
  it("says so plainly instead of failing with a confusing error", async () => {
    vi.stubGlobal("crypto", { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) }); // no .subtle, as on http
    try {
      expect(() => requireSubtle()).toThrowError(/secure page/);
      await expect(hashPin("1234")).rejects.toMatchObject({ code: "unsupported_here" });
      await expect(verifyPin("1234", { salt: "AAAA", hash: "AAAA", iterations: 1 })).rejects.toBeInstanceOf(RepoError);
      await expect(signChanges({} as UnsignedChangesFile, "x")).rejects.toBeInstanceOf(RepoError);
      // Not mistaken for "the signature is wrong":
      await expect(verifyChanges({ app: "homeworkflow", kind: "changes", version: 1, exportedAt: "2026-01-01T00:00:00Z", studentId: "s", parentName: "P", changes: [], mac: "AAAAAAAAAAAAAAAAAAAAAAAA" }, "secret")).rejects.toMatchObject({ code: "unsupported_here" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("the rest of the app (homework, timer, demo) needs no Web Crypto", async () => {
    vi.stubGlobal("crypto", { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
    try {
      const repo = new LocalRepo(new MemoryStore(), new MemoryStore());
      await repo.setup({ role: "student", displayName: "Sam" });
      const a = await repo.createAssignment({ title: "T", subject: "S", description: "", dueDate: "2026-12-01", difficulty: 2, allocatedMinutes: 30, plannedDate: null });
      const t = await repo.timerStart(a.id);
      await repo.timerPause(t.id);
      expect((await repo.listAssignments((await repo.getViewer())!.id)).length).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
