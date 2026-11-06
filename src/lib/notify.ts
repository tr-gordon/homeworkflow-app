"use client";

import { basePath } from "./config";
import type { TimerAlertKind } from "./domain/alerts";

/**
 * Browser alert helpers: sound, vibration, system notifications and the app-icon
 * badge. Every function checks the API exists and swallows failures: an alert that
 * cannot be delivered must never break the app. None of these send data anywhere.
 */

let audio: AudioContext | null = null;

/** Browsers only allow sound after a tap. Call this from a user gesture to unlock it. */
export function primeAudio(): void {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    audio ??= new Ctor();
    if (audio.state === "suspended") void audio.resume();
  } catch {
    // no sound available
  }
}

function tone(ctx: AudioContext, start: number, freq: number, length: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + length + 0.02);
}

/** One soft beep for the heads-up, three for "planned time is up". */
export function beep(kind: TimerAlertKind): void {
  try {
    if (!audio || audio.state !== "running") return;
    const t = audio.currentTime;
    const beeps = kind === "reached" ? 3 : 1;
    for (let i = 0; i < beeps; i++) tone(audio, t + i * 0.3, kind === "reached" ? 880 : 660, 0.2);
  } catch {
    // ignore
  }
}

export function vibrate(kind: TimerAlertKind): void {
  try {
    navigator.vibrate?.(kind === "reached" ? [200, 100, 200, 100, 400] : [150]);
  } catch {
    // ignore
  }
}

export type PermissionState = "unsupported" | "default" | "granted" | "denied";

export function notificationPermission(): PermissionState {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

/** Must be called from a tap. Resolves to the resulting permission. */
export async function requestNotificationPermission(): Promise<PermissionState> {
  if (typeof Notification === "undefined") return "unsupported";
  try {
    return await Notification.requestPermission();
  } catch {
    return notificationPermission();
  }
}

/**
 * Shows a system notification (through the service worker where possible, which is
 * the only way that works on phones). Only possible while the app or its worker is
 * alive: there is no server to wake it. Returns whether one was shown.
 */
export async function showSystemNotification(title: string, body: string, tag: string): Promise<boolean> {
  if (notificationPermission() !== "granted") return false;
  const options: NotificationOptions = { body, tag, icon: `${basePath}/icons/icon-192.png`, badge: `${basePath}/icons/icon-192.png` };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.showNotification(title, options);
      return true;
    }
    new Notification(title, options);
    return true;
  } catch {
    return false;
  }
}

/** Number on the installed app's icon (Chrome, Edge, installed iOS web apps). 0 clears it. */
export function setBadge(count: number): void {
  try {
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (count > 0) void nav.setAppBadge?.(count).catch(() => undefined);
    else void nav.clearAppBadge?.().catch(() => undefined);
  } catch {
    // ignore
  }
}
