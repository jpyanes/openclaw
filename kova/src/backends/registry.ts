import { qaBackend } from "./qa.js";
import type { KovaBackend, KovaBackendId, KovaRunTarget } from "./types.js";

const kovaBackends: KovaBackend[] = [qaBackend];

export function resolveKovaBackend(target: KovaRunTarget, backendId?: KovaBackendId) {
  const backend = kovaBackends.find((candidate) => {
    if (!candidate.supportsTarget(target)) {
      return false;
    }
    return backendId ? candidate.id === backendId : true;
  });
  if (!backend) {
    throw new Error(
      `no Kova backend registered for target: ${target}${backendId ? ` (${backendId})` : ""}`,
    );
  }
  return backend;
}
