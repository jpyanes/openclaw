/**
 * RemoteManifestSource — phase-1 scaffold. Disabled by default.
 *
 * Phase 2 goal: fetch a JSON manifest from a hosted URL, cache it on disk with
 * ETag support (reusing `fetchWithSsrfGuard`), so users can see new
 * extensions without shipping a new CLI release.
 *
 * Phase 1: we only expose the factory and read the opt-in env var
 * `OPENCLAW_EXTENSION_MANIFEST_URL`; when unset the source is a no-op.
 * All actual fetching is deferred to phase 2.
 */

import type { ExtensionEntry, ExtensionManifestSource, ManifestLoadContext } from "./types.js";

const REMOTE_URL_ENV = "OPENCLAW_EXTENSION_MANIFEST_URL";

export function createRemoteManifestSource(): ExtensionManifestSource {
  return {
    id: "remote",
    load(ctx: ManifestLoadContext): ExtensionEntry[] {
      const env = ctx.env ?? process.env;
      const url = env[REMOTE_URL_ENV]?.trim();
      if (!url) {
        return [];
      }
      // Phase-1 placeholder: remote fetch is intentionally not implemented.
      // Returning an empty list keeps onboard correct (falls back to bundled)
      // and gives phase-2 a clean seam (HTTP + SSRF guard + ETag cache).
      return [];
    },
  };
}
