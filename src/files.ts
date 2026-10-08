/**
 * The plugin's own files under ~/.openclaw/overwing: the daily stats log and
 * the wallet spend counter. Also reads ClawRouter's wallet, never writes it.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SpendStore } from "./payment.ts";
import type { SpendState } from "./spend.ts";
import { parseLines, type StatLine } from "./stats.ts";

export const DIR = join(homedir(), ".openclaw", "overwing");
export const LOG_DIR = join(DIR, "logs");
const SPEND_FILE = join(DIR, "spend.json");
const CLAWROUTER_WALLET = join(homedir(), ".openclaw", "blockrun", "wallet.key");

function ensureDir(): void {
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 });
}

export function appendStat(line: StatLine): void {
  try {
    ensureDir();
    appendFileSync(join(LOG_DIR, `${line.at.slice(0, 10)}.jsonl`), `${JSON.stringify(line)}\n`, { mode: 0o600 });
  } catch {
    // stats are a convenience; a full disk must not block a message
  }
}

export function readStats(days: number, now: number = Date.now()): StatLine[] {
  if (!existsSync(LOG_DIR)) return [];
  const since = new Date(now - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const out: StatLine[] = [];
  for (const file of readdirSync(LOG_DIR).sort()) {
    if (!file.endsWith(".jsonl") || file.slice(0, 10) < since) continue;
    try {
      out.push(...parseLines(readFileSync(join(LOG_DIR, file), "utf8")));
    } catch {
      // unreadable day: skip
    }
  }
  return out;
}

export const spendStore: SpendStore = {
  load(): SpendState | null {
    try {
      const v = JSON.parse(readFileSync(SPEND_FILE, "utf8")) as SpendState;
      return v && typeof v.day === "string" && typeof v.spentUsd === "number" ? v : null;
    } catch {
      return null;
    }
  },
  save(state: SpendState): void {
    try {
      ensureDir();
      writeFileSync(SPEND_FILE, JSON.stringify(state), { mode: 0o600 });
    } catch {
      // the in-memory x402 client still counted it; the next save catches up
    }
  },
};

/** ClawRouter's wallet, if the operator has one: a 0x-prefixed 32-byte hex key in a file. Read only. */
export function clawRouterWalletKey(): string | null {
  try {
    const key = readFileSync(CLAWROUTER_WALLET, "utf8").trim();
    return /^0x[0-9a-fA-F]{64}$/.test(key) ? key : null;
  } catch {
    return null;
  }
}
