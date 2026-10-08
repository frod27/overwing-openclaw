import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allows, forToday, record, usdFromAtomic } from "./spend.ts";

const caps = { maxPerCallUsd: 0.01, dailyCapUsd: 0.5 };
const day = Date.UTC(2026, 9, 8, 12);

describe("spend control", () => {
  it("converts atomic USDC", () => {
    assert.equal(usdFromAtomic("2000"), 0.002);
    assert.ok(Number.isNaN(usdFromAtomic("abc")));
  });
  it("refuses a call above the per-call cap", () => {
    assert.equal(allows(forToday(null, day), 0.02, caps).ok, false);
  });
  it("stops at the daily cap and resets the next day", () => {
    let s = forToday(null, day);
    for (let i = 0; i < 250; i++) s = record(s, 0.002);
    assert.equal(allows(s, 0.002, caps).ok, false);
    assert.equal(allows(forToday(s, day + 86_400_000), 0.002, caps).ok, true);
  });
});
