// 唬牌 LLM 座位:把牌桌讲清楚,让模型自己决定「报几张」还是「质疑」
//
// 关键设计:prompt 里除自己的手牌,还给【对手画像】——
//   即自适应 AI 从局末账本学到的「他报 k 张时诚实率」统计 ✓
//   于是可以回答那个实验:LLM 是靠这些数字决策,还是靠它自己的感觉 ✓
// 复用 src/ai/remote.ts 的 remoteChat(不重抄 HTTP 细节)
import { remoteChat } from "../../ai/remote.ts";
import type { RemoteConfig } from "../../ai/remote.ts";
import { isHonestCard, rankOf, rankText } from "./state.ts";
import type { BluffState } from "./state.ts";
import type { BluffAction } from "./legal.ts";
import type { AdaptiveAgent } from "./ai.ts";

/** 两个现成服务商;Key 从环境变量读,绝不写进代码 */
export const BLUFF_LLM_PROVIDERS: Record<string, RemoteConfig> = {
  glm: { url: "https://open.bigmodel.cn/api/paas/v4/chat/completions", model: "glm-4-flash", apiKeyEnv: "GLM_API_KEY", jsonMode: true, temperature: 0.6, maxTokens: 300 },
  ds: { url: "https://api.deepseek.com/v1/chat/completions", model: "deepseek-chat", apiKeyEnv: "DS_API_KEY", jsonMode: true, temperature: 0.6, maxTokens: 300 },
};

export const BLUFF_SYSTEM = [
  "你在玩一款叫【唬牌】的四人牌局。规则:",
  "· 每回合公开抽一个点数 R;轮到你时必须从手里扣出 1~5 张放上桌,宣告「这几张都是 R」;",
  "· 你可以撒谎(扣任意牌都行),对手看不见你扣的是什么;",
  "· 你也可以质疑上一家那一手:若那几张里有一张既不是 R 也不是癞子,他收回整堆;否则你收;",
  "· 无论质疑成败,接下来都是你出牌 —— 不能靠质疑逃避出手;",
  "· 癞子点数可当任意点数,所以癞子算真话;",
  "· 手牌出空 = 赢下这一局;手牌超过爆牌线 = 惨败;",
  "· 局末会翻开牌堆并公布每人「说了多少假话」的账本 —— 长期撒谎会被读死;",
  "你的目标不是这一手最安全,而是这一局结束时手牌最少。",
  "只输出 JSON:action 取 PLAY 或 CHALLENGE,cards 是卡牌 id 数组,reason 是一句话。",
].join("\n");

/** 把牌桌讲给模型听(含对手画像) */
export function buildBluffPrompt(st: BluffState, seat: number, agent?: AdaptiveAgent): string {
  const me = st.seats[seat];
  const lines: string[] = [];
  lines.push("【第 " + st.handNo + " 局 · 你是 " + me.name + "(座位 " + seat + ")】");
  lines.push("本回合点数 R = " + rankText(st.roundRank) + " ;癞子 = " + rankText(st.wildRank) + "(可当任意点数)");
  lines.push("牌堆 " + st.pile.length + " 张;你手里 " + me.hand.length + " 张;各家剩牌 " + st.seats.map((x) => x.name + "=" + x.hand.length).join(" "));
  if (st.pending) {
    const who = st.seats[st.pending.seat];
    lines.push("上一手:" + who.name + " 扣了 " + st.pending.cards.length + " 张,宣告全是 " + rankText(st.pending.declaredRank));
    if (agent) {
      const s = agent.statsFor(st.pending.seat, st.pending.cards.length);
      const rate = s.claims > 0 ? Math.round((s.lies / s.claims) * 100) + "%" : "无样本";
      lines.push("对手画像:他报 " + st.pending.cards.length + " 张时,历史撒谎率 " + rate + "(样本 " + s.claims + " 手)");
    }
    lines.push("你可以质疑他。");
  } else {
    lines.push("现在没有可质疑的上一手,你只能出牌。");
  }
  const honest = me.hand.filter((c) => isHonestCard(c, st.roundRank, st.wildRank));
  lines.push("你的手牌 " + me.hand.length + " 张(其中 " + honest.length + " 张算真话,标★):");
  lines.push(me.hand.map((c) => c.id + "(" + rankText(rankOf(c)) + (isHonestCard(c, st.roundRank, st.wildRank) ? "★" : "") + ")").join(" "));
  lines.push("请决定:出 1~5 张(填卡牌 id),或质疑。只回 JSON。");
  return lines.join("\n");
}

/** 解析并校验模型输出 —— 永远只返回合法动作(铁律:AI 不能产出非法动作) */
export function parseBluffAction(raw: string, st: BluffState, seat: number): BluffAction | null {
  let obj: unknown = null;
  try {
    obj = JSON.parse(raw);
  } catch {
    const m = raw.match(/[{][\s\S]*[}]/);
    if (!m) return null;
    try { obj = JSON.parse(m[0]); } catch { return null; }
  }
  const o = obj as { action?: string; cards?: unknown };
  const mine = new Set(st.seats[seat].hand.map((c) => c.id));
  const act = String(o.action ?? "").toUpperCase();
  if (act === "CHALLENGE") {
    if (st.pending && st.pending.seat !== seat) return { type: "CHALLENGE", seat };
    return null;
  }
  if (act === "PLAY") {
    const ids = (Array.isArray(o.cards) ? o.cards : []).map(String).filter((id) => mine.has(id));
    const uniq = Array.from(new Set(ids));
    if (uniq.length > st.cfg.maxPlay) return { type: "PLAY", seat, cardIds: uniq.slice(0, st.cfg.maxPlay) };
    if (uniq.length >= 1) return { type: "PLAY", seat, cardIds: uniq };
  }
  return null;
}

/** 兜底:一定合法的动作(模型抽风 / 超时 / 缺 Key 时用) */
export function fallbackAction(st: BluffState, seat: number): BluffAction {
  const me = st.seats[seat];
  return { type: "PLAY", seat, cardIds: me.hand.slice(0, 1).map((c) => c.id) };
}

export interface BluffLlmInfo { ok: boolean; error?: string; reason?: string; ms: number; inputTokens: number; outputTokens: number; usedFallback?: boolean; calls: number }

/** 造一个 LLM 座位;decide 是异步的(web 路由本身就是 async) */
export function makeBluffLlmAgent(provider: "glm" | "ds", agent?: AdaptiveAgent, temperature?: number) {
  const cfg: RemoteConfig = { ...BLUFF_LLM_PROVIDERS[provider], ...(temperature === undefined ? {} : { temperature }) };
  const info: BluffLlmInfo = { ok: false, ms: 0, inputTokens: 0, outputTokens: 0, calls: 0 };
  return {
    provider,
    get info(): BluffLlmInfo { return { ...info }; },
    async decide(st: BluffState, seat: number): Promise<BluffAction> {
      info.calls += 1;
      const r = await remoteChat(cfg, BLUFF_SYSTEM, buildBluffPrompt(st, seat, agent));
      info.ok = r.ok; info.error = r.error; info.ms = r.ms; info.inputTokens = r.inputTokens; info.outputTokens = r.outputTokens;
      const parsed = r.ok ? parseBluffAction(r.text, st, seat) : null;
      info.usedFallback = !parsed;
      if (parsed) {
        const m = r.text.match(/reason[\s\S]{0,4}[:：][\s\S]{0,4}"([^"]{0,80})"/);
        info.reason = m ? m[1] : undefined;
        return parsed;
      }
      return fallbackAction(st, seat);
    },
  };
}
