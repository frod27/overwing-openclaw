import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatSummary, parseLines, summarize } from "./stats.ts";

const lines = [
  { at: "2026-10-08T10:00:00.000Z", hook: "message", mode: "shadow", rail: "free", action: "allow", rules: "no rule fired", did: "log", costUsd: 0, ms: 150 },
  { at: "2026-10-08T10:01:00.000Z", hook: "reply", mode: "enforce", rail: "wallet", action: "redact", rules: "unauthorized_pii (redact)", did: "replace", costUsd: 0.002, ms: 170 },
  { at: "2026-10-08T10:02:00.000Z", hook: "tool", mode: "enforce", rail: "wallet", action: "block", rules: "toxicity (block), severity (block)", did: "block", costUsd: 0.002, ms: 160 },
].map((l) => JSON.stringify(l)).join("\n") + "\n{torn";

describe("stats", () => {
  it("parses and skips torn lines", () => {
    assert.equal(parseLines(lines).length, 3);
  });
  it("summarizes", () => {
    const s = summarize(parseLines(lines));
    assert.equal(s.checks, 3);
    assert.equal(s.byAction.block, 1);
    assert.equal(s.costUsd, 0.004);
    assert.deepEqual(s.topRules[0], ["unauthorized_pii", 1]);
    assert.match(formatSummary(s, 7, "enforce", "wallet"), /checks 3/);
  });
});
