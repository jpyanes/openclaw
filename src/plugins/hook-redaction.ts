/**
 * Hook Redaction API — Milestone 4
 *
 * Provides the `redactMessages()` function for hard-deleting messages
 * from session transcripts. This is a general-purpose core capability —
 * any plugin can call it for any reason (moderation, PII scrubbing,
 * user request, compliance, etc.).
 */

import { createHash } from "node:crypto";
import { readFile, writeFile, rename, appendFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { RedactionAuditEntry } from "./hook-decision-types.js";

export type RedactMessageFilter = {
  indices?: number[];
  runId?: string;
  match?: {
    role: "user" | "assistant" | "tool";
    contentSubstring?: string;
  };
};

export type RedactMessageAuditInput = {
  reason: string;
  category?: string;
  hookPoint: string;
  pluginId: string;
  timestamp: number;
};

function extractMessageText(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj["content"] === "string") {
    return obj["content"];
  }
  if (Array.isArray(obj["content"])) {
    return obj["content"]
      .map((block) => {
        if (
          block &&
          typeof block === "object" &&
          typeof (block as Record<string, unknown>)["text"] === "string"
        ) {
          return (block as Record<string, unknown>)["text"] as string;
        }
        return "";
      })
      .join("");
  }
  if (typeof obj["text"] === "string") {
    return obj["text"];
  }
  return "";
}

export async function redactMessages(
  sessionFile: string,
  filter: RedactMessageFilter,
  audit: RedactMessageAuditInput,
): Promise<number> {
  let rawContent: string;
  try {
    rawContent = await readFile(sessionFile, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return 0;
    }
    throw err;
  }

  const lines = rawContent.split("\n").filter((line) => line.trim().length > 0);
  const entries: Array<{ raw: string; parsed: Record<string, unknown>; index: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    try {
      entries.push({
        raw: lines[i],
        parsed: JSON.parse(lines[i]) as Record<string, unknown>,
        index: i,
      });
    } catch {
      entries.push({ raw: lines[i], parsed: {}, index: i });
    }
  }

  const indicesToRemove = new Set<number>();

  if (filter.indices) {
    for (const idx of filter.indices) {
      if (idx >= 0 && idx < entries.length) {
        indicesToRemove.add(idx);
      }
    }
  }

  if (filter.runId) {
    for (const entry of entries) {
      if (entry.parsed.runId === filter.runId) {
        indicesToRemove.add(entry.index);
      }
    }
  }

  if (filter.match) {
    for (const entry of entries) {
      const nestedMessage =
        entry.parsed["message"] && typeof entry.parsed["message"] === "object"
          ? (entry.parsed["message"] as Record<string, unknown>)
          : undefined;
      const role =
        typeof nestedMessage?.["role"] === "string"
          ? nestedMessage["role"]
          : typeof entry.parsed.role === "string"
            ? entry.parsed.role
            : undefined;
      if (role !== filter.match.role) {
        continue;
      }
      if (filter.match.contentSubstring) {
        const text = extractMessageText(nestedMessage ?? entry.parsed);
        if (!text.includes(filter.match.contentSubstring)) {
          continue;
        }
      }
      indicesToRemove.add(entry.index);
    }
  }

  if (indicesToRemove.size === 0) {
    return 0;
  }

  const removedContentParts: string[] = [];
  for (const idx of indicesToRemove) {
    const entry = entries[idx];
    if (entry) {
      removedContentParts.push(entry.raw);
    }
  }
  const contentHash = createHash("sha256").update(removedContentParts.join("\n")).digest("hex");

  const keptLines = entries
    .filter((entry) => !indicesToRemove.has(entry.index))
    .map((entry) => entry.raw);

  const tempFile = `${sessionFile}.redact-tmp-${Date.now()}`;
  const newContent = keptLines.length > 0 ? keptLines.join("\n") + "\n" : "";

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await writeFile(tempFile, newContent, "utf-8");
      await rename(tempFile, sessionFile);
      lastError = undefined;
      break;
    } catch (err) {
      lastError = err;
      const delay = 100 * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  if (lastError) {
    throw new Error(
      `redactMessages: failed to atomically rewrite ${sessionFile} after 3 attempts`,
      {
        cause: lastError,
      },
    );
  }

  try {
    const auditEntry: RedactionAuditEntry = {
      ts: audit.timestamp,
      hookPoint: audit.hookPoint,
      pluginId: audit.pluginId,
      reason: audit.reason,
      category: audit.category,
      contentHash: `sha256:${contentHash}`,
      messagesRemoved: indicesToRemove.size,
    };

    const auditFile = join(dirname(sessionFile), "redaction-log.jsonl");
    await mkdir(dirname(auditFile), { recursive: true });
    await appendFile(auditFile, JSON.stringify(auditEntry) + "\n", "utf-8");
  } catch {
    // Audit is best-effort. Redaction already succeeded.
  }

  return indicesToRemove.size;
}

export async function redactDuplicateUserMessage(
  sessionFile: string,
  promptText: string,
): Promise<number> {
  let rawContent: string;
  try {
    rawContent = await readFile(sessionFile, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return 0;
    }
    throw err;
  }

  const lines = rawContent.split("\n").filter((line) => line.trim().length > 0);
  const entries: Array<{ raw: string; parsed: Record<string, unknown>; index: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    try {
      entries.push({
        raw: lines[i],
        parsed: JSON.parse(lines[i]) as Record<string, unknown>,
        index: i,
      });
    } catch {
      entries.push({ raw: lines[i], parsed: {}, index: i });
    }
  }

  const matchingUserIndices: number[] = [];
  for (const entry of entries) {
    const nestedMessage =
      entry.parsed["message"] && typeof entry.parsed["message"] === "object"
        ? (entry.parsed["message"] as Record<string, unknown>)
        : undefined;
    const role =
      typeof nestedMessage?.["role"] === "string"
        ? nestedMessage["role"]
        : typeof entry.parsed.role === "string"
          ? entry.parsed.role
          : undefined;
    if (role !== "user") {
      continue;
    }
    const text = extractMessageText(nestedMessage ?? entry.parsed);
    if (text === promptText || text.includes(promptText) || promptText.includes(text)) {
      matchingUserIndices.push(entry.index);
    }
  }

  if (matchingUserIndices.length < 2) {
    return 0;
  }

  const latestDuplicateIndex = matchingUserIndices[matchingUserIndices.length - 1];
  return redactMessages(
    sessionFile,
    { indices: [latestDuplicateIndex] },
    {
      reason: "Removed duplicate user prompt created by llm_output retry",
      hookPoint: "llm_output:retry:user_dedupe",
      pluginId: "core",
      timestamp: Date.now(),
      category: "retry_dedupe",
    },
  );
}
