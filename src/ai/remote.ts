// 外部 AI 接入(LLM 测试入口)
// 设计要点:
//  1) 公平隔离:发给外部模型的只有【它自己座位该看到的信息】(buildView 的裁剪结果),
//     绝不含别人的手牌 / 牌堆 —— 服务端是唯一的"发牌人"。
//  2) 可替换:任何实现了 OpenAI 兼容 /v1/chat/completions 的服务都能接
//     (OpenAI、DeepSeek、通义、本地 Ollama、自己写的 mock 都行)。
//  3) 失败可解释:超时 / 解析失败 / 非法动作 → 记一笔并走兜底(默认弃牌),
//     比赛结果里会打印违规次数,不做"悄悄帮它圆过去"。
import type { Action, GameState } from "../state.ts";
import type { Policy } from "../env.ts";
import { enumerateActions } from "../env.ts";
import { player } from "../state.ts";
import { buildView } from "../../web/view.ts";
import { callCost, compareCost, exchangeCost, interceptCost, kickCost, raiseCost } from "../costs.ts";
import type { Rng } from "../rng.ts";

export interface RemoteConfig {
  name: string;
  /** OpenAI 兼容的 chat completions 端点 */
  endpoint: string;
  model: string;
  /** 从环境变量读 key,避免写进代码/仓库 */
  apiKeyEnv?: string;
  apiKey?: string;
  temperature?: number;
  timeoutMs?: number;
  /** 违规(超时/非法/解析失败)时的兜底动作 */
  fallback?: "fold" | "call" | "heuristic";
  /** 每步的思考预算(部分服务支持) */
  maxTokens?: number;
  /** 可注入的 fetch(测试用) */
  fetchImpl?: typeof fetch;
  /** 每步回调:便于打印/记录 LLM 的原始回答 */
  onDecision?: (info: RemoteDecisionInfo) => void;
}

export interface RemoteDecisionInfo {
  seat: number;
  prompt: string;
  raw: string;
  action: Action | null;
  legal: number;
  ms: number;
  violation?: "timeout" | "parse" | "illegal" | "http";
}

export interface RemoteStats {
  decisions: number;
  violations: number;
  timeouts: number;
  totalMs: number;
  byViolation: Record<string, number>;
}

export function newRemoteStats(): RemoteStats {
  return { decisions: 0, violations: 0, timeouts: 0, totalMs: 0, byViolation: {} };
}

/** 把"该座位能看到的信息"渲染成给 LLM 的文本(不含任何隐藏信息) */
export function buildPrompt(state: GameState, seat: number, legal: Action[]): string {
  const v = buildView(state, true, { viewer: seat }) as unknown as {
    handNo: number; phase: string; multiplier: number; pot: number; round: number;
    pool: Array<{ id: string | null; text: string | null; faceUp: boolean; blockadedBy: number | null; ripe?: boolean }>;
    players: Array<{ seat: number; name: string; points: number; blind: boolean; folded: boolean; inHand: boolean; handCount: number; committed: number; isActor: boolean; hand: Array<{ text: string }> | null; handDesc: string | null }>;
  };
  const me = v.players.find((p) => p.seat === seat)!;
  const my = me.hand ? me.hand.map((c) => c.text).join(" ") + (me.handDesc ? "(" + me.handDesc + ")" : "") : "未看牌";
  const lines: string[] = [];
  lines.push("你在玩 5 张炸金花(纯积分,104 张牌:13 级 × 8 花色)。只能看到自己的信息。");
  lines.push("局面:第 " + v.handNo + " 局 阶段=" + v.phase + " 注码倍数 M=" + v.multiplier + " 底池=" + v.pot + " 下注轮=" + v.round);
  lines.push("公共池(7 张,可花钱换牌):" + v.pool.map((c) => c.text ?? "暗牌").join(" "));
  lines.push("我的牌:" + my + (me.blind ? "(闷牌中,跟注只付一半)" : ""));
  lines.push("各家:");
  for (const p of v.players) {
    lines.push("  " + (p.seat === seat ? "我" : p.name) + " 座位" + p.seat + " " + p.points + "分 " +
      (p.folded ? "已弃牌" : p.inHand ? (p.blind ? "闷牌" : "看牌") : "出局") + " 已投" + p.committed +
      (p.hand ? " 亮牌:" + p.hand.map((c) => c.text).join(" ") : ""));
  }
  lines.push("可选动作(用 action 字段,参数照抄):");
  legal.forEach((a, i) => {
    const clean: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(a as Record<string, unknown>)) if (k !== "seat") clean[k] = val;
    if (typeof clean.type === "string") { clean.action = clean.type; delete clean.type; }
    lines.push("  " + i + ") " + JSON.stringify(clean));
  });
  lines.push("规则提示:比牌(COMPARE)付 2×费率×M 点名单挑,输者出局;踢牌(KICK)把一张明牌踢掉并补一张暗牌给自己,费用 8×M;换牌(EXCHANGE)付 1×M 换池中一张明牌。");
  lines.push('只回一个 JSON,不要解释。格式:{"action":"CALL"} 或 {"action":"EXCHANGE","takeCardId":"HEART-2","giveCardId":"SPADE-7"} 或 {"action":"COMPARE","targetSeat":1}。action 必须是上面列表里的类型,参数必须用上面列表里的 id。');
  return lines.join("\n");
}

/** 把 LLM 的回答解析成动作(允许带 markdown 代码块 / 多余文字) */
export function parseAction(raw: string): Action | null {
  const text = raw.trim();
  /** 统一成引擎内部格式:{type, ...} —— 兼容 LLM 常见的 {"action":"CALL"} 写法 */
  const normalize = (o: unknown): Action | null => {
    if (!o || typeof o !== "object") return null;
    const src = o as Record<string, unknown>;
    const t = src.type ?? src.action;
    if (typeof t !== "string") return null;
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(src)) if (k !== "action") out[k] = val;
    out.type = t;
    return out as unknown as Action;
  };
  const tryJson = (s: string): Action | null => {
    try { return normalize(JSON.parse(s)); } catch { return null; }
  };
  const bare = text.replace(/^["'\u0060]+|["'\u0060]+$/g, "").trim();
  if (/^(FOLD|CALL|RAISE|COMPARE|VIEW_HAND|EXCHANGE|KICK|TAKE_BLOCKED|PASS_BLOCKED|INTERCEPT|DECLINE_INTERCEPT)$/i.test(bare)) {
    return { type: bare.toUpperCase() } as unknown as Action;
  }
  const direct = tryJson(text);
  if (direct) return direct;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { const p = tryJson(fence[1].trim()); if (p) return p; }
  const brace = text.match(/\{[\s\S]*\}/);
  if (brace) { const p = tryJson(brace[0]); if (p) return p; }
  return null;
}

/** 与合法动作比对(类型 + 参数都要对得上) */
export function matchLegal(candidate: Action | null, legal: Action[]): Action | null {
  if (!candidate) return null;
  const key = (a: Action) => JSON.stringify(Object.entries(a as Record<string, unknown>).filter(([k]) => k !== "seat").sort());
  const want = key(candidate);
  const hit = legal.find((a) => key(a) === want);
  if (hit) return hit;
  // 只对了类型、参数写错的:若该类型只有一个候选,救回来(便于弱模型)
  const sameType = legal.filter((a) => a.type === candidate.type);
  return sameType.length === 1 ? sameType[0] : null;
}

/** 构造一个"外部 AI 玩家" */
export function makeRemoteAgent(cfg: RemoteConfig): Policy {
  const fetchImpl = cfg.fetchImpl ?? fetch;
  const stats = newRemoteStats();
  const timeout = cfg.timeoutMs ?? 20000;
  const temperature = cfg.temperature ?? 0;
  const doFetch = async (prompt: string): Promise<string> => {
    const key = cfg.apiKey ?? (cfg.apiKeyEnv ? process.env[cfg.apiKeyEnv] : undefined);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetchImpl(cfg.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", ...(key ? { authorization: "Bearer " + key } : {}) },
        body: JSON.stringify({
          model: cfg.model, temperature, max_tokens: cfg.maxTokens ?? 200,
          messages: [
            { role: "system", content: "你是一个扑克 AI。只输出 JSON 动作,不要输出任何解释。" },
            { role: "user", content: prompt }
          ]
        }),
        signal: ctrl.signal
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const body = await res.json() as { choices?: Array<{ message?: { content?: string } }>; message?: { content?: string } };
      return body.choices?.[0]?.message?.content ?? body.message?.content ?? "";
    } finally { clearTimeout(timer); }
  };

  const policy: Policy = (state: GameState, rng: Rng) => {
    const seat = state.turn.seat;
    if (seat === null) return null;
    const legal = enumerateActions(state);
    const prompt = buildPrompt(state, seat, legal);
    // 同步接口里没法 await:走"异步预取 + 缓存"模式由 runner 驱动(见 remoteAsync)
    void prompt; void rng; void legal;
    throw new Error("请使用 remoteAsync()(Policy 接口是同步的,LLM 调用是异步的)");
  };
  // 把统计挂上去,方便 runner 读数
  (policy as unknown as { stats: RemoteStats }).stats = stats;
  (policy as unknown as { config: RemoteConfig }).config = cfg;
  (policy as unknown as { ask: (p: string) => Promise<string> }).ask = doFetch;
  return policy;
}

/**
 * 异步决策:同步的 Policy 接口装不下 HTTP 往返,所以外部 AI 用这个。
 * runner 在轮到该座位时 await 它,然后 apply。
 */
export async function remoteDecide(cfg: RemoteConfig, state: GameState, seat: number, stats?: RemoteStats): Promise<{ action: Action; info: RemoteDecisionInfo }> {
  const fetchImpl = cfg.fetchImpl ?? fetch;
  const timeout = cfg.timeoutMs ?? 20000;
  const s = stats ?? newRemoteStats();
  const legal = enumerateActions(state);
  const prompt = buildPrompt(state, seat, legal);
  const t0 = Date.now();
  let raw = "";
  let violation: RemoteDecisionInfo["violation"];
  try {
    const key = cfg.apiKey ?? (cfg.apiKeyEnv ? process.env[cfg.apiKeyEnv] : undefined);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetchImpl(cfg.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", ...(key ? { authorization: "Bearer " + key } : {}) },
        body: JSON.stringify({
          model: cfg.model, temperature: cfg.temperature ?? 0, max_tokens: cfg.maxTokens ?? 200,
          messages: [
            { role: "system", content: "你是一个扑克 AI。只输出 JSON 动作,不要输出任何解释。" },
            { role: "user", content: prompt }
          ]
        }),
        signal: ctrl.signal
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const body = await res.json() as { choices?: Array<{ message?: { content?: string } }>; message?: { content?: string } };
      raw = body.choices?.[0]?.message?.content ?? body.message?.content ?? "";
    } finally { clearTimeout(timer); }
  } catch (e) {
    violation = (e as Error).name === "AbortError" ? "timeout" : "http";
  }
  let parsed = violation ? null : parseAction(raw);
  let matched = violation ? null : matchLegal(parsed, legal);
  if (!violation && !matched) violation = parsed ? "illegal" : "parse";
  let action = matched;
  if (!action) {
    const fb = cfg.fallback ?? "fold";
    action = (fb === "call" ? legal.find((a) => a.type === "CALL") : legal.find((a) => a.type === "FOLD")) ?? legal[0];
    s.violations++;
    s.byViolation[violation ?? "unknown"] = (s.byViolation[violation ?? "unknown"] ?? 0) + 1;
    if (violation === "timeout") s.timeouts++;
  }
  s.decisions++;
  const ms = Date.now() - t0;
  s.totalMs += ms;
  const info: RemoteDecisionInfo = { seat, prompt, raw, action, legal: legal.length, ms, violation };
  cfg.onDecision?.(info);
  return { action, info };
}

/** 便捷:费用表转文本(给 prompt 用,按需扩展) */
export function costsSummary(state: GameState, seat: number): string {
  const parts = ["跟注=" + callCost(state, seat).total, "比牌=" + compareCost(state, seat).total, "换牌=" + exchangeCost(state, seat).total, "踢牌=" + kickCost(state).total];
  const next = enumerateActions(state).find((a) => a.type === "RAISE") as (Action & { toMultiplier?: number }) | undefined;
  if (next?.toMultiplier !== undefined) parts.push("加注到M=" + next.toMultiplier + "=" + raiseCost(state, seat, next.toMultiplier).total);
  const w = state.pendingIntercept;
  if (w && w.candidateSeat === seat) parts.push("截胡=" + interceptCost(state, w.cardId, w.n).total);
  void player;
  return parts.join("  ");
}
