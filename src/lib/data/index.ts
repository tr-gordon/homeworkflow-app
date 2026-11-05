import { appMode } from "../config";
import { DEMO_STORAGE_KEY, LocalRepo, STORAGE_KEY } from "./local-repo";
import type { HomeworkRepo } from "./types";

let repo: HomeworkRepo | null = null;

/** Browser-side repository singleton. Never call during server rendering. */
export function getRepo(): HomeworkRepo {
  if (repo) return repo;
  repo = new LocalRepo(window.localStorage, window.sessionStorage, { demo: appMode.kind === "demo" });
  return repo;
}

/** True if this browser lets us persist data (private modes and some settings block it). */
export function storageAvailable(): boolean {
  try {
    const k = "homeworkflow.probe";
    window.localStorage.setItem(k, "1");
    window.localStorage.removeItem(k);
    window.sessionStorage.setItem(k, "1");
    window.sessionStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

export { LocalRepo, STORAGE_KEY, DEMO_STORAGE_KEY };
export type { HomeworkRepo } from "./types";
