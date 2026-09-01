// FILE: acpTokenUsage.ts
// Purpose: Cursor/ACP token-usage tracker. Merges session occupancy
// (`usage_update`) with prompt-result / `_meta` processed-token breakdowns,
// detecting cumulative vs per-turn payloads so profile stats never double-count.
// Layer: Server ACP provider helper

import type { ThreadTokenUsageSnapshot } from "@synara/contracts";

import {
  applyOccupancy,
  applyTokenUsageObservation,
  buildTokenUsageSnapshot,
  isRicherTokenDimensions,
  parseContextOccupancy,
  parseTokenDimensions,
  parseTokenUsageScale,
  resumeTokenUsageState,
  snapshotsMeaningfullyEqual,
  type ParsedTokenDimensions,
  type ThreadTokenUsageState,
  type TokenUsageReporting,
  type TokenUsageScale,
} from "../tokenUsageAccounting.ts";

export function snapshotFromAcpUsageUpdate(update: unknown): ThreadTokenUsageSnapshot | undefined {
  let state: ThreadTokenUsageState = {};
  const occupancy = parseContextOccupancy(update);
  if (occupancy) {
    state = applyOccupancy(state, occupancy);
  }
  const dimensions = parseTokenDimensions(update);
  if (dimensions) {
    const scale = parseTokenUsageScale(update);
    state = applyTokenUsageObservation(state, dimensions, {
      ...(scale ? { preferScale: scale } : {}),
    });
  }
  // `usedTokens` from usage_update is context occupancy, not spend. Keep the
  // whole snapshot estimated until processed counters have a proven scale so
  // profile aggregation cannot consume occupancy as its legacy token fallback.
  return buildTokenUsageSnapshot(state, state.scale ? "exact" : "estimated");
}

export interface AcpTokenUsageTracker {
  applyUsageUpdate(rawPayload: unknown): ThreadTokenUsageSnapshot | undefined;
  applyPromptResponse(rawPayload: unknown): ThreadTokenUsageSnapshot | undefined;
  snapshot(): ThreadTokenUsageSnapshot | undefined;
}

export function createAcpTokenUsageTracker(
  resumeFrom?: ThreadTokenUsageSnapshot,
): AcpTokenUsageTracker {
  let state = resumeTokenUsageState(resumeFrom);
  let processedReporting: TokenUsageReporting = state.cumulative
    ? (resumeFrom?.reporting ?? "estimated")
    : "estimated";
  let lastEmitted: ThreadTokenUsageSnapshot | undefined;
  let pendingUsageUpdate:
    | { readonly dimensions: ParsedTokenDimensions; readonly scale?: TokenUsageScale }
    | undefined;

  const emit = (
    next: ThreadTokenUsageState,
    reporting: TokenUsageReporting = processedReporting,
  ): ThreadTokenUsageSnapshot | undefined => {
    state = next;
    processedReporting = reporting;
    const snapshot = buildTokenUsageSnapshot(state, reporting);
    if (!snapshot || snapshotsMeaningfullyEqual(snapshot, lastEmitted)) {
      return undefined;
    }
    lastEmitted = snapshot;
    return snapshot;
  };

  return {
    applyUsageUpdate(rawPayload) {
      let next = state;
      const occupancy = parseContextOccupancy(rawPayload);
      if (occupancy) {
        next = applyOccupancy(next, occupancy);
      }
      const dimensions = parseTokenDimensions(rawPayload);
      if (dimensions) {
        const scale = parseTokenUsageScale(rawPayload);
        if (
          !pendingUsageUpdate ||
          isRicherTokenDimensions(dimensions, pendingUsageUpdate.dimensions)
        ) {
          pendingUsageUpdate = {
            dimensions,
            ...(scale ? { scale } : {}),
          };
        }
      }
      if (next === state && !occupancy && !dimensions) {
        return undefined;
      }
      // Processed counters in usage_update and PromptResponse often describe
      // the same completed work. Defer accounting until PromptResponse so the
      // turn is applied exactly once; occupancy remains safe to emit live.
      if (!occupancy) {
        return undefined;
      }
      return emit(next);
    },
    applyPromptResponse(rawPayload) {
      const responseDimensions = parseTokenDimensions(rawPayload);
      const dimensions =
        responseDimensions &&
        (!pendingUsageUpdate ||
          isRicherTokenDimensions(responseDimensions, pendingUsageUpdate.dimensions))
          ? responseDimensions
          : pendingUsageUpdate?.dimensions;
      const scale = parseTokenUsageScale(rawPayload) ?? pendingUsageUpdate?.scale;
      pendingUsageUpdate = undefined;
      if (!dimensions) {
        return undefined;
      }
      const next = applyTokenUsageObservation(state, dimensions, {
        ...(scale ? { preferScale: scale } : {}),
      });
      return emit(next, next.scale ? "exact" : "estimated");
    },
    snapshot() {
      return buildTokenUsageSnapshot(state, processedReporting);
    },
  };
}
