import { describe, expect, it } from "vitest";
import { normalizeBasePath, resolveMode } from "@/lib/config";

describe("resolveMode (X6)", () => {
  it("is local by default and demo only when explicitly switched on", () => {
    expect(resolveMode({})).toEqual({ kind: "local" });
    expect(resolveMode({ NEXT_PUBLIC_DEMO_MODE: "false" })).toEqual({ kind: "local" });
    expect(resolveMode({ NEXT_PUBLIC_DEMO_MODE: "true" })).toEqual({ kind: "demo" });
    expect(resolveMode({ NEXT_PUBLIC_DEMO_MODE: " TRUE " })).toEqual({ kind: "demo" });
  });
});

describe("normalizeBasePath", () => {
  it.each([
    [undefined, ""],
    ["", ""],
    ["/", ""],
    ["Homeworkflow", "/Homeworkflow"],
    ["/Homeworkflow", "/Homeworkflow"],
    ["/Homeworkflow/", "/Homeworkflow"],
    ["//a/b//", "/a/b"],
  ])("%j -> %j", (input, out) => {
    expect(normalizeBasePath(input)).toBe(out);
  });
});
