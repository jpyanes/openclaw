import {
  block,
  bulletList,
  joinBlocks,
  keyValueBlock,
  pageHeader,
  table,
} from "./console/format.js";

function usageBlock(lines: string[]) {
  return block("Usage", lines);
}

function examplesBlock(lines: string[]) {
  return block("Examples", bulletList(lines));
}

function notesBlock(lines: string[]) {
  return block("Notes", bulletList(lines));
}

function relatedBlock(lines: string[]) {
  return block("Related", bulletList(lines));
}

export function isHelpFlag(args: string[]) {
  return args.includes("--help") || args.includes("-h");
}

export function renderKovaHelp() {
  return joinBlocks([
    pageHeader(
      "Kova",
      "OpenClaw verification platform",
      "Run verification workflows, inspect artifacts, compare baselines, and track recorded history.",
    ),
    usageBlock(["kova <command> [options]"]),
    block(
      "Commands",
      table(
        ["command", "description"],
        [
          ["run", "execute a verification run"],
          ["report", "inspect a recorded run"],
          ["diff", "compare a candidate against a baseline"],
          ["list", "browse catalog and history data"],
        ],
      ),
    ),
    examplesBlock([
      "kova run qa --scenario channel-chat-baseline",
      "kova report latest",
      "kova diff",
      "kova list runs",
    ]),
    notesBlock(["Use 'kova <command> --help' for command details."]),
  ]);
}

export function renderRunHelp() {
  return joinBlocks([
    pageHeader("kova run", "Execute a verification run"),
    usageBlock(["kova run <target> [options]"]),
    block("Arguments", keyValueBlock([["target", "qa | parallels"]])),
    block(
      "Shared Options",
      keyValueBlock([
        ["--backend", "override the default backend for the selected target"],
        ["--json", "machine-readable output"],
      ]),
    ),
    block(
      "QA Target",
      keyValueBlock([
        ["default backend", "host"],
        ["backends", "host | multipass"],
        ["--provider-mode", "mock-openai | live-frontier"],
        ["--scenario", "QA scenario id, repeatable"],
      ]),
    ),
    block(
      "Parallels Target",
      keyValueBlock([
        ["backend", "parallels"],
        ["--guest", "macos | windows | linux"],
        ["--mode", "fresh | upgrade | both"],
        ["--provider", "openai | anthropic | minimax"],
      ]),
    ),
    examplesBlock([
      "kova run qa --scenario channel-chat-baseline",
      "kova run qa --backend multipass",
      "kova run parallels --guest macos --mode fresh",
    ]),
    notesBlock([
      "QA uses the host backend by default.",
      "Multipass without --scenario runs the curated QA core subset.",
      "Guest, mode, and provider axes apply only to the parallels target.",
    ]),
    relatedBlock(["kova list targets", "kova list scenarios qa", "kova report latest"]),
  ]);
}

export function renderReportHelp() {
  return joinBlocks([
    pageHeader("kova report", "Inspect one recorded run"),
    usageBlock(["kova report <selector> [filters] [options]", "kova report latest [filters]"]),
    block(
      "Selectors",
      keyValueBlock([
        ["latest", "latest recorded run after filters"],
        ["<run-id>", "explicit run selection"],
      ]),
    ),
    block(
      "Filters",
      keyValueBlock([
        ["--target", "qa | parallels"],
        ["--backend", "host | multipass | parallels"],
        ["--guest", "macos | windows | linux"],
        ["--mode", "fresh | upgrade | both"],
        ["--provider", "openai | anthropic | minimax"],
        ["--json", "machine-readable output"],
      ]),
    ),
    examplesBlock([
      "kova report latest",
      "kova report latest --target parallels --guest macos",
      "kova report kova_20260408_143117074",
    ]),
    notesBlock([
      "Filters only affect implicit selectors such as 'latest'.",
      "Use an explicit run id when you want an exact artifact regardless of filters.",
    ]),
    relatedBlock(["kova list runs", "kova diff"]),
  ]);
}

export function renderDiffHelp() {
  return joinBlocks([
    pageHeader("kova diff", "Compare a candidate run against a baseline"),
    usageBlock([
      "kova diff [baseline] [candidate] [filters] [options]",
      "kova diff --baseline <selector> --candidate <selector> [filters]",
    ]),
    block(
      "Selectors",
      keyValueBlock([
        ["auto", "smart baseline policy"],
        ["previous", "previous comparable run"],
        ["latest-pass", "latest comparable passing run"],
        ["latest", "latest recorded run"],
        ["<run-id>", "explicit run selection"],
      ]),
    ),
    block(
      "Filters",
      keyValueBlock([
        ["--target", "filter implicit selectors to a target"],
        ["--backend", "filter implicit selectors to a backend"],
        ["--guest", "filter implicit selectors to a guest axis"],
        ["--mode", "filter implicit selectors to a mode axis"],
        ["--provider", "filter implicit selectors to a provider axis"],
      ]),
    ),
    block(
      "Options",
      keyValueBlock([
        ["--baseline", "baseline selector override"],
        ["--candidate", "candidate selector override"],
        [
          "--fail-on",
          "regression | mixed-change | compatibility-delta | informational-drift | any-delta",
        ],
        ["--json", "machine-readable output"],
      ]),
    ),
    examplesBlock([
      "kova diff",
      "kova diff --target qa --backend host",
      "kova diff --baseline latest-pass --target parallels --guest macos",
    ]),
    notesBlock([
      "Filters only affect implicit selectors such as auto, latest, previous, and latest-pass.",
      "Kova distinguishes comparable regressions from cross-environment compatibility deltas.",
    ]),
    relatedBlock(["kova report latest", "kova list runs"]),
  ]);
}

export function renderListHelp() {
  return joinBlocks([
    pageHeader("kova list", "Browse Kova catalog and history data"),
    usageBlock(["kova list <subject> [options]", "kova list runs [filters] [--all] [--json]"]),
    block(
      "Subjects",
      table(
        ["subject", "description"],
        [
          ["runs", "recorded verification runs"],
          ["targets", "registered verification targets"],
          ["backends [target]", "execution backends for a target"],
          ["scenarios [qa]", "scenario catalog entries for a target"],
          ["surfaces [qa]", "coverage surfaces for a target catalog"],
          ["capabilities", "tracked product guarantees"],
        ],
      ),
    ),
    examplesBlock([
      "kova list runs",
      "kova list runs --target parallels --guest macos",
      "kova list backends qa",
      "kova list scenarios qa",
    ]),
    notesBlock(["Use 'kova list <subject> --help' for subject-specific details."]),
    relatedBlock(["kova report latest", "kova run qa --scenario channel-chat-baseline"]),
  ]);
}

export function renderListRunsHelp() {
  return joinBlocks([
    pageHeader("kova list runs", "Browse recorded runs"),
    usageBlock(["kova list runs [filters] [--all] [--json]"]),
    block(
      "Filters",
      keyValueBlock([
        ["--target", "qa | parallels"],
        ["--backend", "host | multipass | parallels"],
        ["--guest", "macos | windows | linux"],
        ["--mode", "fresh | upgrade | both"],
        ["--provider", "openai | anthropic | minimax"],
      ]),
    ),
    block(
      "Options",
      keyValueBlock([
        ["--all", "show full filtered history"],
        ["--json", "machine-readable output"],
      ]),
    ),
    examplesBlock([
      "kova list runs",
      "kova list runs --target qa --backend host",
      "kova list runs --target parallels --guest macos --all",
    ]),
    relatedBlock(["kova report latest", "kova diff --target qa --backend host"]),
  ]);
}

export function renderListTargetsHelp() {
  return joinBlocks([
    pageHeader("kova list targets", "Browse registered verification targets"),
    usageBlock(["kova list targets [--json]"]),
    examplesBlock(["kova list targets"]),
    relatedBlock(["kova run qa --help", "kova run parallels --guest macos --mode fresh"]),
  ]);
}

export function renderListBackendsHelp() {
  return joinBlocks([
    pageHeader("kova list backends", "Browse execution backends"),
    usageBlock(["kova list backends [target] [--json]"]),
    block("Arguments", keyValueBlock([["target", "qa | parallels"]])),
    examplesBlock(["kova list backends", "kova list backends qa", "kova list backends parallels"]),
    relatedBlock(["kova list targets", "kova run --help"]),
  ]);
}

export function renderListScenariosHelp() {
  return joinBlocks([
    pageHeader("kova list scenarios", "Browse scenario catalog entries"),
    usageBlock(["kova list scenarios [target] [--json]"]),
    block("Arguments", keyValueBlock([["target", "qa"]])),
    examplesBlock(["kova list scenarios qa"]),
    notesBlock(["Scenarios are the executable proofs Kova can run."]),
    relatedBlock(["kova run qa --scenario channel-chat-baseline", "kova list surfaces qa"]),
  ]);
}

export function renderListSurfacesHelp() {
  return joinBlocks([
    pageHeader("kova list surfaces", "Browse coverage surfaces"),
    usageBlock(["kova list surfaces [target] [--json]"]),
    block("Arguments", keyValueBlock([["target", "qa"]])),
    examplesBlock(["kova list surfaces qa"]),
    notesBlock([
      "Surfaces are the product contexts where scenarios execute, such as channel, DM, or memory.",
    ]),
    relatedBlock(["kova list scenarios qa", "kova list capabilities"]),
  ]);
}

export function renderListCapabilitiesHelp() {
  return joinBlocks([
    pageHeader("kova list capabilities", "Browse tracked product guarantees"),
    usageBlock(["kova list capabilities [--json]"]),
    examplesBlock(["kova list capabilities"]),
    notesBlock([
      "Capabilities are the product guarantees Kova is trying to prove across scenarios and backends.",
    ]),
    relatedBlock(["kova list surfaces qa", "kova diff --target qa --backend host"]),
  ]);
}
