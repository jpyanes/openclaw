import path from "node:path";
import { fileURLToPath } from "node:url";
import { reportCommand } from "./commands/report.js";
import { runCommand } from "./commands/run.js";

function printHelp() {
  process.stdout.write(
    [
      "Kova",
      "",
      "Usage:",
      "  kova run qa [--backend host|multipass] [--provider-mode mock-openai|live-frontier] [--scenario <id>]",
      "  kova report [latest|<run-id>]",
      "",
    ].join("\n"),
  );
  process.stdout.write("\n");
}

async function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const [, , command, ...args] = process.argv;

  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "run") {
    await runCommand(repoRoot, args);
    return;
  }

  if (command === "report") {
    await reportCommand(repoRoot, args);
    return;
  }

  throw new Error(`unknown Kova command: ${command}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`kova error: ${message}\n`);
  process.exitCode = 1;
});
