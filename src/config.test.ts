import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveConfig } from "./config.ts";

describe("resolveConfig", () => {
  it("defaults to shadow with the free rail", () => {
    const c = resolveConfig(undefined, {});
    assert.equal(c.mode, "shadow");
    assert.equal(c.apiKey, null);
    assert.equal(c.walletKey, null);
    assert.deepEqual(c.tools, ["message"]);
  });
  it("reads the environment and rejects a malformed wallet key", () => {
    const c = resolveConfig({ walletKey: "nope" }, { OVERWING_API_KEY: "ow_live_x" });
    assert.equal(c.apiKey, "ow_live_x");
    assert.equal(c.walletKey, null);
  });
  it("accepts enforce and caps", () => {
    const c = resolveConfig({ mode: "enforce", dailyCapUsd: 2, timeoutMs: 10, baseUrl: "https://x.test/" }, {});
    assert.equal(c.mode, "enforce");
    assert.equal(c.dailyCapUsd, 2);
    assert.equal(c.timeoutMs, 250);
    assert.equal(c.baseUrl, "https://x.test");
  });
});
