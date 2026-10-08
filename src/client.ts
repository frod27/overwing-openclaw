/**
 * One check against the Overwing API over the key or free rail.
 * The wallet rail lives in payment.ts because it drags in the x402 stack.
 */
import type { Evaluation } from "./decision.ts";

export type CheckOk = { ok: true; evaluation: Evaluation; status: number };
export type CheckSkipped = { ok: false; reason: string; status?: number };
export type CheckResult = CheckOk | CheckSkipped;

export type Context = { recipient?: string | null; channel?: string | null; owns_contact_info?: boolean };

/** 2,000 is the keyless limit; a key allows 100,000. Longer text is cut, not refused: the start of a message is still worth checking. */
export const FREE_MAX_CHARS = 2000;
export const KEYED_MAX_CHARS = 100_000;

export function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

export function body(input: string, ruleSet: string, context: Context, keyed: boolean): string {
  const ctx: Record<string, unknown> = { owns_contact_info: context.owns_contact_info ?? false };
  if (context.recipient) ctx.recipient = String(context.recipient).slice(0, 200);
  if (context.channel) ctx.channel = String(context.channel).slice(0, 60);
  return JSON.stringify({ input: clip(input, keyed ? KEYED_MAX_CHARS : FREE_MAX_CHARS), rule_set: ruleSet, context: ctx, ...(keyed ? {} : { store: false }) });
}

export async function evaluateWithKeyOrFree(opts: {
  baseUrl: string;
  apiKey: string | null;
  ruleSet: string;
  input: string;
  context: Context;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<CheckResult> {
  const f = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  const onOuter = (): void => controller.abort();
  opts.signal?.addEventListener("abort", onOuter, { once: true });
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json", "User-Agent": "overwing-openclaw/0.1" };
    if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;
    const res = await f(`${opts.baseUrl}/api/v1/evaluate`, { method: "POST", headers, body: body(opts.input, opts.ruleSet, opts.context, opts.apiKey !== null), signal: controller.signal });
    if (res.status === 429) return { ok: false, reason: opts.apiKey ? "daily plan limit reached" : "free allowance used up for today (10 checks)", status: 429 };
    if (!res.ok) return { ok: false, reason: `API answered ${res.status}`, status: res.status };
    const json = (await res.json()) as Evaluation;
    if (!json || typeof json.verdict !== "string") return { ok: false, reason: "unexpected response shape", status: res.status };
    return { ok: true, evaluation: json, status: res.status };
  } catch (err: unknown) {
    const aborted = controller.signal.aborted;
    return { ok: false, reason: aborted ? `timed out after ${opts.timeoutMs} ms` : `request failed: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onOuter);
  }
}
