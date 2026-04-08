import type { KovaRunTarget } from "../backends/types.js";
export type KovaRunSelectorFilters = {
  target?: KovaRunTarget;
  backend?: string;
  guest?: string;
  mode?: string;
  provider?: string;
};

type KovaSelectorComparableEntry = {
  selection: {
    target: string;
    axes?: Record<string, string | undefined>;
  };
  backend: {
    id?: string;
    kind?: string;
  };
};

function readFlagValue(args: string[], index: number, flag: string) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`missing value for ${flag}.`);
  }
  return value;
}

export function parseKovaSelectorFilters(args: string[]) {
  const filters: KovaRunSelectorFilters = {
    target: undefined,
    backend: undefined,
    guest: undefined,
    mode: undefined,
    provider: undefined,
  };
  const rest: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--target") {
      const value = readFlagValue(args, index, "--target");
      if (value !== "qa" && value !== "parallels") {
        throw new Error(
          `unsupported Kova target filter: ${value}. Use 'kova list targets' to inspect supported targets.`,
        );
      }
      filters.target = value;
      index += 1;
      continue;
    }
    if (arg === "--backend") {
      filters.backend = readFlagValue(args, index, "--backend");
      index += 1;
      continue;
    }
    if (arg === "--guest") {
      filters.guest = readFlagValue(args, index, "--guest");
      index += 1;
      continue;
    }
    if (arg === "--mode") {
      filters.mode = readFlagValue(args, index, "--mode");
      index += 1;
      continue;
    }
    if (arg === "--provider") {
      filters.provider = readFlagValue(args, index, "--provider");
      index += 1;
      continue;
    }
    rest.push(arg);
  }

  return {
    filters,
    rest,
  };
}

export function matchesKovaSelectorFilters(
  entry: KovaSelectorComparableEntry,
  filters?: KovaRunSelectorFilters,
) {
  if (!filters) {
    return true;
  }
  if (filters.target && entry.selection.target !== filters.target) {
    return false;
  }
  if (filters.backend && (entry.backend.id ?? entry.backend.kind) !== filters.backend) {
    return false;
  }
  if (filters.guest && entry.selection.axes?.guest !== filters.guest) {
    return false;
  }
  if (filters.mode && entry.selection.axes?.mode !== filters.mode) {
    return false;
  }
  if (filters.provider && entry.selection.axes?.provider !== filters.provider) {
    return false;
  }
  return true;
}

export function formatKovaSelectorFilters(filters: KovaRunSelectorFilters) {
  return Object.entries(filters)
    .filter(([, value]) => Boolean(value))
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
}

export function hasKovaSelectorFilters(filters: KovaRunSelectorFilters) {
  return Object.values(filters).some(Boolean);
}
