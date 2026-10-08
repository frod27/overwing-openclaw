/**
 * From an Overwing evaluation to what each OpenClaw hook should return.
 * Pure: the hooks in index.ts are thin wrappers around these.
 */
import type { Config } from "./config.ts";

export type Action = "allow" | "redact" | "review" | "block";
export type Verdict = "pass" | "fail" | "review";

export type RuleResult = { rule: string; verdict?: Verdict; action?: Action; answer?: unknown; confidence?: number };
export type Evaluation = {
  verdict: Verdict;
  recommended_action?: Action;
  confidence?: number;
  latency_ms?: number;
  results?: RuleResult[];
};

const ACTIONS: readonly Action[] = ["allow", "redact", "review", "block"];

/** The one action to take. Older responses without `recommended_action` fall back to the verdict. */
export function actionOf(ev: Evaluation): Action {
  if (ev.recommended_action && ACTIONS.includes(ev.recommended_action)) return ev.recommended_action;
  if (ev.verdict === "fail") return "block";
  if (ev.verdict === "review") return "review";
  return "allow";
}

/** The rules that fired, for logs and reasons: "unauthorized_pii (redact), toxicity (block)". */
export function firedRules(ev: Evaluation): string {
  const fired = (ev.results ?? []).filter((r) => r.verdict === "fail" || r.verdict === "review");
  if (fired.length === 0) return ev.verdict === "pass" ? "no rule fired" : "unspecified";
  return fired.map((r) => `${r.rule}${r.action ? ` (${r.action})` : ""}`).join(", ");
}

export type MessageOutcome = { kind: "pass" } | { kind: "replace"; text: string } | { kind: "cancel"; reason: string };

/** What happens to an outbound message or reply in enforce mode. Shadow mode never calls this. */
export function messageOutcome(action: Action, cfg: Pick<Config, "onReview" | "fallbackText">, rules: string): MessageOutcome {
  switch (action) {
    case "allow":
      return { kind: "pass" };
    case "redact":
    case "block":
      return { kind: "replace", text: cfg.fallbackText };
    case "review":
      return cfg.onReview === "allow" ? { kind: "pass" } : { kind: "cancel", reason: `Overwing gate: held for review (${rules})` };
  }
}

export type ToolOutcome =
  | { kind: "pass" }
  | { kind: "block"; reason: string }
  | { kind: "approve"; title: string; description: string; severity: "info" | "warning" | "critical" };

/** What happens to a send-tool call in enforce mode. A review verdict becomes OpenClaw's own approval prompt. */
export function toolOutcome(action: Action, cfg: Pick<Config, "onReview">, rules: string): ToolOutcome {
  switch (action) {
    case "allow":
      return { kind: "pass" };
    case "block":
      return { kind: "block", reason: `Overwing gate blocked this send: ${rules}.` };
    case "redact":
      return { kind: "block", reason: `Overwing gate: the message carries personal data this recipient should not get (${rules}). Remove it and send again.` };
    case "review":
      return cfg.onReview === "allow"
        ? { kind: "pass" }
        : { kind: "approve", title: "Overwing gate: review before sending", description: `The gate asked for a person to look at this message first: ${rules}.`, severity: "warning" };
  }
}

const TEXT_KEYS = ["message", "text", "content", "body"] as const;
const RECIPIENT_KEYS = ["to", "target", "recipient", "channel"] as const;

/** The text a send-tool call would send: the first non-empty string under a conventional key. */
export function textParam(params: Record<string, unknown>): { key: string; text: string } | null {
  for (const key of TEXT_KEYS) {
    const v = params[key];
    if (typeof v === "string" && v.trim() !== "") return { key, text: v };
  }
  return null;
}

export function recipientParam(params: Record<string, unknown>): string | null {
  for (const key of RECIPIENT_KEYS) {
    const v = params[key];
    if (typeof v === "string" && v.trim() !== "") return v;
  }
  return null;
}

/** Only sends are checked: a `message` tool call that reads, lists or deletes carries nothing to evaluate. */
export function isSendAction(params: Record<string, unknown>): boolean {
  const action = params.action;
  if (typeof action !== "string") return true;
  return /^(send|reply|post|create|edit|update|forward|broadcast)$/i.test(action);
}
