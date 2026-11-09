"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { toLocalDateString } from "./domain/dates";
import type { Profile, Role } from "./domain/types";
import { getRepo } from "./data";
import { RepoError } from "./data/errors";
import type { DeviceInfo } from "./data/types";

/** Fired after something changes the saved data from outside a screen (for example "+10 min" on an alert). */
export const DATA_CHANGED_EVENT = "hwf-data-changed";

export type Async<T> =
  | { status: "loading"; data: undefined; error: undefined }
  | { status: "ready"; data: T; error: undefined }
  | { status: "error"; data: undefined; error: string };

/**
 * Loads data and re-loads on demand and whenever the tab becomes visible again,
 * so a timer started on another device (or tab) shows up without a manual refresh.
 * Previous data stays on screen while reloading.
 */
export function useLoad<T>(load: () => Promise<T>, deps: readonly unknown[]): Async<T> & { reload: () => void } {
  const [state, setState] = useState<Async<T>>({ status: "loading", data: undefined, error: undefined });
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    let cancelled = false;
    loadRef.current().then(
      (data) => {
        if (!cancelled) setState({ status: "ready", data, error: undefined });
      },
      (e: unknown) => {
        if (!cancelled) {
          const message = e instanceof RepoError ? e.message : "Something went wrong. Please try again.";
          setState({ status: "error", data: undefined, error: message });
        }
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps are supplied by the caller
  }, [tick, ...deps]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") setTick((t) => t + 1);
    };
    const onChanged = () => setTick((t) => t + 1);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(DATA_CHANGED_EVENT, onChanged);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(DATA_CHANGED_EVENT, onChanged);
    };
  }, []);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

/** A Date that updates every `ms` (for live timers). */
export function useNow(ms = 1000): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const first = setTimeout(() => setNow(new Date()), 0);
    const id = setInterval(() => setNow(new Date()), ms);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [ms]);
  return now;
}

function subscribeMinute(cb: () => void) {
  const id = setInterval(cb, 30_000);
  return () => clearInterval(id);
}

/** Today's local date (YYYY-MM-DD), or "" during server render. Rolls over at midnight. */
export function useToday(): string {
  return useSyncExternalStore(
    subscribeMinute,
    () => toLocalDateString(new Date()),
    () => "",
  );
}

/** Fired after the viewer changes (parent view opened/closed, demo switch) so screens re-resolve it. */
export const VIEWER_CHANGED_EVENT = "hwf-viewer-changed";

/**
 * Resolves who is using the app and sends them to the right place: first-run
 * setup if the device isn't set up, or the correct dashboard for their role.
 * Returns null while loading/redirecting.
 */
export function useRequireRole(role: Role | "any"): Profile | null {
  const router = useRouter();
  const [viewer, setViewer] = useState<Profile | null>(null);
  useEffect(() => {
    let cancelled = false;
    const check = () =>
      getRepo()
        .getViewer()
        .then((v) => {
          if (cancelled) return;
          if (!v) router.replace("/setup");
          else if (role !== "any" && v.role !== role) router.replace(v.role === "student" ? "/student" : "/parent");
          else setViewer(v);
        })
        .catch(() => {
          if (!cancelled) router.replace("/setup");
        });
    check();
    window.addEventListener(VIEWER_CHANGED_EVENT, check);
    return () => {
      cancelled = true;
      window.removeEventListener(VIEWER_CHANGED_EVENT, check);
    };
  }, [role, router]);
  return viewer;
}

export function errorMessage(e: unknown): string {
  return e instanceof RepoError ? e.message : "Something went wrong. Please try again.";
}

/** What kind of device this is (student's or parent's) and whether a parent PIN exists. */
export function useDevice(): DeviceInfo | null {
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      getRepo()
        .getDevice()
        .then((d) => !cancelled && setDevice(d))
        .catch(() => undefined);
    load();
    window.addEventListener(VIEWER_CHANGED_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(VIEWER_CHANGED_EVENT, load);
    };
  }, []);
  return device;
}
