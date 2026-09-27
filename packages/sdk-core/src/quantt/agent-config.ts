/**
 * Editing an agent's configuration — PATCH /v1/agents/{id}.
 *
 * The update schema is documented (QUANTTS API 0.4.0, additionalProperties:
 * false) and so is the Agent record GET /v1/agents/{id} returns. This module
 * enforces that schema client-side, so a Settings screen can explain a bad
 * value before anything reaches production (there is no Quantt sandbox), and
 * builds a minimal PATCH body holding only the fields the user changed.
 */
import type {
  QuanttChain, QuanttDexPreference, QuanttQuoteAsset, QuanttStrategy, QuanttTimeframe, UpdateAgentInput,
} from './client';

export const QUANTT_STRATEGIES: readonly QuanttStrategy[] = [
  'buy_hold', 'macd', 'kdj_rsi', 'zmr', 'sma', 'custom', 'momentum', 'mean_reversion', 'arbitrage',
  'trend_following', 'hedging', 'fundamental', 'technical',
];
export const QUANTT_CHAINS: readonly QuanttChain[] = ['arbitrum', 'base', 'lithosphere', 'bnb'];
export const QUANTT_DEX_PREFERENCES: readonly QuanttDexPreference[] = ['kamet', 'magma'];
export const QUANTT_QUOTE_ASSETS: readonly QuanttQuoteAsset[] = ['USDC', 'USDT', 'LAX'];
export const QUANTT_TIMEFRAMES: readonly QuanttTimeframe[] = ['5m', '15m', '1h', '4h', '1d'];

/** The editable fields of an agent, as GET /v1/agents/{id} documents them. */
export interface QuanttAgentConfig {
  name: string;
  strategy: QuanttStrategy;
  strategyPrompt: string | null;
  chains: QuanttChain[];
  tokens: string[];
  dexPreference: QuanttDexPreference;
  capitalUsd: number;
  maxPositionPct: number;
  stopLoss: number;
  takeProfit: number;
  maxDailyLoss: number;
  autopilot: boolean;
  timeframe: QuanttTimeframe;
  quoteAsset: QuanttQuoteAsset;
}

const FIELDS = [
  'name', 'strategy', 'strategyPrompt', 'chains', 'tokens', 'dexPreference', 'capitalUsd', 'maxPositionPct',
  'stopLoss', 'takeProfit', 'maxDailyLoss', 'autopilot', 'timeframe', 'quoteAsset',
] as const satisfies ReadonlyArray<keyof QuanttAgentConfig>;

function oneOf<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === 'string' && (list as readonly string[]).includes(v);
}
function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** The editable config out of an agent record (GET /v1/agents/{id}), or null
 *  when the record lacks the documented fields — a Settings screen should then
 *  stay hidden rather than let the user "edit" guessed defaults. The record may
 *  sit under an `agent` key. */
export function toAgentConfig(raw: unknown): QuanttAgentConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const top = raw as Record<string, unknown>;
  const o = (top.agent && typeof top.agent === 'object') ? (top.agent as Record<string, unknown>) : top;
  const chains = Array.isArray(o.chains) ? o.chains : null;
  const tokens = Array.isArray(o.tokens) ? o.tokens : null;
  if (typeof o.name !== 'string' || !oneOf(QUANTT_STRATEGIES, o.strategy)
      || !chains || !chains.every((c) => oneOf(QUANTT_CHAINS, c))
      || !tokens || !tokens.every((t) => typeof t === 'string')
      || !oneOf(QUANTT_DEX_PREFERENCES, o.dexPreference) || !finite(o.capitalUsd)
      || !finite(o.maxPositionPct) || !finite(o.stopLoss) || !finite(o.takeProfit) || !finite(o.maxDailyLoss)
      || typeof o.autopilot !== 'boolean' || !oneOf(QUANTT_TIMEFRAMES, o.timeframe)
      || !oneOf(QUANTT_QUOTE_ASSETS, o.quoteAsset)) {
    return null;
  }
  return {
    name: o.name,
    strategy: o.strategy,
    strategyPrompt: typeof o.strategyPrompt === 'string' ? o.strategyPrompt : null,
    chains: chains as QuanttChain[],
    tokens: tokens as string[],
    dexPreference: o.dexPreference,
    capitalUsd: o.capitalUsd,
    maxPositionPct: o.maxPositionPct,
    stopLoss: o.stopLoss,
    takeProfit: o.takeProfit,
    maxDailyLoss: o.maxDailyLoss,
    autopilot: o.autopilot,
    timeframe: o.timeframe,
    quoteAsset: o.quoteAsset,
  };
}

/** Human-readable problems with an update body, checked against the PATCH
 *  schema. Empty array = valid. Unknown keys are reported (the server rejects
 *  them: additionalProperties is false). */
export function validateAgentUpdate(u: UpdateAgentInput): string[] {
  const errs: string[] = [];
  const known = new Set<string>(FIELDS);
  for (const k of Object.keys(u)) if (!known.has(k)) errs.push(`Unknown setting "${k}".`);
  const range = (label: string, v: unknown, min: number, max: number, exclusiveMin = false) => {
    if (v === undefined) return;
    if (!finite(v) || (exclusiveMin ? v <= min : v < min) || v > max) {
      errs.push(`${label} must be ${exclusiveMin ? 'above' : 'at least'} ${min} and at most ${max}.`);
    }
  };
  if (u.name !== undefined && (typeof u.name !== 'string' || u.name.trim().length < 2 || u.name.trim().length > 64)) {
    errs.push('Name must be 2–64 characters.');
  }
  if (u.strategy !== undefined && !oneOf(QUANTT_STRATEGIES, u.strategy)) errs.push('Unknown strategy.');
  if (u.strategyPrompt !== undefined && u.strategyPrompt !== null
      && (typeof u.strategyPrompt !== 'string' || u.strategyPrompt.length < 1 || u.strategyPrompt.length > 2000)) {
    errs.push('Strategy guidance must be 1–2000 characters (or cleared).');
  }
  if (u.chains !== undefined && (!Array.isArray(u.chains) || u.chains.length < 1 || !u.chains.every((c) => oneOf(QUANTT_CHAINS, c)))) {
    errs.push('Pick at least one supported chain.');
  }
  if (u.tokens !== undefined && (!Array.isArray(u.tokens) || u.tokens.length < 1
      || !u.tokens.every((t) => typeof t === 'string' && t.trim().length > 0))) {
    errs.push('Pick at least one token.');
  }
  if (u.dexPreference !== undefined && !oneOf(QUANTT_DEX_PREFERENCES, u.dexPreference)) errs.push('Unknown DEX preference.');
  if (u.capitalUsd !== undefined && (!finite(u.capitalUsd) || u.capitalUsd <= 0.000001)) errs.push('Capital must be greater than $0.');
  range('Max position %', u.maxPositionPct, 0, 100, true);
  range('Stop loss %', u.stopLoss, 0, 100);
  range('Take profit %', u.takeProfit, 0, 500);
  range('Max daily loss %', u.maxDailyLoss, 0, 100);
  if (u.autopilot !== undefined && typeof u.autopilot !== 'boolean') errs.push('Autopilot must be on or off.');
  if (u.timeframe !== undefined && !oneOf(QUANTT_TIMEFRAMES, u.timeframe)) errs.push('Unknown timeframe.');
  if (u.quoteAsset !== undefined && !oneOf(QUANTT_QUOTE_ASSETS, u.quoteAsset)) errs.push('Unknown quote asset.');
  return errs;
}

/** PATCH body with only the fields where `edited` differs from `current`
 *  (arrays compared by value; names trimmed). Empty object = nothing changed. */
export function diffAgentConfig(current: QuanttAgentConfig, edited: QuanttAgentConfig): UpdateAgentInput {
  const out: Record<string, unknown> = {};
  for (const k of FIELDS) {
    const a = current[k];
    let b = edited[k];
    if (k === 'name' && typeof b === 'string') b = b.trim();
    const same = Array.isArray(a) && Array.isArray(b)
      ? a.length === b.length && a.every((x, i) => x === b[i])
      : a === b;
    if (!same) out[k] = b;
  }
  return out as UpdateAgentInput;
}
