import { RepoError } from "./errors";

/**
 * The PIN and the signed changes files use the browser's Web Crypto (crypto.subtle), which browsers
 * only provide on secure pages (https or localhost). Say so plainly instead of failing with a
 * confusing "cannot read properties of undefined".
 */
export function requireSubtle(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new RepoError("unsupported_here", "This needs a secure page (https). Open HomeworkFlow from its https address, or from localhost.");
  }
  return subtle;
}
