/**
 * One JSONL line per check, one file per UTC day, no message text.
 * Pure formatting and parsing; the file system lives in index.ts.
 */

export type Rail = "key" | "wallet" | "free";
export type Hook = "message" | "reply" | "tool";

export type StatLine = {
  at: string;
  hook: Hook;
  mode: "shadow" | "enforce";
  rail: Rail | null;
  /** allow, redact, review, block, or skipped when no verdict was obtained. */
  action: string;
  rules: string;
  /** What the plugin did: pass, replace, cancel, block, approve, or log (shadow). */
  did: string;
  costUsd: number;
  ms: number;
  channel?: string;
  reason?: string;
};

export function parseLines(text: string): StatLine[] {
  const out: StatLine[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const v = JSON.parse(t) as StatLine;
      if (v && typeof v.at === "string" && typeof v.action === "string") out.push(v);
    } catch {
      // a torn line from a crash mid-write: skip it
    }
  }
  return out;
}

export type Summary = {
  checks: number;
  byAction: Record<string, number>;
  byDid: Record<string, number>;
  byRail: Record<string, number>;
  costUsd: number;
  avgMs: number;
  topRules: Array<[string, number]>;
};

export function summarize(lines: StatLine[]): Summary {
  const byAction: Record<string, number> = {};
  const byDid: Record<string, number> = {};
  const byRail: Record<string, number> = {};
  const rules: Record<string, number> = {};
  let cost = 0;
  let ms = 0;
  for (const l of lines) {
    byAction[l.action] = (byAction[l.action] ?? 0) + 1;
    byDid[l.did] = (byDid[l.did] ?? 0) + 1;
    byRail[l.rail ?? "none"] = (byRail[l.rail ?? "none"] ?? 0) + 1;
    cost += Number.isFinite(l.costUsd) ? l.costUsd : 0;
    ms += Number.isFinite(l.ms) ? l.ms : 0;
    if (l.action !== "allow" && l.action !== "skipped") {
      for (const part of l.rules.split(",")) {
        const name = part.trim().replace(/\s*\(.*\)$/, "");
        if (name && name !== "unspecified" && name !== "no rule fired") rules[name] = (rules[name] ?? 0) + 1;
      }
    }
  }
  return {
    checks: lines.length,
    byAction,
    byDid,
    byRail,
    costUsd: Math.round(cost * 1e6) / 1e6,
    avgMs: lines.length ? Math.round(ms / lines.length) : 0,
    topRules: Object.entries(rules).sort((a, b) => b[1] - a[1]).slice(0, 5),
  };
}

export function formatSummary(s: Summary, days: number, mode: string, rail: string): string {
  const n = (k: string, m: Record<string, number>): number => m[k] ?? 0;
  const lines = [
    `Overwing gate, last ${days} day${days === 1 ? "" : "s"}  ·  mode ${mode}  ·  rail ${rail}`,
    `checks ${s.checks}  ·  allow ${n("allow", s.byAction)}  ·  redact ${n("redact", s.byAction)}  ·  review ${n("review", s.byAction)}  ·  block ${n("block", s.byAction)}  ·  skipped ${n("skipped", s.byAction)}`,
    `did: ${Object.entries(s.byDid).map(([k, v]) => `${k} ${v}`).join("  ·  ") || "nothing yet"}`,
    `spend $${s.costUsd.toFixed(4)}  ·  avg ${s.avgMs} ms  ·  rails ${Object.entries(s.byRail).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}`,
  ];
  if (s.topRules.length) lines.push(`rules that fired: ${s.topRules.map(([r, c]) => `${r} ×${c}`).join(", ")}`);
  lines.push("Logs: ~/.openclaw/overwing/logs/  (JSONL, one line per check, no message text)");
  return lines.join("\n");
}
