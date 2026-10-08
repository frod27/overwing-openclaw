import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveConfig } from "./config.ts";
import { check, railOf } from "./gate.ts";
import type { SpendState } from "./spend.ts";

const store = { state: null as SpendState | null, load() { return this.state; }, save(s: SpendState) { this.state = s; } };
const reply = (status: number, body: unknown): typeof fetch => async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("check", () => {
  it("uses the free rail with no key and no wallet", async () => {
    const cfg = resolveConfig(undefined, {});
    const io = { spendStore: store, fetchImpl: reply(200, { verdict: "fail", recommended_action: "redact", results: [{ rule: "unauthorized_pii", verdict: "fail", action: "redact" }] }) };
    const c = await check(cfg, io, "call me at 555-0100", { recipient: "a customer" });
    assert.equal(railOf(cfg, io), "free");
    assert.equal(c.action, "redact");
    assert.equal(c.rail, "free");
    assert.equal(c.rules, "unauthorized_pii (redact)");
  });
  it("skips, never blocks, when the API fails or the allowance is gone", async () => {
    const cfg = resolveConfig(undefined, {});
    assert.equal((await check(cfg, { spendStore: store, fetchImpl: reply(429, { error: "limit" }) }, "hi", {})).action, "skipped");
    assert.equal((await check(cfg, { spendStore: store, fetchImpl: async () => { throw new Error("down"); } }, "hi", {})).action, "skipped");
  });
  it("sends the bearer token on the key rail", async () => {
    const cfg = resolveConfig({ apiKey: "ow_live_abc" }, {});
    let auth = "";
    const io = { spendStore: store, fetchImpl: (async (_u: string, init?: RequestInit) => { auth = String(new Headers(init?.headers).get("authorization")); return new Response(JSON.stringify({ verdict: "pass", recommended_action: "allow", results: [] }), { status: 200 }); }) as typeof fetch };
    const c = await check(cfg, io, "hello", {});
    assert.equal(auth, "Bearer ow_live_abc");
    assert.equal(c.action, "allow");
  });
  it("falls back to the free rail when the wallet cannot pay", async () => {
    const cfg = resolveConfig({ walletKey: `0x${"a".repeat(64)}` }, {});
    const io = {
      spendStore: store,
      fetchImpl: reply(200, { verdict: "pass", recommended_action: "allow", results: [] }),
      walletEvaluate: async () => ({ ok: false as const, reason: "spend policy: daily cap $0.5 reached" }),
    };
    const c = await check(cfg, io, "hello", {});
    assert.equal(railOf(cfg, io), "wallet");
    assert.equal(c.rail, "free");
    assert.equal(c.action, "allow");
  });
});
