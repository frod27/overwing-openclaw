# Scope: the Overwing gate as an OpenClaw plugin

Written 2026-10-08 from the OpenClaw 2026.9.6 plugin SDK (`docs/plugins/hooks`, `dist/plugin-entry*.d.ts`) and the ClawRouter source (`@blockrun/clawrouter` 0.12.282, MIT).

## Why a plugin and not a skill

A skill is a document the model may read and then decide to call an API. Ours has been installed zero times. A plugin registers typed hooks that OpenClaw runs on every outbound message, reply and tool call, whether or not the model thinks of it. That is the mechanism ClawRouter uses to get paid on every turn: the plugin pays, nobody decides.

## What the plugin does

Three hooks, one decision function.

| Hook | Fires | What we check | Enforce | Shadow (default) |
|---|---|---|---|---|
| `message_sending` | Every channel message the agent sends (`to`, `content`) | `content`, with `recipient: to`, `channel: ctx.channelId` | block → `cancel`; redact → replace with fallback text, or cancel when no fallback; review → cancel with reason, or allow, per config | log only |
| `reply_payload_sending` | Every reply to a user, including webchat (`payload.text`) | `payload.text`, channel from event | block/redact → payload text replaced with fallback; review → pass or replace, per config | log only |
| `before_tool_call` | Every tool call; we act only on outbound tools (`message` and a configurable list) | the first string param named `message`, `text`, `content` or `body`; recipient from `to`/`target` | block → `{ block: true, blockReason }`; redact → `{ block }`; review → `requireApproval` (OpenClaw's own approval prompt: a person decides) | log only |

Rule set `outbound-message`, context `{ recipient, channel, owns_contact_info: false }`. The API returns `verdict`, `recommended_action` (allow, redact, review, block), per-rule results and confidence. The mapping from action to hook result is a pure function with tests.

Mode is `shadow` until the operator switches it: the plugin evaluates and logs what it would have done. This matches what the gate page tells people and the standing rule that per-request code ships off by default.

## What is copied from ClawRouter

1. **Three payment rails, in order.** API key (`apiKey` in plugin config or `OVERWING_API_KEY`), then an x402 wallet (`walletKey` in config, `OVERWING_WALLET_KEY`, or, read-only, the wallet ClawRouter already created at `~/.openclaw/blockrun/wallet.key`), then the keyless free allowance (10 checks a day, 2,000 characters). A ClawRouter user with a funded wallet needs no account and no key.
2. **Spend control.** `maxPerCallUsd` (default 0.01) and `dailyCapUsd` (default 0.50) on wallet payments; past the cap the plugin falls back to the keyless rail and then to shadow logging. Never a surprise bill.
3. **Stats people can see.** One JSONL line per check in `~/.openclaw/overwing/logs/YYYY-MM-DD.jsonl`, and `/overwing stats [days]` prints checks, allowed, redacted, reviewed, blocked, rail, spend, and the top rules that fired. This is the "visible counter of what was blocked".
4. **Commands.** `/overwing status` (mode, rail, today), `/overwing mode shadow|enforce`, `/overwing stats [days]`.
5. **Security manifest** (`openclaw.security.json`) declaring the wallet-key env access and local-only signing, in ClawRouter's format.
6. **A partner skill** at `skills/overwing/SKILL.md` in ClawRouter's partner shape (triggers, endpoints, prices), shipped with the plugin and ready for the BlockRun catalog pull request.
7. **Packaging.** ESM, tsup single bundle with dependencies inlined, `openclaw.plugin.json` with `configSchema`, `npm pack` + `openclaw plugins install npm-pack:` for local proof, then npm and ClawHub.

## What is not in scope now

Solana payments (ClawRouter's Solana wallet is a mnemonic-derived key; add when a Solana payer asks). Custom rule sets (keyed accounts can set `ruleSet`). Inbound screening of received messages (`message_received`): a one-line addition later, kept out so the first release has one job.

## Fail-open

A network error, a timeout (default 2.5 s), a 402 the plugin cannot pay, or an exhausted allowance never blocks a message. The check is logged as `skipped` with the reason. Enforce mode only acts on a verdict the API actually returned.
