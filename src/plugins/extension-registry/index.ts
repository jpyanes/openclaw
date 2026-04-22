/**
 * Extension Registry — phase-1 composer.
 *
 * Merges three manifest sources into a single deduplicated list, keyed by
 * plugin package name (`entry.name`). Precedence:
 *
 *   local-override > remote > bundled
 *
 * Rationale: operators must be able to pin/override a package locally (for
 * offline installs, air-gapped setups, or internal forks); a hosted remote
 * manifest can add new packages without a CLI release; and the in-repo
 * bundled manifest is the offline fallback that every install ships with.
 *
 * This module is intentionally small — it owns ordering and dedupe. All IO
 * lives in the three source factories so tests can swap them freely.
 */

import { createBundledManifestSource } from "./bundled-source.js";
import { createLocalOverrideManifestSource } from "./local-override-source.js";
import { createRemoteManifestSource } from "./remote-source.js";
import type {
  ExtensionEntry,
  ExtensionEntrySource,
  ExtensionManifestSource,
  ManifestLoadContext,
  ResolvedExtensionEntry,
} from "./types.js";

export type {
  ExtensionEntry,
  ExtensionEntrySource,
  ExtensionManifestSource,
  ManifestLoadContext,
  ResolvedExtensionEntry,
} from "./types.js";

export { createBundledManifestSource } from "./bundled-source.js";
export { createLocalOverrideManifestSource } from "./local-override-source.js";
export { createRemoteManifestSource } from "./remote-source.js";

/** Lowest number wins (local-override beats remote beats bundled). */
const SOURCE_PRIORITY: Record<ExtensionEntrySource, number> = {
  "local-override": 0,
  remote: 1,
  bundled: 2,
};

function defaultSources(): ExtensionManifestSource[] {
  return [
    createBundledManifestSource(),
    createRemoteManifestSource(),
    createLocalOverrideManifestSource(),
  ];
}

export type ResolveExtensionManifestOptions = ManifestLoadContext & {
  /** Override the set of sources (primarily for tests). */
  sources?: ExtensionManifestSource[];
};

/**
 * Resolve the merged extension manifest. Every entry is tagged with its
 * origin source on `__source` so diagnostic commands (`plugins doctor`,
 * future `openclaw extensions list`) can explain where an entry came from.
 */
export async function resolveExtensionManifest(
  options: ResolveExtensionManifestOptions = {},
): Promise<ResolvedExtensionEntry[]> {
  const sources = options.sources ?? defaultSources();
  const ctx: ManifestLoadContext = {
    packageRoot: options.packageRoot,
    env: options.env,
    signal: options.signal,
  };

  // Load all sources in parallel; each source is responsible for its own
  // error handling and MUST return [] on failure (see types.ts contract).
  const loaded = await Promise.all(
    sources.map(async (source) => {
      const entries = await source.load(ctx);
      return entries.map((entry) => ({ entry, source: source.id }));
    }),
  );

  const merged = new Map<string, { entry: ResolvedExtensionEntry; priority: number }>();
  for (const { entry, source } of loaded.flat()) {
    const key = entry.name;
    if (!key) {
      continue;
    }
    const priority = SOURCE_PRIORITY[source] ?? Number.MAX_SAFE_INTEGER;
    const tagged: ResolvedExtensionEntry = {
      ...(entry as Record<string, unknown>),
      __source: source,
    } as ResolvedExtensionEntry;
    const existing = merged.get(key);
    if (!existing || priority < existing.priority) {
      merged.set(key, { entry: tagged, priority });
    }
  }

  return Array.from(merged.values()).map(({ entry }) => entry);
}

/**
 * Synchronous variant used by callers that must stay sync (e.g. catalog.ts
 * runs inside sync discovery paths). Only consults the bundled source — the
 * remote/local-override sources may do IO and are opted out of the sync path
 * deliberately.
 *
 * Phase 2 note: if remote caching moves to a fully-materialised on-disk
 * cache, it can also expose a sync read and be added here.
 */
export function resolveExtensionManifestSync(
  options: ResolveExtensionManifestOptions = {},
): ResolvedExtensionEntry[] {
  const sources = options.sources ?? [createBundledManifestSource()];
  const ctx: ManifestLoadContext = {
    packageRoot: options.packageRoot,
    env: options.env,
  };
  const merged = new Map<string, { entry: ResolvedExtensionEntry; priority: number }>();
  for (const source of sources) {
    const entries = source.load(ctx);
    if (!Array.isArray(entries)) {
      // Skip async sources when invoked sync-only.
      continue;
    }
    const priority = SOURCE_PRIORITY[source.id] ?? Number.MAX_SAFE_INTEGER;
    for (const entry of entries) {
      const key = entry.name;
      if (!key) {
        continue;
      }
      const tagged: ResolvedExtensionEntry = {
        ...(entry as Record<string, unknown>),
        __source: source.id,
      } as ResolvedExtensionEntry;
      const existing = merged.get(key);
      if (!existing || priority < existing.priority) {
        merged.set(key, { entry: tagged, priority });
      }
    }
  }
  return Array.from(merged.values()).map(({ entry }) => entry);
}
