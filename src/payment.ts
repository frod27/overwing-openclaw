/**
 * The wallet rail: pay $0.002 in USDC on Base per check over x402, with the
 * spend caps enforced before any signature is made. The x402 stack and viem
 * are loaded on first use so a key-only or free-only install never pays for
 * them at startup.
 */
import type { Evaluation } from "./decision.ts";
import type { CheckResult, Context } from "./client.ts";
import { body } from "./client.ts";
import { allows, forToday, record, usdFromAtomic, type SpendState } from "./spend.ts";

type Requirements = { amount?: string | number; maxAmountRequired?: string | number; asset?: string; network?: string; payTo?: string; extra?: { decimals?: number } };

export type SpendStore = { load(): SpendState | null; save(state: SpendState): void };

type PayFetch = (url: string, init: RequestInit) => Promise<Response>;

let cached: { key: string; payFetch: PayFetch } | null = null;

/** What the hook needs to know about the request in flight; one payment at a time per process. */
let inFlight: { url: string; preflight: PreflightSettings | null } = { url: "", preflight: null };

export type PreflightSettings = {
  mode: "shadow" | "enforce";
  baseUrl: string;
  apiKey: string | null;
  onReview: "allow" | "hold";
  maxPerCallUsd: number;
  timeoutMs: number;
  /** Receives the decision for the stats log. */
  onDecision: (d: { decision: string; codes: string[]; amountUsd: number | null; payTo: string | null; ms: number; skipped?: string }) => void;
};

/** Ask Overwing whether this payment's terms and payee look like what they claim. Fails open: a check that cannot be made never blocks a payment. */
export async function preflightPayment(paymentRequired: unknown, selected: unknown, url: string, s: PreflightSettings): Promise<{ decision: "allow" | "review" | "refuse"; codes: string[]; amountUsd: number | null; payTo: string | null } | { skipped: string }> {
  const req = selected as Requirements & { payTo?: string };
  const terms = typeof paymentRequired === "object" && paymentRequired !== null ? paymentRequired : { x402Version: 2, resource: { url }, accepts: [req] };
  const headers: Record<string, string> = { "Content-Type": "application/json", "User-Agent": "overwing-openclaw/0.2" };
  if (s.apiKey) headers.Authorization = `Bearer ${s.apiKey}`;
  try {
    const res = await fetch(`${s.baseUrl}/api/v1/preflight/x402`, { method: "POST", headers, body: JSON.stringify({ payment_required: terms, requested_url: url, network: req.network, policy: { max_per_call_usd: s.maxPerCallUsd } }), signal: AbortSignal.timeout(s.timeoutMs) });
    if (!res.ok) return { skipped: `preflight answered ${res.status}` };
    const b = (await res.json()) as { decision?: string; reasons?: { code?: string }[]; terms?: { amount_usd?: number | null; pay_to?: string } };
    const decision = b.decision === "allow" || b.decision === "review" || b.decision === "refuse" ? b.decision : null;
    if (!decision) return { skipped: "preflight gave no decision" };
    return { decision, codes: (b.reasons ?? []).map((r) => String(r.code)), amountUsd: b.terms?.amount_usd ?? null, payTo: b.terms?.pay_to ?? null };
  } catch (err: unknown) {
    return { skipped: `preflight unreachable: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function payFetchFor(walletKey: string, caps: { maxPerCallUsd: number; dailyCapUsd: number }, store: SpendStore, now: () => number): Promise<PayFetch> {
  if (cached && cached.key === walletKey) return cached.payFetch;
  const [{ wrapFetchWithPayment, x402Client }, { registerExactEvmScheme }, { toClientEvmSigner }, { createPublicClient, http }, { base }, { privateKeyToAccount }] = await Promise.all([
    import("@x402/fetch"),
    import("@x402/evm/exact/client"),
    import("@x402/evm"),
    import("viem"),
    import("viem/chains"),
    import("viem/accounts"),
  ]);
  const account = privateKeyToAccount(walletKey as `0x${string}`);
  const publicClient = createPublicClient({ chain: base, transport: http() });
  const client = new x402Client();
  // ClawRouter's pattern: the caps are checked in the client's own hook, so no scheme can pay around them.
  const pending = new WeakMap<object, number>();
  client.onBeforePaymentCreation(async (ctx: { selectedRequirements: unknown; paymentRequired?: unknown }) => {
    const req = ctx.selectedRequirements as Requirements;
    // Preflight for x402: the terms and the payee, before the spend caps and before any signature.
    const pf = inFlight.preflight;
    if (pf) {
      const started = Date.now();
      const r = await preflightPayment(ctx.paymentRequired ?? null, ctx.selectedRequirements, inFlight.url, pf);
      if ("skipped" in r) pf.onDecision({ decision: "skipped", codes: [], amountUsd: null, payTo: null, ms: Date.now() - started, skipped: r.skipped });
      else {
        pf.onDecision({ ...r, ms: Date.now() - started });
        if (pf.mode === "enforce" && (r.decision === "refuse" || (r.decision === "review" && pf.onReview === "hold"))) throw new Error(`preflight: ${r.decision} (${r.codes.join(", ")})`);
      }
    }
    const price = usdFromAtomic(req.amount ?? req.maxAmountRequired ?? Number.NaN, req.extra?.decimals ?? 6);
    const state = forToday(store.load(), now());
    const check = allows(state, price, caps);
    if (!check.ok) throw new Error(`spend policy: ${check.reason}`);
    pending.set(ctx.selectedRequirements as object, price);
  });
  client.onAfterPaymentCreation(async (ctx: { selectedRequirements: unknown }) => {
    const price = pending.get(ctx.selectedRequirements as object);
    if (price !== undefined) {
      pending.delete(ctx.selectedRequirements as object);
      store.save(record(forToday(store.load(), now()), price));
    }
  });
  registerExactEvmScheme(client, { signer: toClientEvmSigner(account, publicClient) });
  const payFetch = wrapFetchWithPayment(fetch, client) as PayFetch;
  cached = { key: walletKey, payFetch };
  return payFetch;
}

export async function evaluateWithWallet(opts: {
  baseUrl: string;
  walletKey: string;
  ruleSet: string;
  input: string;
  context: Context;
  timeoutMs: number;
  caps: { maxPerCallUsd: number; dailyCapUsd: number };
  store: SpendStore;
  now?: () => number;
  preflight?: PreflightSettings | null;
}): Promise<CheckResult & { costUsd?: number }> {
  const now = opts.now ?? Date.now;
  inFlight = { url: `${opts.baseUrl}/api/x402/evaluate`, preflight: opts.preflight ?? null };
  const before = forToday(opts.store.load(), now()).spentUsd;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const payFetch = await payFetchFor(opts.walletKey, opts.caps, opts.store, now);
    const res = await payFetch(`${opts.baseUrl}/api/x402/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "overwing-openclaw/0.1" },
      body: body(opts.input, opts.ruleSet, opts.context, true),
      signal: controller.signal,
    });
    if (res.status === 402) return { ok: false, reason: "payment not accepted (402 after paying)", status: 402 };
    if (!res.ok) return { ok: false, reason: `API answered ${res.status}`, status: res.status };
    const json = (await res.json()) as Evaluation;
    if (!json || typeof json.verdict !== "string") return { ok: false, reason: "unexpected response shape", status: res.status };
    const after = forToday(opts.store.load(), now()).spentUsd;
    return { ok: true, evaluation: json, status: res.status, costUsd: Math.max(0, Math.round((after - before) * 1e6) / 1e6) };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: controller.signal.aborted ? `timed out after ${opts.timeoutMs} ms` : msg.includes("spend policy") || msg.includes("preflight:") ? msg : `wallet payment failed: ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}
