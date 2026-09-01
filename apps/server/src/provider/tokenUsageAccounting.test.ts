// FILE: tokenUsageAccounting.test.ts
// Purpose: Occupancy vs processed-token accounting, scale detection, and
// no-fabricated-zero snapshots for Cursor/Antigravity telemetry.
// Layer: Server provider tests

import { describe, expect, it } from "vitest";

import {
  cursorPromptResponseCumulativeFirst,
  cursorPromptResponseCumulativeSecond,
  cursorPromptResponsePerTurn,
  cursorPromptResponsePerTurnSecond,
  cursorPromptResponseZeroUsage,
  cursorUsageUpdateOccupancy,
} from "./fixtures/cursorTokenUsage.fixtures.ts";
import {
  applyOccupancy,
  applyTokenUsageObservation,
  buildTokenUsageSnapshot,
  detectTokenUsageScale,
  estimatedTokenUsageSnapshot,
  notReportedTokenUsageSnapshot,
  parseContextOccupancy,
  parseTokenDimensions,
  parseTokenUsageScale,
  resumeTokenUsageState,
  snapshotsMeaningfullyEqual,
} from "./tokenUsageAccounting.ts";

describe("tokenUsageAccounting", () => {
  it("keeps ACP occupancy separate from processed-token totals", () => {
    expect(parseContextOccupancy(cursorUsageUpdateOccupancy)).toEqual({
      usedTokens: 42_000,
      maxTokens: 1_000_000,
      usedPercent: 4.2,
      compactsAutomatically: true,
    });
    expect(parseTokenDimensions(cursorUsageUpdateOccupancy)).toBeUndefined();
    expect(parseTokenDimensions(cursorPromptResponsePerTurn)).toEqual({
      inputTokens: 1_200,
      outputTokens: 340,
      cachedInputTokens: 80,
      totalTokens: 1_620,
    });
    expect(parseContextOccupancy(cursorPromptResponsePerTurn)).toBeUndefined();
  });

  it("does not treat all-zero usage as exact processed telemetry", () => {
    expect(parseTokenDimensions(cursorPromptResponseZeroUsage)).toBeUndefined();
    expect(parseTokenDimensions({ usage: null })).toBeUndefined();
    expect(buildTokenUsageSnapshot({})).toBeUndefined();
  });

  it("detects per-turn payloads when output or totals drop", () => {
    const first = parseTokenDimensions(cursorPromptResponsePerTurn);
    const second = parseTokenDimensions(cursorPromptResponsePerTurnSecond);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(detectTokenUsageScale(second!, first)).toBe("per-turn");
  });

  it("does not guess cumulative scale from monotonic growth", () => {
    const first = parseTokenDimensions(cursorPromptResponseCumulativeFirst);
    const second = parseTokenDimensions(cursorPromptResponseCumulativeSecond);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(detectTokenUsageScale(second!, first)).toBeUndefined();
  });

  it("reads explicit provider scale hints", () => {
    expect(parseTokenUsageScale({ usage: { scale: "per_turn" } })).toBe("per-turn");
    expect(parseTokenUsageScale({ _meta: { usageScale: "session" } })).toBe("cumulative");
    expect(parseTokenUsageScale({ usage: { totalTokens: 100 } })).toBeUndefined();
  });

  it("deltas explicitly cumulative series so profile totals are not double-counted", () => {
    const first = parseTokenDimensions(cursorPromptResponseCumulativeFirst)!;
    const second = parseTokenDimensions(cursorPromptResponseCumulativeSecond)!;
    let state = applyTokenUsageObservation({}, first, { preferScale: "cumulative" });
    state = applyTokenUsageObservation(state, second, { preferScale: "cumulative" });
    const snapshot = buildTokenUsageSnapshot(state);
    expect(snapshot).toMatchObject({
      totalProcessedTokens: 2_910,
      inputTokens: 2_400,
      outputTokens: 510,
      lastUsedTokens: 1_370,
      lastInputTokens: 1_200,
      lastOutputTokens: 170,
      reporting: "exact",
    });
  });

  it("sums per-turn payloads across a session", () => {
    const first = parseTokenDimensions(cursorPromptResponsePerTurn)!;
    const second = parseTokenDimensions(cursorPromptResponsePerTurnSecond)!;
    let state = applyTokenUsageObservation({}, first);
    state = applyTokenUsageObservation(state, second);
    expect(buildTokenUsageSnapshot(state)).toMatchObject({
      totalProcessedTokens: 2_670,
      inputTokens: 2_100,
      outputTokens: 450,
      lastUsedTokens: 1_050,
      reporting: "exact",
    });
  });

  it("preserves an increasing per-turn hypothesis until a decrease proves it", () => {
    const first = { inputTokens: 80, outputTokens: 20, totalTokens: 100 };
    const second = { inputTokens: 160, outputTokens: 40, totalTokens: 200 };
    const third = { inputTokens: 120, outputTokens: 30, totalTokens: 150 };
    let state = applyTokenUsageObservation({}, first);
    state = applyTokenUsageObservation(state, second);
    expect(state.scale).toBeUndefined();
    expect(buildTokenUsageSnapshot(state)?.totalProcessedTokens).toBe(300);

    state = applyTokenUsageObservation(state, third);
    expect(state.scale).toBe("per-turn");
    expect(buildTokenUsageSnapshot(state)).toMatchObject({
      totalProcessedTokens: 450,
      lastUsedTokens: 150,
    });
  });

  it("keeps last-turn counters when a duplicate cumulative report arrives", () => {
    const first = parseTokenDimensions(cursorPromptResponseCumulativeFirst)!;
    let state = applyTokenUsageObservation({}, first, { preferScale: "cumulative" });
    const firstSnapshot = buildTokenUsageSnapshot(state);
    state = applyTokenUsageObservation(state, first, { preferScale: "cumulative" });
    expect(snapshotsMeaningfullyEqual(buildTokenUsageSnapshot(state), firstSnapshot)).toBe(true);
  });

  it("merges occupancy with processed tokens without using occupancy as spend", () => {
    const occupancy = parseContextOccupancy(cursorUsageUpdateOccupancy)!;
    const processed = parseTokenDimensions(cursorPromptResponsePerTurn)!;
    const snapshot = buildTokenUsageSnapshot(
      applyTokenUsageObservation(applyOccupancy({}, occupancy), processed),
    );
    expect(snapshot).toMatchObject({
      usedTokens: 42_000,
      maxTokens: 1_000_000,
      usedPercent: 4.2,
      totalProcessedTokens: 1_620,
      reporting: "exact",
    });
  });

  it("labels missing telemetry as not-reported instead of exact zeros", () => {
    expect(notReportedTokenUsageSnapshot()).toEqual({
      usedTokens: 0,
      reporting: "not-reported",
    });
    expect(buildTokenUsageSnapshot({}, "not-reported")).toEqual({
      usedTokens: 0,
      reporting: "not-reported",
    });
    expect(
      estimatedTokenUsageSnapshot(applyOccupancy({}, { usedTokens: 12, maxTokens: 100 })),
    ).toMatchObject({
      usedTokens: 12,
      maxTokens: 100,
      reporting: "estimated",
    });
  });

  it("resumes cumulative state and ignores not-reported snapshots", () => {
    expect(resumeTokenUsageState(notReportedTokenUsageSnapshot())).toEqual({});
    const resumed = resumeTokenUsageState({
      usedTokens: 10_000,
      maxTokens: 200_000,
      totalProcessedTokens: 4_000,
      inputTokens: 3_000,
      outputTokens: 1_000,
      reporting: "exact",
    });
    expect(resumed.scale).toBe("cumulative");
    expect(resumed.cumulative).toMatchObject({
      inputTokens: 3_000,
      outputTokens: 1_000,
      totalTokens: 4_000,
    });
    expect(resumed.occupancy).toMatchObject({ usedTokens: 10_000, maxTokens: 200_000 });
  });
});
