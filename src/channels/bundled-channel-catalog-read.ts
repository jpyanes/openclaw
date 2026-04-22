import fs from "node:fs";
import path from "node:path";
import { resolveOpenClawPackageRootSync } from "../infra/openclaw-root.js";
import { resolveBundledPluginsDir } from "../plugins/bundled-dir.js";
import { resolveExtensionManifestSync } from "../plugins/extension-registry/index.js";
import type { PluginPackageChannel } from "../plugins/manifest.js";
import { normalizeOptionalLowercaseString } from "../shared/string-coerce.js";

type ChannelCatalogEntryLike = {
  openclaw?: {
    channel?: PluginPackageChannel;
  };
};

export type BundledChannelCatalogEntry = {
  id: string;
  channel: PluginPackageChannel;
  aliases: readonly string[];
  order: number;
};

const OFFICIAL_CHANNEL_CATALOG_RELATIVE_PATH = path.join("dist", "channel-catalog.json");

function listPackageRoots(): string[] {
  return [
    resolveOpenClawPackageRootSync({ cwd: process.cwd() }),
    resolveOpenClawPackageRootSync({ moduleUrl: import.meta.url }),
  ].filter((entry, index, all): entry is string => Boolean(entry) && all.indexOf(entry) === index);
}

function listBundledExtensionPackageJsonPaths(env: NodeJS.ProcessEnv = process.env): string[] {
  // Delegate to the plugin loader's resolver so channel metadata stays in lock
  // step with whichever bundled plugin tree is actually loaded at runtime
  // (source extensions/ in dev/test, dist/extensions in published installs,
  // dist-runtime/extensions when paired with dist, etc.). See
  // src/plugins/bundled-dir.ts for the full candidate-order policy and
  // src/plugins/bundled-dir.test.ts for the precedence coverage. Reusing the
  // resolver also picks up OPENCLAW_BUNDLED_PLUGINS_DIR overrides and the
  // bun --compile sibling layout for free.
  const extensionsRoot = resolveBundledPluginsDir(env);
  if (!extensionsRoot) {
    return [];
  }
  try {
    return fs
      .readdirSync(extensionsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(extensionsRoot, entry.name, "package.json"))
      .filter((entry) => fs.existsSync(entry));
  } catch {
    return [];
  }
}

function readBundledExtensionCatalogEntriesSync(): ChannelCatalogEntryLike[] {
  const entries: ChannelCatalogEntryLike[] = [];
  for (const packageJsonPath of listBundledExtensionPackageJsonPaths()) {
    try {
      const payload = JSON.parse(
        fs.readFileSync(packageJsonPath, "utf8"),
      ) as ChannelCatalogEntryLike;
      entries.push(payload);
    } catch {
      continue;
    }
  }
  return entries;
}

function readOfficialCatalogFileSync(): ChannelCatalogEntryLike[] {
  for (const packageRoot of listPackageRoots()) {
    const candidate = path.join(packageRoot, OFFICIAL_CHANNEL_CATALOG_RELATIVE_PATH);
    if (!fs.existsSync(candidate)) {
      continue;
    }
    try {
      const payload = JSON.parse(fs.readFileSync(candidate, "utf8")) as {
        entries?: unknown;
      };
      return Array.isArray(payload.entries) ? (payload.entries as ChannelCatalogEntryLike[]) : [];
    } catch {
      continue;
    }
  }
  return [];
}

function toBundledChannelEntry(entry: ChannelCatalogEntryLike): BundledChannelCatalogEntry | null {
  const channel = entry.openclaw?.channel;
  const id = normalizeOptionalLowercaseString(channel?.id);
  if (!id || !channel) {
    return null;
  }
  const aliases = Array.isArray(channel.aliases)
    ? channel.aliases
        .map((alias) => normalizeOptionalLowercaseString(alias))
        .filter((alias): alias is string => Boolean(alias))
    : [];
  const order =
    typeof channel.order === "number" && Number.isFinite(channel.order)
      ? channel.order
      : Number.MAX_SAFE_INTEGER;
  return {
    id,
    channel,
    aliases,
    order,
  };
}

export function listBundledChannelCatalogEntries(): BundledChannelCatalogEntry[] {
  const seenIds = new Set<string>();
  const merged: BundledChannelCatalogEntry[] = [];

  const pushIfNew = (entry: BundledChannelCatalogEntry | null) => {
    if (!entry || seenIds.has(entry.id)) {
      return;
    }
    seenIds.add(entry.id);
    merged.push(entry);
  };

  // Layer 1 — concrete bundled extensions (their own package.json).
  for (const entry of readBundledExtensionCatalogEntriesSync()) {
    pushIfNew(toBundledChannelEntry(entry));
  }

  // Layer 1 fallback — `dist/channel-catalog.json` (published artifact).
  if (merged.length === 0) {
    for (const entry of readOfficialCatalogFileSync()) {
      pushIfNew(toBundledChannelEntry(entry));
    }
  }

  // Layer 2 — external packages declared in `extensions/manifest.json`.
  // These are NOT shipped in the repo; they install on demand via
  // `openclaw plugins install <npmSpec>`. They must still show up in onboard
  // pickers, so surface them here as virtual bundled entries (with their
  // catalog-style metadata preserved so downstream filtering can detect
  // "install-needed" state). Duplicate IDs from a locally-checked-out
  // extension take precedence, which lets devs override a published plugin
  // with a workspace copy.
  try {
    for (const entry of resolveExtensionManifestSync()) {
      if (entry.kind && entry.kind !== "channel") {
        continue;
      }
      const channel = entry.openclaw?.channel;
      if (!channel) {
        continue;
      }
      pushIfNew(toBundledChannelEntry({ openclaw: { channel } }));
    }
  } catch {
    // Extension manifest failures must never block onboard.
  }

  return merged;
}
