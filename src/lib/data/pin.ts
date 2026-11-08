import { requireSubtle } from "./secure";

/**
 * Parent PIN for the parent view on a SHARED student device.
 *
 * This is a soft guard against casual use (a child tapping "parent view"),
 * not a security boundary: the hash lives in the same browser storage as the
 * data, so someone with developer tools on that device can bypass it. The app
 * says so in Settings. PBKDF2 + salt + attempt limiting keep a 4-digit PIN from
 * being trivially read or brute-forced through the UI.
 */

export const PIN_ITERATIONS = 150_000;
export const MAX_FAILURES = 5;
export const LOCK_MS = 60_000;

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function derive(pin: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const subtle = requireSubtle();
  const key = await subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPin(pin: string, iterations = PIN_ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: toB64(salt), hash: toB64(await derive(pin, salt, iterations)), iterations };
}

export async function verifyPin(pin: string, stored: { salt: string; hash: string; iterations: number }): Promise<boolean> {
  const got = await derive(pin, fromB64(stored.salt), stored.iterations);
  const want = fromB64(stored.hash);
  if (got.length !== want.length) return false;
  let diff = 0; // constant-time comparison
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}
