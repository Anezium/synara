// FILE: tokenUsageAccounting.ts
// Purpose: Shared token-dimension parsing and cumulative/per-turn accounting for
// provider-reported telemetry. Occupancy (context window) stays separate from
// processed-token totals so profile stats can delta `totalProcessedTokens`
// without treating context-meter updates as spend.
// Layer: Server provider utility

import type { ThreadTokenUsageSnapshot } from "@synara/contracts";

import { computeUsagePercent } from "./tokenUsage.ts";

export const TOKEN_USAGE_REPORTING = ["exact", "estimated", "not-reported"] as const;
export type TokenUsageReporting = (typeof TOKEN_USAGE_REPORTING)[number];

export type TokenUsageScale = "per-turn" | "cumulative";

export interface ParsedTokenDimensions {
  readonly inputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly outputTokens?: number;
  readonly reasoningOutputTokens?: number;
  readonly totalTokens?: number;
}

export interface ContextOccupancy {
  readonly usedTokens: number;
  readonly maxTokens?: number;
  readonly usedPercent?: number;
  readonly compactsAutomatically?: boolean;
}

export interface ThreadTokenUsageState {
  scale?: TokenUsageScale;
  lastRaw?: ParsedTokenDimensions;
  lastTurn?: ParsedTokenDimensions;
  cumulative?: ParsedTokenDimensions;
  occupancy?: ContextOccupancy;
}

const INPUT_ALIASES = [
  "inputTokens",
  "input_tokens",
  "promptTokens",
  "prompt_tokens",
  "promptTokenCount",
  "prompt_token_count",
] as const;

const OUTPUT_ALIASES = [
  "outputTokens",
  "output_tokens",
  "completionTokens",
  "completion_tokens",
  "candidatesTokenCount",
  "candidates_token_count",
] as const;

const REASONING_ALIASES = [
  "reasoningOutputTokens",
  "reasoning_output_tokens",
  "thoughtTokens",
  "thought_tokens",
  "thoughtsTokenCount",
  "thoughts_token_count",
  "reasoningTokens",
  "reasoning_tokens",
] as const;

const CACHE_READ_ALIASES = [
  "cachedReadTokens",
  "cached_read_tokens",
  "cachedInputTokens",
  "cached_input_tokens",
  "cacheReadInputTokens",
  "cache_read_input_tokens",
  "cachedContentTokenCount",
  "cached_content_token_count",
  "cacheRead",
  "cache_read",
] as const;

const CACHE_WRITE_ALIASES = [
  "cachedWriteTokens",
  "cached_write_tokens",
  "cacheWriteTokens",
  "cache_write_tokens",
  "cacheCreationInputTokens",
  "cache_creation_input_tokens",
  "cacheWrite",
  "cache_write",
] as const;

const TOTAL_ALIASES = [
  "totalTokens",
  "total_tokens",
  "totalTokenCount",
  "total_token_count",
  "totalProcessedTokens",
  "total_processed_tokens",
] as const;

const NESTED_USAGE_KEYS = [
  "usage",
  "usageMetadata",
  "usage_metadata",
  "tokenUsage",
  "token_usage",
  "tokens",
] as const;

const SCALE_ALIASES = [
  "tokenUsageScale",
  "token_usage_scale",
  "usageScale",
  "usage_scale",
  "scale",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function tokenCount(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.round(value);
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.round(parsed);
    }
  }
  return undefined;
}

function firstTokenCount(
  record: Record<string, unknown>,
  aliases: ReadonlyArray<string>,
): number | undefined {
  for (const alias of aliases) {
    const count = tokenCount(record[alias]);
    if (count !== undefined) {
      return count;
    }
  }
  return undefined;
}

function dimensionsFromRecord(record: Record<string, unknown>): ParsedTokenDimensions | undefined {
  const inputTokens = firstTokenCount(record, INPUT_ALIASES);
  const outputTokens = firstTokenCount(record, OUTPUT_ALIASES);
  const reasoningOutputTokens = firstTokenCount(record, REASONING_ALIASES);
  const cachedInputTokens = firstTokenCount(record, CACHE_READ_ALIASES);
  const cacheWriteTokens = firstTokenCount(record, CACHE_WRITE_ALIASES);
  const totalTokens = firstTokenCount(record, TOTAL_ALIASES);
  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    reasoningOutputTokens === undefined &&
    cachedInputTokens === undefined &&
    cacheWriteTokens === undefined &&
    totalTokens === undefined
  ) {
    return undefined;
  }
  const parsed = {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(reasoningOutputTokens !== undefined ? { reasoningOutputTokens } : {}),
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
  };
  if (
    (parsed.inputTokens ?? 0) +
      (parsed.outputTokens ?? 0) +
      (parsed.reasoningOutputTokens ?? 0) +
      (parsed.cachedInputTokens ?? 0) +
      (parsed.cacheWriteTokens ?? 0) +
      (parsed.totalTokens ?? 0) <=
    0
  ) {
    return undefined;
  }
  return parsed;
}

function occupancyFromRecord(record: Record<string, unknown>): ContextOccupancy | undefined {
  const usedTokens =
    tokenCount(record.used) ?? tokenCount(record.usedTokens) ?? tokenCount(record.used_tokens);
  if (usedTokens === undefined) {
    return undefined;
  }
  const rawMaxTokens =
    tokenCount(record.size) ??
    tokenCount(record.maxTokens) ??
    tokenCount(record.max_tokens) ??
    tokenCount(record.contextWindow) ??
    tokenCount(record.context_window);
  const maxTokens = rawMaxTokens !== undefined && rawMaxTokens > 0 ? rawMaxTokens : undefined;
  const reportedPercent =
    typeof record.usedPercent === "number" && Number.isFinite(record.usedPercent)
      ? Math.max(0, Math.min(100, record.usedPercent))
      : undefined;
  const usedPercent = computeUsagePercent(usedTokens, maxTokens) ?? reportedPercent;
  if (usedTokens <= 0 && maxTokens === undefined && usedPercent === undefined) {
    return undefined;
  }
  return {
    usedTokens,
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(usedPercent !== undefined ? { usedPercent } : {}),
    ...(record.used !== undefined && record.size !== undefined && maxTokens !== undefined
      ? { compactsAutomatically: true }
      : {}),
  };
}

function collectUsageRecords(value: unknown): Record<string, unknown>[] {
  if (!isRecord(value)) {
    return [];
  }
  const records: Record<string, unknown>[] = [value];
  for (const key of NESTED_USAGE_KEYS) {
    const nested = value[key];
    if (isRecord(nested)) {
      records.push(nested);
    }
  }
  const meta = value._meta;
  if (isRecord(meta)) {
    records.push(meta);
    for (const key of NESTED_USAGE_KEYS) {
      const nested = meta[key];
      if (isRecord(nested)) {
        records.push(nested);
      }
    }
    const quota = meta.quota;
    if (isRecord(quota)) {
      records.push(quota);
      const tokenCountRecord = quota.token_count ?? quota.tokenCount;
      if (isRecord(tokenCountRecord)) {
        records.push(tokenCountRecord);
      }
    }
  }
  const update = value.update;
  if (isRecord(update)) {
    records.push(...collectUsageRecords(update));
  }
  const result = value.result;
  if (isRecord(result)) {
    records.push(...collectUsageRecords(result));
  }
  return records;
}

export function parseTokenDimensions(value: unknown): ParsedTokenDimensions | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  let merged: ParsedTokenDimensions | undefined;
  for (const record of collectUsageRecords(value)) {
    const parsed = dimensionsFromRecord(record);
    if (!parsed) {
      continue;
    }
    merged = merged ? mergeDimensions(merged, parsed) : parsed;
  }
  return merged;
}

export function parseTokenUsageScale(value: unknown): TokenUsageScale | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  for (const record of collectUsageRecords(value)) {
    for (const alias of SCALE_ALIASES) {
      const raw = record[alias];
      if (typeof raw !== "string") {
        continue;
      }
      const normalized = raw.trim().toLowerCase().replaceAll("_", "-");
      if (["per-turn", "turn", "request", "prompt"].includes(normalized)) {
        return "per-turn";
      }
      if (["cumulative", "session", "session-total", "lifetime"].includes(normalized)) {
        return "cumulative";
      }
    }
  }
  return undefined;
}

export function parseContextOccupancy(value: unknown): ContextOccupancy | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  for (const record of collectUsageRecords(value)) {
    const occupancy = occupancyFromRecord(record);
    if (occupancy) {
      return occupancy;
    }
  }
  return undefined;
}

function mergeDimensions(
  base: ParsedTokenDimensions,
  extra: ParsedTokenDimensions,
): ParsedTokenDimensions {
  return {
    ...(base.inputTokens !== undefined || extra.inputTokens !== undefined
      ? { inputTokens: extra.inputTokens ?? base.inputTokens }
      : {}),
    ...(base.cachedInputTokens !== undefined || extra.cachedInputTokens !== undefined
      ? { cachedInputTokens: extra.cachedInputTokens ?? base.cachedInputTokens }
      : {}),
    ...(base.cacheWriteTokens !== undefined || extra.cacheWriteTokens !== undefined
      ? { cacheWriteTokens: extra.cacheWriteTokens ?? base.cacheWriteTokens }
      : {}),
    ...(base.outputTokens !== undefined || extra.outputTokens !== undefined
      ? { outputTokens: extra.outputTokens ?? base.outputTokens }
      : {}),
    ...(base.reasoningOutputTokens !== undefined || extra.reasoningOutputTokens !== undefined
      ? { reasoningOutputTokens: extra.reasoningOutputTokens ?? base.reasoningOutputTokens }
      : {}),
    ...(base.totalTokens !== undefined || extra.totalTokens !== undefined
      ? { totalTokens: extra.totalTokens ?? base.totalTokens }
      : {}),
  };
}

export function resolvedProcessedTotal(dimensions: ParsedTokenDimensions): number | undefined {
  if (dimensions.totalTokens !== undefined && dimensions.totalTokens > 0) {
    return dimensions.totalTokens;
  }
  const input = dimensions.inputTokens ?? 0;
  const output = dimensions.outputTokens ?? 0;
  const reasoning = dimensions.reasoningOutputTokens ?? 0;
  const cacheRead = dimensions.cachedInputTokens ?? 0;
  const cacheWrite = dimensions.cacheWriteTokens ?? 0;
  const withoutCache = input + output + reasoning;
  if (withoutCache <= 0 && cacheRead + cacheWrite <= 0) {
    return undefined;
  }
  // When input already covers cache reads (Copilot-style), adding cache again
  // would double-count. Claude/ACP-style reports tiny input plus large cache.
  if (cacheRead > 0 && input >= cacheRead) {
    return withoutCache > 0 ? withoutCache : undefined;
  }
  const withCache = withoutCache + cacheRead + cacheWrite;
  return withCache > 0 ? withCache : undefined;
}

export function dimensionFieldCount(dimensions: ParsedTokenDimensions): number {
  return (
    (dimensions.inputTokens !== undefined ? 1 : 0) +
    (dimensions.cachedInputTokens !== undefined ? 1 : 0) +
    (dimensions.cacheWriteTokens !== undefined ? 1 : 0) +
    (dimensions.outputTokens !== undefined ? 1 : 0) +
    (dimensions.reasoningOutputTokens !== undefined ? 1 : 0) +
    (dimensions.totalTokens !== undefined ? 1 : 0)
  );
}

export function isRicherTokenDimensions(
  candidate: ParsedTokenDimensions,
  existing: ParsedTokenDimensions,
): boolean {
  const candidateFields = dimensionFieldCount(candidate);
  const existingFields = dimensionFieldCount(existing);
  if (candidateFields !== existingFields) {
    return candidateFields > existingFields;
  }
  const candidateTotal = resolvedProcessedTotal(candidate) ?? 0;
  const existingTotal = resolvedProcessedTotal(existing) ?? 0;
  return candidateTotal > existingTotal;
}

export function detectTokenUsageScale(
  current: ParsedTokenDimensions,
  previous: ParsedTokenDimensions | undefined,
): TokenUsageScale | undefined {
  if (!previous) {
    return undefined;
  }
  const currentOutput = current.outputTokens;
  const previousOutput = previous.outputTokens;
  if (
    currentOutput !== undefined &&
    previousOutput !== undefined &&
    currentOutput < previousOutput
  ) {
    return "per-turn";
  }
  const currentTotal = resolvedProcessedTotal(current);
  const previousTotal = resolvedProcessedTotal(previous);
  if (currentTotal !== undefined && previousTotal !== undefined && currentTotal < previousTotal) {
    return "per-turn";
  }
  // A monotonic increase is ambiguous: both cumulative session counters and
  // independent per-turn counters can grow from one turn to the next. ACP v1
  // implementations use both meanings for PromptResponse.usage, so only a
  // decrease can prove per-turn semantics. Cumulative semantics must come from
  // an explicit provider hint.
  return undefined;
}

function addDimensions(
  left: ParsedTokenDimensions | undefined,
  right: ParsedTokenDimensions,
): ParsedTokenDimensions {
  const inputTokens = (left?.inputTokens ?? 0) + (right.inputTokens ?? 0);
  const cachedInputTokens = (left?.cachedInputTokens ?? 0) + (right.cachedInputTokens ?? 0);
  const cacheWriteTokens = (left?.cacheWriteTokens ?? 0) + (right.cacheWriteTokens ?? 0);
  const outputTokens = (left?.outputTokens ?? 0) + (right.outputTokens ?? 0);
  const reasoningOutputTokens =
    (left?.reasoningOutputTokens ?? 0) + (right.reasoningOutputTokens ?? 0);
  const totalTokens =
    (resolvedProcessedTotal(left ?? {}) ?? 0) + (resolvedProcessedTotal(right) ?? 0);
  return {
    ...(inputTokens > 0 || left?.inputTokens !== undefined || right.inputTokens !== undefined
      ? { inputTokens }
      : {}),
    ...(cachedInputTokens > 0 ||
    left?.cachedInputTokens !== undefined ||
    right.cachedInputTokens !== undefined
      ? { cachedInputTokens }
      : {}),
    ...(cacheWriteTokens > 0 ||
    left?.cacheWriteTokens !== undefined ||
    right.cacheWriteTokens !== undefined
      ? { cacheWriteTokens }
      : {}),
    ...(outputTokens > 0 || left?.outputTokens !== undefined || right.outputTokens !== undefined
      ? { outputTokens }
      : {}),
    ...(reasoningOutputTokens > 0 ||
    left?.reasoningOutputTokens !== undefined ||
    right.reasoningOutputTokens !== undefined
      ? { reasoningOutputTokens }
      : {}),
    ...(totalTokens > 0 ? { totalTokens } : {}),
  };
}

function subtractNonNegative(current: number | undefined, previous: number | undefined): number {
  if (current === undefined) {
    return 0;
  }
  if (previous === undefined) {
    return current;
  }
  return Math.max(0, current - previous);
}

function perTurnFromCumulative(
  current: ParsedTokenDimensions,
  previous: ParsedTokenDimensions | undefined,
): ParsedTokenDimensions {
  if (!previous) {
    return current;
  }
  const currentTotal = resolvedProcessedTotal(current);
  const previousTotal = resolvedProcessedTotal(previous);
  if (currentTotal !== undefined && previousTotal !== undefined && currentTotal < previousTotal) {
    // A known cumulative counter restarted (for example after session resume).
    // The first value in the new epoch is itself the complete delta.
    return current;
  }
  const inputTokens = subtractNonNegative(current.inputTokens, previous.inputTokens);
  const cachedInputTokens = subtractNonNegative(
    current.cachedInputTokens,
    previous.cachedInputTokens,
  );
  const cacheWriteTokens = subtractNonNegative(current.cacheWriteTokens, previous.cacheWriteTokens);
  const outputTokens = subtractNonNegative(current.outputTokens, previous.outputTokens);
  const reasoningOutputTokens = subtractNonNegative(
    current.reasoningOutputTokens,
    previous.reasoningOutputTokens,
  );
  const totalTokens = subtractNonNegative(
    resolvedProcessedTotal(current),
    resolvedProcessedTotal(previous),
  );
  return {
    ...(current.inputTokens !== undefined ? { inputTokens } : {}),
    ...(current.cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(current.cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
    ...(current.outputTokens !== undefined ? { outputTokens } : {}),
    ...(current.reasoningOutputTokens !== undefined ? { reasoningOutputTokens } : {}),
    ...(resolvedProcessedTotal(current) !== undefined ? { totalTokens } : {}),
  };
}

export function applyTokenUsageObservation(
  state: ThreadTokenUsageState,
  dimensions: ParsedTokenDimensions,
  options?: { readonly preferScale?: TokenUsageScale },
): ThreadTokenUsageState {
  const detected = detectTokenUsageScale(dimensions, state.lastRaw);
  let scale = options?.preferScale ?? state.scale;
  if (scale === undefined && detected === "per-turn") {
    scale = "per-turn";
  }

  let cumulative: ParsedTokenDimensions;
  let lastTurn: ParsedTokenDimensions;
  if (scale === "cumulative") {
    cumulative = dimensions;
    const delta = perTurnFromCumulative(dimensions, state.lastRaw);
    // Duplicate cumulative reports (usage_update + prompt result) must not
    // wipe the last real turn with a zero delta.
    lastTurn = (resolvedProcessedTotal(delta) ?? 0) > 0 ? delta : (state.lastTurn ?? delta);
  } else if (scale === "per-turn") {
    lastTurn = dimensions;
    cumulative = addDimensions(state.cumulative, dimensions);
  } else {
    // Preserve the per-turn hypothesis while the scale is ambiguous. The
    // caller must mark this snapshot estimated, so profile totals never consume
    // it as exact. If a later decrease proves per-turn semantics, the complete
    // history is already accumulated; an explicit cumulative hint replaces it.
    cumulative = addDimensions(state.cumulative, dimensions);
    lastTurn = dimensions;
  }

  return {
    ...state,
    ...(scale !== undefined ? { scale } : {}),
    lastRaw: dimensions,
    lastTurn,
    cumulative,
  };
}

function lastUsedTokensFrom(dimensions: ParsedTokenDimensions): number | undefined {
  return resolvedProcessedTotal(dimensions);
}

export function buildTokenUsageSnapshot(
  state: ThreadTokenUsageState,
  reporting: TokenUsageReporting = "exact",
): ThreadTokenUsageSnapshot | undefined {
  if (reporting === "not-reported") {
    return {
      usedTokens: 0,
      reporting: "not-reported",
    };
  }

  const occupancy = state.occupancy;
  const cumulative = state.cumulative;
  const lastTurn = state.lastTurn;

  const totalProcessedTokens = cumulative ? resolvedProcessedTotal(cumulative) : undefined;
  const lastUsedTokens = lastTurn ? lastUsedTokensFrom(lastTurn) : undefined;
  const usedTokens = occupancy?.usedTokens;
  const hasProcessed = totalProcessedTokens !== undefined && totalProcessedTokens > 0;
  const hasOccupancy =
    usedTokens !== undefined &&
    (usedTokens > 0 || occupancy?.maxTokens !== undefined || occupancy?.usedPercent !== undefined);

  if (!hasProcessed && !hasOccupancy) {
    return undefined;
  }

  const snapshotUsedTokens = occupancy?.usedTokens ?? 0;
  const lastInputTokens = lastTurn?.inputTokens;
  const lastCachedInputTokens = lastTurn?.cachedInputTokens;
  const lastOutputTokens = lastTurn?.outputTokens;
  const lastReasoningOutputTokens = lastTurn?.reasoningOutputTokens;

  return {
    usedTokens: snapshotUsedTokens,
    ...(occupancy?.usedPercent !== undefined ? { usedPercent: occupancy.usedPercent } : {}),
    ...(occupancy?.maxTokens !== undefined ? { maxTokens: occupancy.maxTokens } : {}),
    ...(occupancy?.compactsAutomatically ? { compactsAutomatically: true } : {}),
    ...(hasProcessed ? { totalProcessedTokens } : {}),
    ...(cumulative?.inputTokens !== undefined ? { inputTokens: cumulative.inputTokens } : {}),
    ...(cumulative?.cachedInputTokens !== undefined
      ? { cachedInputTokens: cumulative.cachedInputTokens }
      : {}),
    ...(cumulative?.outputTokens !== undefined ? { outputTokens: cumulative.outputTokens } : {}),
    ...(cumulative?.reasoningOutputTokens !== undefined
      ? { reasoningOutputTokens: cumulative.reasoningOutputTokens }
      : {}),
    ...(lastUsedTokens !== undefined ? { lastUsedTokens } : {}),
    ...(lastInputTokens !== undefined ? { lastInputTokens } : {}),
    ...(lastCachedInputTokens !== undefined ? { lastCachedInputTokens } : {}),
    ...(lastOutputTokens !== undefined ? { lastOutputTokens } : {}),
    ...(lastReasoningOutputTokens !== undefined ? { lastReasoningOutputTokens } : {}),
    reporting,
  };
}

export function notReportedTokenUsageSnapshot(): ThreadTokenUsageSnapshot {
  return {
    usedTokens: 0,
    reporting: "not-reported",
  };
}

export function estimatedTokenUsageSnapshot(
  state: ThreadTokenUsageState,
): ThreadTokenUsageSnapshot | undefined {
  return buildTokenUsageSnapshot(state, "estimated");
}

export function snapshotsMeaningfullyEqual(
  left: ThreadTokenUsageSnapshot | undefined,
  right: ThreadTokenUsageSnapshot | undefined,
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return (
    left.usedTokens === right.usedTokens &&
    left.usedPercent === right.usedPercent &&
    left.totalProcessedTokens === right.totalProcessedTokens &&
    left.maxTokens === right.maxTokens &&
    left.inputTokens === right.inputTokens &&
    left.cachedInputTokens === right.cachedInputTokens &&
    left.outputTokens === right.outputTokens &&
    left.reasoningOutputTokens === right.reasoningOutputTokens &&
    left.lastUsedTokens === right.lastUsedTokens &&
    left.lastInputTokens === right.lastInputTokens &&
    left.lastCachedInputTokens === right.lastCachedInputTokens &&
    left.lastOutputTokens === right.lastOutputTokens &&
    left.lastReasoningOutputTokens === right.lastReasoningOutputTokens &&
    left.reporting === right.reporting
  );
}

export function resumeTokenUsageState(
  snapshot: ThreadTokenUsageSnapshot | undefined,
): ThreadTokenUsageState {
  if (!snapshot || snapshot.reporting === "not-reported") {
    return {};
  }
  const cumulative: ParsedTokenDimensions = {
    ...(snapshot.inputTokens !== undefined ? { inputTokens: snapshot.inputTokens } : {}),
    ...(snapshot.cachedInputTokens !== undefined
      ? { cachedInputTokens: snapshot.cachedInputTokens }
      : {}),
    ...(snapshot.outputTokens !== undefined ? { outputTokens: snapshot.outputTokens } : {}),
    ...(snapshot.reasoningOutputTokens !== undefined
      ? { reasoningOutputTokens: snapshot.reasoningOutputTokens }
      : {}),
    ...(snapshot.totalProcessedTokens !== undefined
      ? { totalTokens: snapshot.totalProcessedTokens }
      : {}),
  };
  const occupancy: ContextOccupancy | undefined =
    snapshot.maxTokens !== undefined ||
    snapshot.usedPercent !== undefined ||
    snapshot.usedTokens > 0
      ? {
          usedTokens: snapshot.usedTokens,
          ...(snapshot.maxTokens !== undefined ? { maxTokens: snapshot.maxTokens } : {}),
          ...(snapshot.usedPercent !== undefined ? { usedPercent: snapshot.usedPercent } : {}),
          ...(snapshot.compactsAutomatically ? { compactsAutomatically: true } : {}),
        }
      : undefined;
  const hasCumulative = Object.keys(cumulative).length > 0;
  return {
    ...(hasCumulative ? { cumulative, lastRaw: cumulative, scale: "cumulative" as const } : {}),
    ...(occupancy ? { occupancy } : {}),
  };
}

export function applyOccupancy(
  state: ThreadTokenUsageState,
  occupancy: ContextOccupancy,
): ThreadTokenUsageState {
  return {
    ...state,
    occupancy,
  };
}
