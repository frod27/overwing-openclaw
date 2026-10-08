/**
 * The gate itself: pick a rail, run the check, decide, log. Everything the
 * three hooks share. Takes its I/O (fetch, files, clock) as arguments so the
 * tests can run it without a network or a home directory.
 */
import type { Config } from "./config.ts";
import { evaluateWithKeyOrFree, type CheckResult, type Context } from "./client.ts";
import { actionOf, firedRules, type Action, type Evaluation } from "./decision.ts";
import type { Hook, Rail, StatLine } from "./stats.ts";
import type { SpendStore } from "./payment.ts";

export type Checked = {
  action: Action | "skipped";
  evaluation: Evaluation | null;
  rail: Rail | null;
  rules: string;
  reason?: string;
  costUsd: number;
  ms: number;
};

export type GateIo = {
  fetchImpl?: typeof fetch;
  spendStore: SpendStore;
  now?: () => number;
  /** Wallet key found on disk (ClawRouter's), used when the config has none. */
  diskWalletKey?: () => string | null;
  walletEvaluate?: typeof import("./payment.ts").evaluateWithWallet;
};

/** Which rail this install pays with, for status lines. */
export function railOf(cfg: Config, io: GateIo): Rail {
  if (cfg.apiKey) return "key";
  if (cfg.walletKey ?? io.diskWalletKey?.()) return "wallet";
  return "free";
}

export async function check(cfg: Config, io: GateIo, input: string, context: Context, signal?: AbortSignal): Promise<Checked> {
  const started = (io.now ?? Date.now)();
  const done = (r: CheckResult & { costUsd?: number }, rail: Rail): Checked => {
    const ms = (io.now ?? Date.now)() - started;
    if (!r.ok) return { action: "skipped", evaluation: null, rail, rules: "", reason: r.reason, costUsd: 0, ms };
    return { action: actionOf(r.evaluation), evaluation: r.evaluation, rail, rules: firedRules(r.evaluation), costUsd: r.costUsd ?? 0, ms };
  };
  if (input.trim() === "") return { action: "allow", evaluation: null, rail: null, rules: "empty message", costUsd: 0, ms: 0 };

  if (cfg.apiKey) {
    return done(await evaluateWithKeyOrFree({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, ruleSet: cfg.ruleSet, input, context, timeoutMs: cfg.timeoutMs, fetchImpl: io.fetchImpl, signal }), "key");
  }
  const walletKey = cfg.walletKey ?? io.diskWalletKey?.() ?? null;
  if (walletKey) {
    const evaluateWithWallet = io.walletEvaluate ?? (await import("./payment.ts")).evaluateWithWallet;
    const paid = await evaluateWithWallet({ baseUrl: cfg.baseUrl, walletKey, ruleSet: cfg.ruleSet, input, context, timeoutMs: cfg.timeoutMs, caps: { maxPerCallUsd: cfg.maxPerCallUsd, dailyCapUsd: cfg.dailyCapUsd }, store: io.spendStore, now: io.now });
    if (paid.ok) return done(paid, "wallet");
    // Over the cap or unpaid: the free allowance is still there.
    const free = await evaluateWithKeyOrFree({ baseUrl: cfg.baseUrl, apiKey: null, ruleSet: cfg.ruleSet, input, context, timeoutMs: cfg.timeoutMs, fetchImpl: io.fetchImpl, signal });
    const out = done(free, "free");
    if (out.action === "skipped") out.reason = `${paid.reason}; then ${out.reason}`;
    return out;
  }
  return done(await evaluateWithKeyOrFree({ baseUrl: cfg.baseUrl, apiKey: null, ruleSet: cfg.ruleSet, input, context, timeoutMs: cfg.timeoutMs, fetchImpl: io.fetchImpl, signal }), "free");
}

export function statLine(hook: Hook, cfg: Config, c: Checked, did: string, channel: string | undefined, now: number): StatLine {
  return { at: new Date(now).toISOString(), hook, mode: cfg.mode, rail: c.rail, action: c.action, rules: c.rules, did, costUsd: c.costUsd, ms: c.ms, ...(channel ? { channel } : {}), ...(c.reason ? { reason: c.reason } : {}) };
}
