// FILE: antigravityTokenUsage.ts
// Purpose: Per-thread Antigravity token accounting from transcript steps, hook
// payloads, and CLI print JSON. Account quota (Google Code Assist) is a
// separate data plane and is never mixed in. Missing telemetry becomes an
// explicit `not-reported` snapshot rather than fabricated zeros.
// Layer: Server provider utility

import type { ThreadTokenUsageSnapshot } from "@synara/contracts";

import {
  applyTokenUsageObservation,
  buildTokenUsageSnapshot,
  isRicherTokenDimensions,
  notReportedTokenUsageSnapshot,
  parseContextOccupancy,
  parseTokenDimensions,
  resumeTokenUsageState,
  type ParsedTokenDimensions,
  type ThreadTokenUsageState,
} from "./tokenUsageAccounting.ts";

const STDOUT_JSON_SCAN_LIMIT = 16 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export function parseAntigravityStdoutUsage(stdout: string): unknown | undefined {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const parsed = tryParseJson(trimmed);
    if (parsed !== undefined && parseTokenDimensions(parsed)) {
      return parsed;
    }
  }
  const scan =
    trimmed.length > STDOUT_JSON_SCAN_LIMIT ? trimmed.slice(-STDOUT_JSON_SCAN_LIMIT) : trimmed;
  const lastNewline = scan.lastIndexOf("\n");
  const lastLine = (lastNewline >= 0 ? scan.slice(lastNewline + 1) : scan).trim();
  if (lastLine.startsWith("{") || lastLine.startsWith("[")) {
    const parsed = tryParseJson(lastLine);
    if (parsed !== undefined && parseTokenDimensions(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function compareObservationKeys(left: string, right: string): number {
  const leftStep = left.startsWith("step:") ? Number(left.slice(5)) : Number.NaN;
  const rightStep = right.startsWith("step:") ? Number(right.slice(5)) : Number.NaN;
  if (Number.isFinite(leftStep) && Number.isFinite(rightStep) && leftStep !== rightStep) {
    return leftStep - rightStep;
  }
  return left.localeCompare(right);
}

function selectTurnObservations(
  observations: Map<string, ParsedTokenDimensions>,
): ParsedTokenDimensions[] {
  const entries = [...observations.entries()];
  const stepEntries = entries
    .filter(([key]) => key.startsWith("step:"))
    .toSorted(([left], [right]) => compareObservationKeys(left, right));
  if (stepEntries.length > 0) {
    return stepEntries.map(([, dimensions]) => dimensions);
  }
  // Hooks and stdout often dump the same turn usage twice. Keep the richest
  // record instead of summing duplicates when we have no step index.
  let richest: ParsedTokenDimensions | undefined;
  for (const dimensions of observations.values()) {
    if (!richest || isRicherTokenDimensions(dimensions, richest)) {
      richest = dimensions;
    }
  }
  return richest ? [richest] : [];
}

export function extractAntigravityHookUsage(payload: Record<string, unknown>): unknown | undefined {
  const nested =
    payload.usage ??
    payload.usageMetadata ??
    payload.usage_metadata ??
    payload.tokenUsage ??
    payload.token_usage;
  if (isRecord(nested) && parseTokenDimensions(nested)) {
    return nested;
  }
  return parseTokenDimensions(payload) ? payload : undefined;
}

export interface AntigravityTokenUsageTracker {
  startTurn(): void;
  observe(rawPayload: unknown, stepKey?: string): void;
  observeStdout(stdout: string): void;
  finalizeTurn(): ThreadTokenUsageSnapshot;
}

export function createAntigravityTokenUsageTracker(
  resumeFrom?: ThreadTokenUsageSnapshot,
): AntigravityTokenUsageTracker {
  let sessionState = resumeTokenUsageState(resumeFrom);
  const turnObservations = new Map<string, ParsedTokenDimensions>();
  let anonymousSequence = 0;

  const remember = (rawPayload: unknown, stepKey: string) => {
    const occupancy = parseContextOccupancy(rawPayload);
    if (occupancy) {
      sessionState = { ...sessionState, occupancy };
    }
    const dimensions = parseTokenDimensions(rawPayload);
    if (!dimensions) {
      return;
    }
    const existing = turnObservations.get(stepKey);
    if (!existing || isRicherTokenDimensions(dimensions, existing)) {
      turnObservations.set(stepKey, dimensions);
    }
  };

  return {
    startTurn() {
      turnObservations.clear();
      anonymousSequence = 0;
      if (sessionState.occupancy) {
        const { occupancy: _occupancy, ...rest } = sessionState;
        sessionState = rest;
      }
    },
    observe(rawPayload, stepKey) {
      remember(rawPayload, stepKey ?? `anon:${String(++anonymousSequence)}`);
    },
    observeStdout(stdout) {
      const parsed = parseAntigravityStdoutUsage(stdout);
      if (parsed !== undefined) {
        remember(parsed, "stdout");
      }
    },
    finalizeTurn() {
      const observations = selectTurnObservations(turnObservations);
      if (observations.length === 0) {
        if (sessionState.occupancy) {
          return (
            buildTokenUsageSnapshot({ occupancy: sessionState.occupancy }) ??
            notReportedTokenUsageSnapshot()
          );
        }
        return notReportedTokenUsageSnapshot();
      }

      // Gemini usageMetadata is per model call. Force per-turn so growing
      // prompt sizes are not mistaken for a single cumulative counter.
      let next: ThreadTokenUsageState = { ...sessionState, scale: "per-turn" };
      for (const dimensions of observations) {
        next = applyTokenUsageObservation(next, dimensions, { preferScale: "per-turn" });
      }
      sessionState = next;
      turnObservations.clear();
      return buildTokenUsageSnapshot(sessionState) ?? notReportedTokenUsageSnapshot();
    },
  };
}
