// FILE: antigravityTokenUsage.test.ts
// Purpose: Antigravity per-thread usage from transcript/hooks/stdout, with
// explicit not-reported snapshots when the CLI omits counters.
// Layer: Server provider tests

import { describe, expect, it } from "vitest";

import {
  antigravityHookUsage,
  antigravityStdoutUsage,
  antigravityStdoutWithoutUsage,
  antigravityUsageMetadataStep,
  antigravityUsageMetadataStepTwo,
} from "./fixtures/antigravityTokenUsage.fixtures.ts";
import {
  createAntigravityTokenUsageTracker,
  extractAntigravityHookUsage,
  parseAntigravityStdoutUsage,
} from "./antigravityTokenUsage.ts";

describe("antigravityTokenUsage", () => {
  it("parses stdout JSON usage and ignores plain assistant text", () => {
    expect(parseAntigravityStdoutUsage(antigravityStdoutUsage)).toMatchObject({
      usage: {
        promptTokenCount: 2_200,
        candidatesTokenCount: 310,
        totalTokenCount: 2_510,
      },
    });
    expect(parseAntigravityStdoutUsage(antigravityStdoutWithoutUsage)).toBeUndefined();
  });

  it("extracts nested hook usageMetadata without inventing fields", () => {
    expect(extractAntigravityHookUsage(antigravityHookUsage)).toEqual({
      promptTokenCount: 1_000,
      candidatesTokenCount: 200,
      totalTokenCount: 1_200,
    });
    expect(extractAntigravityHookUsage({ conversationId: "conversation-fixture" })).toBeUndefined();
  });

  it("sums distinct Gemini usageMetadata steps as per-turn spend", () => {
    const tracker = createAntigravityTokenUsageTracker();
    tracker.startTurn();
    tracker.observe(antigravityUsageMetadataStep, "step:1");
    tracker.observe(antigravityUsageMetadataStepTwo, "step:2");
    expect(tracker.finalizeTurn()).toMatchObject({
      totalProcessedTokens: 1_340 + 2_370,
      inputTokens: 1_000 + 1_800,
      outputTokens: 200 + 150,
      reasoningOutputTokens: 40 + 20,
      lastUsedTokens: 2_370,
      reporting: "exact",
    });
  });

  it("does not double-count the same step from transcript and hook", () => {
    const tracker = createAntigravityTokenUsageTracker();
    tracker.startTurn();
    tracker.observe(antigravityUsageMetadataStep, "step:1");
    tracker.observe(antigravityHookUsage, "step:1");
    expect(tracker.finalizeTurn()).toMatchObject({
      totalProcessedTokens: 1_340,
      reasoningOutputTokens: 40,
      reporting: "exact",
    });
  });

  it("keeps the richest stdout/hook dump instead of summing duplicates", () => {
    const tracker = createAntigravityTokenUsageTracker();
    tracker.startTurn();
    tracker.observe(antigravityHookUsage, "hook:post-tool");
    tracker.observeStdout(antigravityStdoutUsage);
    expect(tracker.finalizeTurn()).toMatchObject({
      totalProcessedTokens: 2_510,
      inputTokens: 2_200,
      outputTokens: 310,
      reporting: "exact",
    });
  });

  it("accumulates across turns and does not re-emit prior spend on an empty turn", () => {
    const tracker = createAntigravityTokenUsageTracker();
    tracker.startTurn();
    tracker.observe(antigravityUsageMetadataStep, "step:1");
    expect(tracker.finalizeTurn()?.totalProcessedTokens).toBe(1_340);

    tracker.startTurn();
    tracker.observe(antigravityUsageMetadataStepTwo, "step:2");
    expect(tracker.finalizeTurn()).toMatchObject({
      totalProcessedTokens: 1_340 + 2_370,
      lastUsedTokens: 2_370,
      reporting: "exact",
    });

    tracker.startTurn();
    expect(tracker.finalizeTurn()).toEqual({
      usedTokens: 0,
      reporting: "not-reported",
    });
  });

  it("marks a completed turn without telemetry as not-reported", () => {
    const tracker = createAntigravityTokenUsageTracker();
    tracker.startTurn();
    tracker.observe({ type: "PLANNER_RESPONSE", content: "done" }, "step:1");
    tracker.observeStdout(antigravityStdoutWithoutUsage);
    expect(tracker.finalizeTurn()).toEqual({
      usedTokens: 0,
      reporting: "not-reported",
    });
  });
});
