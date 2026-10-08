/**
 * Spend control for the wallet rail, in ClawRouter's shape: a cap per call and
 * a cap per UTC day. Persisted as one small JSON file so a restart does not
 * reset the day. Pure arithmetic here; the file is read and written by the caller.
 */

export type SpendState = { day: string; spentUsd: number };

export const dayOf = (now: number): string => new Date(now).toISOString().slice(0, 10);

export function freshState(now: number): SpendState {
  return { day: dayOf(now), spentUsd: 0 };
}

/** The state for today: yesterday's total is dropped. */
export function forToday(state: SpendState | null, now: number): SpendState {
  return state && state.day === dayOf(now) ? state : freshState(now);
}

export type SpendCheck = { ok: true } | { ok: false; reason: string };

export function allows(state: SpendState, priceUsd: number, caps: { maxPerCallUsd: number; dailyCapUsd: number }): SpendCheck {
  if (!(priceUsd >= 0) || !Number.isFinite(priceUsd)) return { ok: false, reason: "price not a number" };
  if (priceUsd > caps.maxPerCallUsd) return { ok: false, reason: `price $${priceUsd} is above maxPerCallUsd $${caps.maxPerCallUsd}` };
  if (state.spentUsd + priceUsd > caps.dailyCapUsd) return { ok: false, reason: `daily cap $${caps.dailyCapUsd} reached ($${round(state.spentUsd)} spent today)` };
  return { ok: true };
}

export function record(state: SpendState, priceUsd: number): SpendState {
  return { day: state.day, spentUsd: round(state.spentUsd + priceUsd) };
}

/** USDC amounts arrive as atomic units with 6 decimals. */
export function usdFromAtomic(amount: string | number, decimals = 6): number {
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n)) return Number.NaN;
  return n / 10 ** decimals;
}

export const round = (n: number): number => Math.round(n * 1e6) / 1e6;
