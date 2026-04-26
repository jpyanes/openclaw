import { describe, expect, it, vi } from "vitest";
import { createHookRunnerWithRegistry } from "./hooks.test-helpers.js";

const hookCtx = {
  agentId: "main",
  sessionId: "session-1",
};

async function expectLlmHookCall(params: {
  hookName: "llm_input" | "llm_output" | "llm_message_end";
  event: Record<string, unknown>;
  expectedEvent: Record<string, unknown>;
}) {
  const handler = vi.fn();
  const { runner } = createHookRunnerWithRegistry([{ hookName: params.hookName, handler }]);

  if (params.hookName === "llm_input") {
    await runner.runLlmInput(
      {
        ...params.event,
        historyMessages: [...((params.event.historyMessages as unknown[] | undefined) ?? [])],
      } as Parameters<typeof runner.runLlmInput>[0],
      hookCtx,
    );
  } else if (params.hookName === "llm_output") {
    await runner.runLlmOutput(
      {
        ...params.event,
        assistantTexts: [...((params.event.assistantTexts as string[] | undefined) ?? [])],
      } as Parameters<typeof runner.runLlmOutput>[0],
      hookCtx,
    );
  } else {
    await runner.runLlmMessageEnd(
      params.event as Parameters<typeof runner.runLlmMessageEnd>[0],
      hookCtx,
    );
  }

  expect(handler).toHaveBeenCalledWith(
    expect.objectContaining(params.expectedEvent),
    expect.objectContaining({ sessionId: "session-1" }),
  );
}

describe("llm hook runner methods", () => {
  it.each([
    {
      name: "runLlmInput invokes registered llm_input hooks",
      hookName: "llm_input" as const,
      methodName: "runLlmInput" as const,
      event: {
        runId: "run-1",
        sessionId: "session-1",
        provider: "openai",
        model: "gpt-5",
        systemPrompt: "be helpful",
        prompt: "hello",
        historyMessages: [],
        imagesCount: 0,
      },
      expectedEvent: { runId: "run-1", prompt: "hello" },
    },
    {
      name: "runLlmOutput invokes registered llm_output hooks",
      hookName: "llm_output" as const,
      methodName: "runLlmOutput" as const,
      event: {
        runId: "run-1",
        sessionId: "session-1",
        provider: "openai",
        model: "gpt-5",
        assistantTexts: ["hi"],
        lastAssistant: { role: "assistant", content: "hi" },
        usage: {
          input: 10,
          output: 20,
          total: 30,
        },
      },
      expectedEvent: { runId: "run-1", assistantTexts: ["hi"] },
    },
    {
      name: "runLlmMessageEnd invokes registered llm_message_end hooks",
      hookName: "llm_message_end" as const,
      methodName: "runLlmMessageEnd" as const,
      event: {
        runId: "run-1",
        sessionId: "session-1",
        provider: "openai",
        model: "gpt-5",
        message: { role: "assistant", content: [{ type: "text", text: "hi" }] },
        usage: {
          input: 10,
          output: 20,
          total: 30,
        },
      },
      expectedEvent: {
        runId: "run-1",
        message: { role: "assistant", content: [{ type: "text", text: "hi" }] },
      },
    },
  ] as const)("$name", async ({ hookName, expectedEvent, event }) => {
    await expectLlmHookCall({ hookName, event, expectedEvent });
  });

  it("hasHooks returns true for registered llm hooks", () => {
    const { runner } = createHookRunnerWithRegistry([{ hookName: "llm_input", handler: vi.fn() }]);

    expect(runner.hasHooks("llm_input")).toBe(true);
    expect(runner.hasHooks("llm_output")).toBe(false);
    expect(runner.hasHooks("llm_message_end")).toBe(false);
  });
});
