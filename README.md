# overwing-openclaw

The [Overwing](https://overwing.ai/gate) send gate as an [OpenClaw](https://openclaw.ai) plugin. Every outbound message, every reply to a person and every send-tool call is checked before it goes: personal data that does not belong to the recipient, confidential leaks, toxicity, self-harm, sexual content, severity. One recommended action per message: allow, redact, review or block.

It runs in **shadow mode** until you say otherwise: it checks, it logs, it changes nothing. `/overwing stats` shows what it would have stopped.

```bash
openclaw plugins install overwing-openclaw --force && openclaw plugins enable overwing
```

A plugin installed from npm lands disabled until you enable it, and `--force` acknowledges that npm is outside ClawHub's review. Check it with `openclaw plugins inspect overwing --runtime`: three typed hooks and the `overwing` command.

## Paying for checks

Three rails, used in this order:

1. **API key.** `plugins.entries.overwing.config.apiKey` or `OVERWING_API_KEY`. A free key is 250 checks a day; plans and a $5 card top-up at [overwing.ai/pricing](https://overwing.ai/pricing).
2. **Wallet.** `walletKey` or `OVERWING_WALLET_KEY`, an EVM private key, pays $0.002 per check in USDC on Base over x402. **If you run ClawRouter, its wallet at `~/.openclaw/blockrun/wallet.key` is used automatically.** Spending is capped: $0.01 per call and $0.50 per day by default (`maxPerCallUsd`, `dailyCapUsd`).
3. **Free allowance.** No key, no wallet: 10 checks a day, inputs up to 2,000 characters, nothing stored.

A check that fails, times out (2.5 s) or cannot be paid never blocks a message. It is logged as skipped with the reason.

## Enforce mode

```json
{ "plugins": { "entries": { "overwing": { "config": { "mode": "enforce" } } } } }
```

or `/overwing mode enforce` for the running process.

| Verdict | Channel message / reply | Send-tool call (`message` and `tools` you list) |
|---|---|---|
| allow | sent | runs |
| redact | text replaced by `fallbackText` | blocked with the rule named, so the agent can remove the detail and resend |
| review | held (`onReview: "hold"`) or sent (`"allow"`) | OpenClaw's own approval prompt: a person decides |
| block | text replaced by `fallbackText` | blocked |

## Commands

- `/overwing status`: mode, rail, today's counts.
- `/overwing stats [days]`: checks, actions, spend, the rules that fired.
- `/overwing mode shadow|enforce`.

Logs live in `~/.openclaw/overwing/logs/`, one JSONL line per check, never the message text.

## Config

| Key | Default | |
|---|---|---|
| `mode` | `shadow` | `shadow` or `enforce` |
| `apiKey` | | `ow_live_...` |
| `walletKey` | | `0x...`, or ClawRouter's wallet file |
| `onReview` | `hold` | `hold` or `allow` |
| `fallbackText` | a short held-back note | what is sent in place of a redacted or blocked message |
| `ruleSet` | `outbound-message` | custom sets need a key |
| `tools` | `["message"]` | tool names checked in `before_tool_call` |
| `maxPerCallUsd` | `0.01` | wallet rail |
| `dailyCapUsd` | `0.50` | wallet rail |
| `timeoutMs` | `2500` | |
| `baseUrl` | `https://overwing.ai` | |

## Security

What the plugin reads, sends and signs, stated plainly because OpenClaw has no versioned security-manifest schema yet:

- **Network.** The text of an outbound message, reply or send-tool call is POSTed to `https://overwing.ai/api/v1/evaluate` (key or free allowance) or `/api/x402/evaluate` (wallet). Without a key the service does not store the text; with a key, storage follows your account's data settings.
- **`OVERWING_API_KEY`** is sent as a bearer token to overwing.ai and nowhere else.
- **`OVERWING_WALLET_KEY`**, or ClawRouter's wallet file at `~/.openclaw/blockrun/wallet.key`, is used locally to sign USDC payment authorizations on Base (EIP-712). The key never leaves the process; only signatures are sent. Spending is capped per call and per day.
- **Shadow mode is the default.** Nothing is altered or cancelled until you set `mode` to `enforce`.
- **Fail open.** A failed, slow or unpaid check never blocks a message; it is logged as skipped with the reason.
- **Logs** at `~/.openclaw/overwing/logs/` hold verdicts, rules and costs, never message text.

## Develop

```bash
npm install
npm test            # node:test on the pure modules
npm run typecheck   # against the OpenClaw SDK at /opt/homebrew/lib/node_modules/openclaw
npm run build       # tsup, one ESM file with dependencies inlined
npm pack --pack-destination /tmp && openclaw plugins install npm-pack:/tmp/overwing-openclaw-0.1.2.tgz --force
openclaw plugins inspect overwing --runtime --json
```

MIT. Source and issues: https://github.com/frod27/overwing-openclaw. The scope and the reasoning are in [docs/scope.md](docs/scope.md).
