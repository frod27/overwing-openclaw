/**
 * Plugin configuration: what the operator set in openclaw.json under
 * plugins.entries.overwing.config, with environment fallbacks and defaults.
 * Pure: no runtime imports, so the tests load it directly.
 */

export type Mode = "shadow" | "enforce";
export type OnReview = "allow" | "hold";

export type Config = {
  mode: Mode;
  apiKey: string | null;
  walletKey: string | null;
  onReview: OnReview;
  fallbackText: string;
  ruleSet: string;
  tools: string[];
  maxPerCallUsd: number;
  dailyCapUsd: number;
  timeoutMs: number;
  baseUrl: string;
};

export const DEFAULT_FALLBACK = "[This message was held back by the Overwing gate. A person will follow up.]";

export const DEFAULTS: Config = {
  mode: "shadow",
  apiKey: null,
  walletKey: null,
  onReview: "hold",
  fallbackText: DEFAULT_FALLBACK,
  ruleSet: "outbound-message",
  tools: ["message"],
  maxPerCallUsd: 0.01,
  dailyCapUsd: 0.5,
  timeoutMs: 2500,
  baseUrl: "https://overwing.ai",
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const num = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback);

export function resolveConfig(raw: Record<string, unknown> | undefined, env: Record<string, string | undefined> = {}): Config {
  const r = raw ?? {};
  const mode = r.mode === "enforce" ? "enforce" : "shadow";
  const onReview = r.onReview === "allow" ? "allow" : "hold";
  const tools = Array.isArray(r.tools) ? r.tools.filter((t): t is string => typeof t === "string" && t.trim() !== "").map((t) => t.trim()) : DEFAULTS.tools;
  const walletRaw = str(r.walletKey) ?? str(env.OVERWING_WALLET_KEY);
  return {
    mode,
    apiKey: str(r.apiKey) ?? str(env.OVERWING_API_KEY),
    walletKey: walletRaw !== null && isEvmKey(walletRaw) ? walletRaw : null,
    onReview,
    fallbackText: str(r.fallbackText) ?? DEFAULT_FALLBACK,
    ruleSet: str(r.ruleSet) ?? DEFAULTS.ruleSet,
    tools: tools.length > 0 ? tools : DEFAULTS.tools,
    maxPerCallUsd: num(r.maxPerCallUsd, DEFAULTS.maxPerCallUsd),
    dailyCapUsd: num(r.dailyCapUsd, DEFAULTS.dailyCapUsd),
    timeoutMs: Math.max(250, num(r.timeoutMs, DEFAULTS.timeoutMs)),
    baseUrl: (str(r.baseUrl) ?? DEFAULTS.baseUrl).replace(/\/+$/, ""),
  };
}

export function isEvmKey(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}
