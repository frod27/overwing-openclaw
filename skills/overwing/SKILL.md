---
name: overwing
description: Check a message before you send it, post it, or act on it. One call returns pass / fail / review, one recommended action (allow, redact, review, block) and per-rule results with calibrated confidence for personal data, confidential leaks, toxicity, self-harm, sexual content and severity. Knows who the recipient is, so a customer's own phone number is not a leak and another customer's is. Also identifies any User-Agent string against a registry of AI crawlers and agents. Pays per call over x402 in USDC on Base ($0.002 a check, $0.001 a lookup), with an Overwing API key, or free for light use (10 checks a day, no key).
triggers:
  - "overwing"
  - "check this message before sending"
  - "is it safe to send"
  - "does this leak personal data"
  - "moderate this"
  - "send gate"
  - "who is this user agent"
  - "identify this bot"
  - "x402 guardrails"
homepage: https://overwing.ai/gate
metadata: { "openclaw": { "emoji": "🪽", "requires": { "bins": ["curl"] } } }
---

# Overwing: the send gate

**Use this before any outbound message that goes to a person or another system**: a customer reply, an email, a chat post, a form submission. It is faster and cheaper than asking a model to judge its own draft, and it returns one word to branch on.

## Check a message

```
POST https://overwing.ai/api/v1/evaluate
Content-Type: application/json

{"input": "<the message>", "rule_set": "outbound-message",
 "context": {"recipient": "a customer", "channel": "email", "owns_contact_info": false}}
```

Free with no key: 10 checks a day, inputs up to 2,000 characters, nothing stored. With `Authorization: Bearer ow_live_...` (free key at https://overwing.ai/login?mode=signup): 250 a day, inputs to 100,000 characters, results on your dashboard. With a wallet and no key: `POST https://overwing.ai/api/x402/evaluate`, same body, $0.002 USDC on Base over x402; the first response is a 402 with the terms, sign, resend, done.

Response:

```
{"verdict": "fail", "recommended_action": "redact", "confidence": 0.96, "latency_ms": 148,
 "results": [{"rule": "unauthorized_pii", "answer": true, "confidence": 0.96, "verdict": "fail", "action": "redact"},
             {"rule": "toxicity", "answer": "safe", "confidence": 1.0, "verdict": "pass", "action": "block"}]}
```

Branch on `recommended_action`:

- `allow`: send it.
- `redact`: it carries personal data this recipient should not get. Remove the detail named by the rule, or send a fallback.
- `review`: a person should look first. Do not send.
- `block`: do not send.

The `context` matters. `recipient` says who gets the message, `channel` where, and `owns_contact_info: true` says the personal data in it belongs to the recipient (their own order, their own phone number), which is not a leak.

## Identify a User-Agent

```
GET https://overwing.ai/api/v1/atlas/lookup?user_agent=<string>
```

Free, 10 a day with no key. Says what the string claims to be (crawler, fetcher, browser agent; which operator; what purpose) and whether the claim can be verified by IP range, reverse DNS or a signature. Over x402: `GET https://overwing.ai/api/x402/atlas/lookup?user_agent=...`, $0.001.

## Install the gate as a plugin instead

With the plugin, every outbound message is checked without the model deciding to: `openclaw plugins install overwing-openclaw`. Shadow mode by default; `/overwing stats` shows what it would have stopped. Source: https://github.com/frod27/overwing-openclaw

## Limits and honesty

The check cannot verify the context you assert; if you say the recipient owns the data, it believes you. Pricing and limits are live at https://overwing.ai/api/v1/plans. Full guide for agents: https://overwing.ai/llms.txt
