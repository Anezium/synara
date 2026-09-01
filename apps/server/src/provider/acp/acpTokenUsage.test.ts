// FILE: acpTokenUsage.test.ts
// Purpose: Cursor/ACP tracker merges occupancy and prompt-result usage without
// inventing exact counts when the CLI omits telemetry.
// Layer: Server ACP provider tests

import { describe, expect, it } from "vitest";

import {
  cursorPromptResponseCumulativeFirst,
  cursorPromptResponseCumulativeSecond,
  cursorPromptResponseNullUsage,
  cursorPromptResponsePerTurn,
  cursorPromptResponseZeroUsage,
  cursorUsageUpdateEmpty,
  cursorUsageUpdateOccupancy,
  cursorUsageUpdateOccupancyWithMeta,
} from "../fixtures/cursorTokenUsage.fixtures.ts";
import { createAcpTokenUsageTracker, snapshotFromAcpUsageUpdate } from "./acpTokenUsage.ts";

describe("acpTokenUsage", () => {
  it("keeps occupancy-only usage_update out of exact spend totals", () => {
    expect(snapshotFromAcpUsageUpdate(cursorUsageUpdateOccupancy.update)).toEqual({
      usedTokens: 42_000,
      usedPercent: 4.2,
      maxTokens: 1_000_000,
      compactsAutomatically: true,
      reporting: "estimated",
    });
  });

  it("drops empty usage_update instead of storing exact zeros", () => {
    expect(snapshotFromAcpUsageUpdate(cursorUsageUpdateEmpty.update)).toBeUndefined();
    expect(snapshotFromAcpUsageUpdate({ sessionUpdate: "usage_update" })).toBeUndefined();
  });

  it("keeps unscaled processed usage_update counters estimated", () => {
    expect(snapshotFromAcpUsageUpdate(cursorUsageUpdateOccupancyWithMeta.update)).toMatchObject({
      usedTokens: 42_000,
      maxTokens: 1_000_000,
      totalProcessedTokens: 12_200,
      inputTokens: 8_000,
      outputTokens: 1_200,
      cachedInputTokens: 3_000,
      reporting: "estimated",
    });
  });

  it("accepts an explicit scale for processed usage_update counters", () => {
    expect(
      snapshotFromAcpUsageUpdate({
        ...cursorUsageUpdateOccupancyWithMeta.update,
        _meta: {
          ...cursorUsageUpdateOccupancyWithMeta.update._meta,
          usageScale: "cumulative",
        },
      }),
    ).toMatchObject({
      totalProcessedTokens: 12_200,
      reporting: "exact",
    });
  });

  it("emits occupancy from usage_update and processed tokens from prompt results", () => {
    const tracker = createAcpTokenUsageTracker();
    expect(tracker.applyUsageUpdate(cursorUsageUpdateOccupancy)).toMatchObject({
      usedTokens: 42_000,
      maxTokens: 1_000_000,
      reporting: "estimated",
    });
    expect(tracker.applyPromptResponse(cursorPromptResponsePerTurn)).toMatchObject({
      usedTokens: 42_000,
      totalProcessedTokens: 1_620,
      lastUsedTokens: 1_620,
      reporting: "estimated",
    });
  });

  it("does not emit when prompt usage is null or all zeros", () => {
    const tracker = createAcpTokenUsageTracker();
    expect(tracker.applyPromptResponse(cursorPromptResponseNullUsage)).toBeUndefined();
    expect(tracker.applyPromptResponse(cursorPromptResponseZeroUsage)).toBeUndefined();
    expect(tracker.snapshot()).toBeUndefined();
  });

  it("keeps a monotonic series estimated when the provider omits scale", () => {
    const tracker = createAcpTokenUsageTracker();
    expect(tracker.applyPromptResponse(cursorPromptResponseCumulativeFirst)).toMatchObject({
      totalProcessedTokens: 1_540,
      lastUsedTokens: 1_540,
      reporting: "estimated",
    });
    expect(tracker.applyPromptResponse(cursorPromptResponseCumulativeSecond)).toMatchObject({
      totalProcessedTokens: 4_450,
      lastUsedTokens: 2_910,
      reporting: "estimated",
    });
  });

  it("deltas a series only when the provider explicitly marks it cumulative", () => {
    const tracker = createAcpTokenUsageTracker();
    expect(
      tracker.applyPromptResponse({
        ...cursorPromptResponseCumulativeFirst,
        _meta: { usageScale: "cumulative" },
      }),
    ).toMatchObject({
      totalProcessedTokens: 1_540,
      reporting: "exact",
    });
    expect(
      tracker.applyPromptResponse({
        ...cursorPromptResponseCumulativeSecond,
        _meta: { usageScale: "cumulative" },
      }),
    ).toMatchObject({
      totalProcessedTokens: 2_910,
      lastUsedTokens: 1_370,
      lastInputTokens: 1_200,
      lastOutputTokens: 170,
      reporting: "exact",
    });
  });

  it("accounts matching usage_update and PromptResponse counters once", () => {
    const tracker = createAcpTokenUsageTracker();
    const usage = { inputTokens: 800, outputTokens: 200, totalTokens: 1_000 };
    expect(tracker.applyUsageUpdate({ update: { usage } })).toBeUndefined();
    expect(tracker.applyPromptResponse({ usage })).toMatchObject({
      totalProcessedTokens: 1_000,
      reporting: "estimated",
    });
  });

  it("does not re-emit an identical occupancy snapshot", () => {
    const tracker = createAcpTokenUsageTracker();
    expect(tracker.applyUsageUpdate(cursorUsageUpdateOccupancy)).toBeDefined();
    expect(tracker.applyUsageUpdate(cursorUsageUpdateOccupancy)).toBeUndefined();
  });
});
