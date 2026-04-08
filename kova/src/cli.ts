import path from "node:path";
import { fileURLToPath } from "node:url";
import { diffCommand } from "./commands/diff.js";
import { listCommand } from "./commands/list.js";
import { reportCommand } from "./commands/report.js";
import { runCommand } from "./commands/run.js";
import { badge } from "./console/format.js";
import { renderKovaHelp } from "./help.js";

async function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const [, , command, ...args] = process.argv;

  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(renderKovaHelp());
    return;
  }

  if (command === "run") {
    await runCommand(repoRoot, args);
    return;
  }

  if (command === "list") {
    await listCommand(repoRoot, args);
    return;
  }

  if (command === "report") {
    await reportCommand(repoRoot, args);
    return;
  }

  if (command === "diff") {
    await diffCommand(repoRoot, args);
    return;
  }

  throw new Error(
    `unknown Kova command: ${command}. Use 'kova --help' to inspect the command surface.`,
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${badge("ERROR", "danger")} ${message}\n`);
  process.exitCode = 1;
});
