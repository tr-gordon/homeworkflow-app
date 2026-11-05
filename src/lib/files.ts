"use client";

/** Browser helpers for the file round-trip (see lib/data/sync.ts). */

export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Reads a user-picked .json file into a value. Throws a short message string on problems. */
export async function readJsonFile(file: File): Promise<unknown> {
  if (file.size > MAX_FILE_BYTES) throw new Error("That file is too big to be a HomeworkFlow file.");
  const text = await file.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("That file isn't a HomeworkFlow file, or it is damaged.");
  }
}

/** "homeworkflow-snapshot-sam-2026-11-04.json" (names reduced to safe characters). */
export function fileNameFor(kind: "snapshot" | "changes", who: string, now = new Date()): string {
  const safe = who.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "student";
  const d = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return `homeworkflow-${kind}-${safe}-${d}.json`;
}

/**
 * Hands the file to the person: the system share sheet when the device can share
 * files (phones), otherwise a normal download. Returns which one happened.
 */
export async function deliverJsonFile(name: string, data: unknown, title: string): Promise<"shared" | "downloaded"> {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const file = new File([blob], name, { type: "application/json" });
  if (typeof navigator !== "undefined" && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return "shared";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "shared"; // person closed the sheet
      // anything else: fall back to a download
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "downloaded";
}
