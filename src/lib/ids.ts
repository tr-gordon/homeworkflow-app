/**
 * A random id (UUID v4). Uses crypto.randomUUID() when the browser has it, and falls back to
 * getRandomValues() otherwise: randomUUID() is missing on iOS before 15.4 and on pages served
 * over plain http, and an app that cannot create an id cannot start.
 */
type CryptoLike = { getRandomValues(array: Uint8Array): Uint8Array; randomUUID?: () => string };

export function newId(c: CryptoLike = globalThis.crypto): string {
  if (typeof c.randomUUID === "function") return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0"));
  return `${h.slice(0, 4).join("")}-${h.slice(4, 6).join("")}-${h.slice(6, 8).join("")}-${h.slice(8, 10).join("")}-${h.slice(10).join("")}`;
}
