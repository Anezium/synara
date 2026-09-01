// FILE: antigravityTokenUsage.fixtures.ts
// Purpose: Sanitized Antigravity transcript/hook/CLI usage payloads for tests.
// No credentials, account ids, or personal paths.
// Layer: Server provider test fixtures

export const antigravityUsageMetadataStep = {
  step_index: 1,
  type: "PLANNER_RESPONSE",
  usageMetadata: {
    promptTokenCount: 1_000,
    candidatesTokenCount: 200,
    thoughtsTokenCount: 40,
    cachedContentTokenCount: 100,
    totalTokenCount: 1_340,
  },
} as const;

export const antigravityUsageMetadataStepTwo = {
  step_index: 2,
  type: "PLANNER_RESPONSE",
  usageMetadata: {
    promptTokenCount: 1_800,
    candidatesTokenCount: 150,
    thoughtsTokenCount: 20,
    cachedContentTokenCount: 400,
    totalTokenCount: 2_370,
  },
} as const;

export const antigravityHookUsage = {
  conversationId: "conversation-fixture",
  transcriptPath: "transcript.jsonl",
  stepIdx: 1,
  usageMetadata: {
    promptTokenCount: 1_000,
    candidatesTokenCount: 200,
    totalTokenCount: 1_200,
  },
} as const;

export const antigravityStdoutUsage = `${JSON.stringify({
  type: "result",
  usage: {
    promptTokenCount: 2_200,
    candidatesTokenCount: 310,
    totalTokenCount: 2_510,
  },
})}\n`;

export const antigravityStdoutWithoutUsage = "Here is the solution.\n";
