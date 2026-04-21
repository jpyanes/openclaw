import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "src/plugins/hook-decision-types.test.ts",
      "src/plugins/hook-lifecycle-gates.test.ts",
      "src/plugins/hook-redaction.test.ts",
      "extensions/hook-echo/hook-echo.integration.test.ts",
      "src/agents/pi-tool-definition-adapter.after-tool-call.fires-once.test.ts",
    ],
  },
});
