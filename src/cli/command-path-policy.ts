import { isGatewayConfigBypassCommandPath } from "../gateway/explicit-connection-policy.js";
import { getCommandPathWithRootOptions } from "./argv.js";
import {
  cliCommandCatalog,
  type CliCommandCatalogEntry,
  type CliCommandPathPolicy,
  type CliNetworkProxyPolicy,
} from "./command-catalog.js";
import { matchesCommandPath } from "./command-path-matches.js";

const DEFAULT_CLI_COMMAND_PATH_POLICY: CliCommandPathPolicy = {
  bypassConfigGuard: false,
  routeConfigGuard: "never",
  loadPlugins: "never",
  hideBanner: false,
  ensureCliPath: true,
  networkProxy: "default",
};

export function resolveCliCommandPathPolicy(
  commandPath: string[],
  catalog: readonly CliCommandCatalogEntry[] = cliCommandCatalog,
): CliCommandPathPolicy {
  let resolvedPolicy: CliCommandPathPolicy = { ...DEFAULT_CLI_COMMAND_PATH_POLICY };
  for (const entry of catalog) {
    if (!entry.policy) {
      continue;
    }
    if (!matchesCommandPath(commandPath, entry.commandPath, { exact: entry.exact })) {
      continue;
    }
    Object.assign(resolvedPolicy, entry.policy);
  }
  if (isGatewayConfigBypassCommandPath(commandPath)) {
    resolvedPolicy.bypassConfigGuard = true;
  }
  return resolvedPolicy;
}

function isCommandPathPrefix(commandPath: string[], pattern: readonly string[]): boolean {
  return pattern.every((segment, index) => commandPath[index] === segment);
}

export function resolveCliCatalogCommandPath(
  argv: string[],
  catalog: readonly CliCommandCatalogEntry[] = cliCommandCatalog,
): string[] {
  const tokens = getCommandPathWithRootOptions(argv, argv.length);
  if (tokens.length === 0) {
    return [];
  }
  let bestMatch: readonly string[] | null = null;
  for (const entry of catalog) {
    if (!isCommandPathPrefix(tokens, entry.commandPath)) {
      continue;
    }
    if (!bestMatch || entry.commandPath.length > bestMatch.length) {
      bestMatch = entry.commandPath;
    }
  }
  return bestMatch ? [...bestMatch] : [tokens[0] as string];
}

export function resolveCliNetworkProxyPolicy(
  argv: string[],
  catalog: readonly CliCommandCatalogEntry[] = cliCommandCatalog,
): CliNetworkProxyPolicy {
  const commandPath = resolveCliCatalogCommandPath(argv, catalog);
  const networkProxy = resolveCliCommandPathPolicy(commandPath, catalog).networkProxy;
  return typeof networkProxy === "function" ? networkProxy({ argv, commandPath }) : networkProxy;
}
