/**
 * Extension Registry — phase-1 scaffold.
 *
 * Goal: introduce a single, forward-compatible seam for "what extensions exist
 * and where do they come from?" so that onboard UX stays stable while the
 * underlying data source evolves (bundled → remote manifest → local overrides
 * → future marketplace search).
 *
 * Phase 1 ships only the bundled source (reading `extensions/manifest.json`
 * from the OpenClaw package root). Remote and local-override sources have
 * stable interfaces and placeholder stubs so phase 2 can wire them up without
 * rewriting callers.
 *
 * Merge precedence (lowest-number wins): `local > remote > bundled`.
 */

import type { OpenClawPackageManifest } from "../manifest.js";

/** Source tag — exposed on every resolved entry for diagnostics. */
export type ExtensionEntrySource = "bundled" | "remote" | "local-override";

/** Opaque-ish entry shape kept close to the on-disk JSON so future fields
 * (signature, capabilities, publisher, …) survive round-trips without
 * requiring host updates. */
export type ExtensionEntry = {
  /** npm package name (primary identity). */
  name: string;
  /** Optional display description. */
  description?: string;
  /** `external` means not shipped in this repo; `bundled` means currently in
   * `extensions/<name>/` and listed here for forward-compat. */
  source?: "external" | "bundled";
  /** Primary capability. */
  kind?: "channel" | "provider" | "tool" | "hook" | "skill";
  /** Cheap metadata mirrored from plugin package.json `openclaw.*`. */
  openclaw?: OpenClawPackageManifest;
  /** Reserved extension fields — preserved verbatim. */
  [key: string]: unknown;
};

/** Entry plus its provenance. Returned by {@link resolveExtensionManifest}. */
export type ResolvedExtensionEntry = ExtensionEntry & {
  __source: ExtensionEntrySource;
};

/** Contract every manifest source must satisfy. */
export type ExtensionManifestSource = {
  /** Stable tag used for provenance + merge precedence. */
  readonly id: ExtensionEntrySource;
  /**
   * Load the manifest. MUST be side-effect free beyond IO and MUST NOT throw
   * on missing sources — return an empty array instead, so onboard degrades
   * gracefully when remote is unreachable.
   */
  load: (ctx: ManifestLoadContext) => Promise<ExtensionEntry[]> | ExtensionEntry[];
};

export type ManifestLoadContext = {
  /** Absolute path to the OpenClaw package root (where `extensions/` lives). */
  packageRoot?: string;
  /** Process env — provided explicitly for testability. */
  env?: NodeJS.ProcessEnv;
  /** Abort signal for network-backed sources. */
  signal?: AbortSignal;
};
