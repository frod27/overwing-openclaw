import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { actionOf, firedRules, isSendAction, messageOutcome, recipientParam, textParam, toolOutcome } from "./decision.ts";

const cfg = { onReview: "hold" as const, fallbackText: "[held]" };

describe("actionOf", () => {
  it("prefers recommended_action", () => {
    assert.equal(actionOf({ verdict: "fail", recommended_action: "redact" }), "redact");
  });
  it("falls back to the verdict", () => {
    assert.equal(actionOf({ verdict: "fail" }), "block");
    assert.equal(actionOf({ verdict: "review" }), "review");
    assert.equal(actionOf({ verdict: "pass" }), "allow");
  });
});

describe("messageOutcome", () => {
  it("replaces on block and redact", () => {
    assert.deepEqual(messageOutcome("block", cfg, "toxicity (block)"), { kind: "replace", text: "[held]" });
    assert.deepEqual(messageOutcome("redact", cfg, "unauthorized_pii (redact)"), { kind: "replace", text: "[held]" });
  });
  it("review holds or allows per config", () => {
    assert.equal(messageOutcome("review", cfg, "severity").kind, "cancel");
    assert.equal(messageOutcome("review", { ...cfg, onReview: "allow" }, "severity").kind, "pass");
  });
  it("allow passes", () => {
    assert.deepEqual(messageOutcome("allow", cfg, ""), { kind: "pass" });
  });
});

describe("toolOutcome", () => {
  it("blocks with a reason and asks for approval on review", () => {
    assert.equal(toolOutcome("block", cfg, "toxicity (block)").kind, "block");
    assert.equal(toolOutcome("redact", cfg, "unauthorized_pii (redact)").kind, "block");
    const r = toolOutcome("review", cfg, "severity");
    assert.equal(r.kind, "approve");
    assert.equal(toolOutcome("review", { onReview: "allow" }, "severity").kind, "pass");
  });
});

describe("params", () => {
  it("finds the text and the recipient", () => {
    assert.deepEqual(textParam({ action: "send", to: "+15550100", message: "hi" }), { key: "message", text: "hi" });
    assert.equal(textParam({ action: "send", message: "  " }), null);
    assert.equal(recipientParam({ target: "#ops" }), "#ops");
  });
  it("skips non-send actions", () => {
    assert.equal(isSendAction({ action: "list" }), false);
    assert.equal(isSendAction({ action: "send" }), true);
    assert.equal(isSendAction({}), true);
  });
});

describe("firedRules", () => {
  it("names the rules that fired", () => {
    assert.equal(firedRules({ verdict: "fail", results: [{ rule: "unauthorized_pii", verdict: "fail", action: "redact" }, { rule: "toxicity", verdict: "pass" }] }), "unauthorized_pii (redact)");
    assert.equal(firedRules({ verdict: "pass", results: [] }), "no rule fired");
  });
});
