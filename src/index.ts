/**
 * Overwing gate for OpenClaw.
 *
 * Three hooks, one check: every outbound channel message, every reply to a
 * person, and every send-tool call is evaluated by Overwing before it goes.
 * Shadow mode (the default) logs what would have happened. Enforce mode acts:
 * block and redact replace the text with a fallback or cancel the send,
 * review holds the send or asks the operator through OpenClaw's own approval
 * prompt. A check that fails, times out or cannot be paid never blocks a
 * message.
 */
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { resolveConfig, type Config } from "./config.ts";
import { isSendAction, messageOutcome, recipientParam, textParam, toolOutcome } from "./decision.ts";
import { appendStat, clawRouterWalletKey, readStats, spendStore } from "./files.ts";
import { check, railOf, statLine, type GateIo } from "./gate.ts";
import { formatSummary, summarize } from "./stats.ts";

type Logger = { info: (m: string) => void; warn: (m: string) => void; debug?: (m: string) => void };

/** The narrow slice of the plugin API this plugin uses. The real type is far larger; this keeps the build independent of its exact shape. */
type Api = {
  pluginConfig?: Record<string, unknown>;
  logger: Logger;
  on: (hook: string, handler: (event: any, ctx: any) => unknown, opts?: Record<string, unknown>) => void;
  registerCommand: (command: { name: string; description: string; acceptsArgs?: boolean; requireAuth?: boolean; handler: (ctx: { args?: string }) => Promise<{ text: string; isError?: boolean }> | { text: string; isError?: boolean } }) => void;
};

const VERSION = "0.1.0";

export default definePluginEntry({
  id: "overwing",
  name: "Overwing gate",
  description: "Checks every outbound message, reply and send-tool call before it goes. Shadow mode by default.",
  register(apiRaw: unknown) {
    const api = apiRaw as Api;
    let cfg: Config = resolveConfig(api.pluginConfig, process.env);
    const io: GateIo = { spendStore, diskWalletKey: clawRouterWalletKey };
    const log = api.logger;
    log.info(`[overwing] gate ${VERSION}: mode ${cfg.mode}, rail ${railOf(cfg, io)}, tools ${cfg.tools.join(", ")}`);

    // 1. Channel messages the agent sends (message tool deliveries, agent-to-agent sends).
    api.on("message_sending", async (event: { to: string; content: string }, ctx: { channelId?: string }) => {
      const c = await check(cfg, io, event.content, { recipient: event.to, channel: ctx.channelId });
      if (cfg.mode === "shadow" || c.action === "skipped" || c.action === "allow") {
        appendStat(statLine("message", cfg, c, cfg.mode === "shadow" ? "log" : "pass", ctx.channelId, Date.now()));
        return;
      }
      const out = messageOutcome(c.action, cfg, c.rules);
      appendStat(statLine("message", cfg, c, out.kind, ctx.channelId, Date.now()));
      if (out.kind === "replace") return { content: out.text, metadata: { overwing: { action: c.action, rules: c.rules } } };
      if (out.kind === "cancel") return { cancel: true, cancelReason: out.reason };
      return;
    }, { priority: 100, timeoutMs: cfg.timeoutMs + 500 });

    // 2. Replies to the person, including webchat, after payload normalization.
    api.on("reply_payload_sending", async (event: { payload: { text?: string }; channel?: string }) => {
      const text = event.payload?.text;
      if (typeof text !== "string" || text.trim() === "") return;
      const c = await check(cfg, io, text, { recipient: "the person in this conversation", channel: event.channel });
      if (cfg.mode === "shadow" || c.action === "skipped" || c.action === "allow") {
        appendStat(statLine("reply", cfg, c, cfg.mode === "shadow" ? "log" : "pass", event.channel, Date.now()));
        return;
      }
      const out = messageOutcome(c.action, cfg, c.rules);
      appendStat(statLine("reply", cfg, c, out.kind, event.channel, Date.now()));
      if (out.kind === "replace") return { payload: { ...event.payload, text: out.text } };
      if (out.kind === "cancel") return { cancel: true, reason: out.reason };
      return;
    }, { priority: 100, timeoutMs: cfg.timeoutMs + 500 });

    // 3. Send-tool calls, before OpenClaw executes them. A review verdict becomes an approval prompt.
    api.on("before_tool_call", async (event: { toolName: string; params: Record<string, unknown> }, ctx: { abortSignal?: AbortSignal; requester?: { channel?: string } }) => {
      if (!cfg.tools.includes(event.toolName) || !isSendAction(event.params)) return;
      const found = textParam(event.params);
      if (!found) return;
      const c = await check(cfg, io, found.text, { recipient: recipientParam(event.params), channel: ctx.requester?.channel }, ctx.abortSignal);
      if (cfg.mode === "shadow" || c.action === "skipped" || c.action === "allow") {
        appendStat(statLine("tool", cfg, c, cfg.mode === "shadow" ? "log" : "pass", ctx.requester?.channel, Date.now()));
        return;
      }
      const out = toolOutcome(c.action, cfg, c.rules);
      appendStat(statLine("tool", cfg, c, out.kind, ctx.requester?.channel, Date.now()));
      if (out.kind === "block") return { block: true, blockReason: out.reason };
      if (out.kind === "approve") return { requireApproval: { title: out.title, description: out.description, severity: out.severity, timeoutMs: 120_000 } };
      return;
    }, { matcher: cfg.tools, priority: 100, timeoutMs: cfg.timeoutMs + 500 });

    // Commands: /overwing status | mode shadow|enforce | stats [days]
    api.registerCommand({
      name: "overwing",
      description: "Overwing gate: status, mode shadow|enforce, stats [days]",
      acceptsArgs: true,
      requireAuth: true,
      handler: async (ctx) => {
        const [sub = "status", arg] = (ctx.args ?? "").trim().split(/\s+/);
        if (sub === "mode") {
          if (arg !== "shadow" && arg !== "enforce") return { text: `Mode is ${cfg.mode}. Use: /overwing mode shadow|enforce (this process only; set plugins.entries.overwing.config.mode to keep it).`, isError: true };
          cfg = { ...cfg, mode: arg };
          return { text: `Overwing gate mode: ${arg}${arg === "enforce" ? ". Block and redact now replace the text; review holds the send." : ". Checks are logged, nothing is altered."}` };
        }
        if (sub === "stats") {
          const days = Math.min(90, Math.max(1, parseInt(arg ?? "7", 10) || 7));
          return { text: formatSummary(summarize(readStats(days)), days, cfg.mode, railOf(cfg, io)) };
        }
        const today = summarize(readStats(1));
        return { text: `Overwing gate ${VERSION}  ·  mode ${cfg.mode}  ·  rail ${railOf(cfg, io)}  ·  tools ${cfg.tools.join(", ")}\ntoday: ${today.checks} checks, ${today.byAction.block ?? 0} block, ${today.byAction.redact ?? 0} redact, ${today.byAction.review ?? 0} review, $${today.costUsd.toFixed(4)} spent\n/overwing stats 7  ·  /overwing mode enforce  ·  https://overwing.ai/gate` };
      },
    });
  },
});
