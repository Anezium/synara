// FILE: cursorTokenUsage.fixtures.ts
// Purpose: Sanitized Cursor/ACP token-usage payloads for regression tests.
// No credentials, account ids, or personal paths.
// Layer: Server provider test fixtures

export const cursorUsageUpdateOccupancy = {
  sessionId: "session-fixture",
  update: {
    sessionUpdate: "usage_update",
    used: 42_000,
    size: 1_000_000,
    cost: { amount: 0.2, currency: "USD" },
  },
} as const;

export const cursorUsageUpdateOccupancyWithMeta = {
  sessionId: "session-fixture",
  update: {
    sessionUpdate: "usage_update",
    used: 42_000,
    size: 1_000_000,
    _meta: {
      usage: {
        inputTokens: 8_000,
        outputTokens: 1_200,
        cachedInputTokens: 3_000,
        totalTokens: 12_200,
      },
    },
  },
} as const;

export const cursorUsageUpdateEmpty = {
  sessionId: "session-fixture",
  update: {
    sessionUpdate: "usage_update",
    used: 0,
    size: 0,
  },
} as const;

export const cursorPromptResponsePerTurn = {
  stopReason: "end_turn",
  usage: {
    inputTokens: 1_200,
    outputTokens: 340,
    cachedInputTokens: 80,
    totalTokens: 1_620,
  },
} as const;

export const cursorPromptResponsePerTurnSecond = {
  stopReason: "end_turn",
  usage: {
    inputTokens: 900,
    outputTokens: 110,
    cachedInputTokens: 40,
    totalTokens: 1_050,
  },
} as const;

export const cursorPromptResponseCumulativeFirst = {
  stopReason: "end_turn",
  usage: {
    prompt_tokens: 1_200,
    completion_tokens: 340,
    total_tokens: 1_540,
  },
} as const;

export const cursorPromptResponseCumulativeSecond = {
  stopReason: "end_turn",
  usage: {
    prompt_tokens: 2_400,
    completion_tokens: 510,
    total_tokens: 2_910,
  },
} as const;

export const cursorPromptResponseNullUsage = {
  stopReason: "end_turn",
  usage: null,
} as const;

export const cursorPromptResponseZeroUsage = {
  stopReason: "end_turn",
  usage: {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  },
} as const;
