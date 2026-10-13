// EQB(EquityBot):精确胜率参考 AI
// 不看经验、不算 rollout,直接算"我这 5 张牌面对未知牌堆的摊牌胜率",再按赔率决策。
// 已知信息:自己的手牌 + 公共池明牌 + 已弃牌者亮出的牌 + 自己踢的暗牌;
// 未知信息:牌堆 + 存活对手手牌 + 别人踢的暗牌 —— 这些就是采样空间。
import { player, isAlive } from "../state.ts";
import type { Action, GameState } from "../state.ts";
import { evaluate, compare } from "../evaluator.ts";
import type { Card } from "../cards.ts";
import { callCost, compareCost, raiseCost } from "../costs.ts";
import { enumerateActions } from "../env.ts";
import type { Policy } from "../env.ts";
import type { Rng } from "../rng.ts";
import { auxDecision, PROFILES } from "./heuristic.ts";

export interface EquityResult {
  /** 期望底池份额:1 = 稳赢,1/(1+k) = 与 k 家平分 */
  equity: number;
  win: number;
  tie: number;
  samples: number;
}

/** 我看不到的牌(采样空间):牌堆 + 存活对手手牌 + 别人踢的暗牌 */
export function unknownCards(s: GameState, seat: number): Card[] {
  const out: Card[] = [];
  out.push(...s.deck);
  for (const p of s.players) {
    if (p.seat === seat) continue;
    if (p.folded) continue;                       // 弃牌者(按 v1.7 亮牌)是已知信息
    out.push(...p.hand);
  }
  for (const c of s.pool) {
    const m = s.poolMeta[c.id];
    const blocker = s.blockades.find((b) => b.cardId === c.id && !b.resolvedByKicker);
    const mine = blocker && blocker.kickerSeat === seat;
    if (!m.faceUp && !mine) out.push(c);          // 别人踢的暗牌:对我未知
  }
  return out;
}

/** 精确胜率:把看不到的牌随机分给存活对手,比较摊牌结果 */
export function estimateEquity(s: GameState, seat: number, samples: number, rng: Rng): EquityResult {
  const me = player(s, seat);
  if (me.hand.length < 5) return { equity: 0, win: 0, tie: 0, samples: 0 };
  const opps = s.players.filter((p) => p.seat !== seat && isAlive(p));
  if (opps.length === 0) return { equity: 1, win: 1, tie: 0, samples: 0 };
  const space = unknownCards(s, seat);
  if (space.length < opps.length * 5) return { equity: 0, win: 0, tie: 0, samples: 0 };
  const mine = evaluate(me.hand);
  let eq = 0, win = 0, tie = 0;
  for (let i = 0; i < samples; i++) {
    const shuffled = rng.shuffle(space.slice());
    let behind = false, ties = 0;
    for (let k = 0; k < opps.length; k++) {
      const opp = shuffled.slice(k * 5, k * 5 + 5);
      const cmp = compare(evaluate(opp), mine);
      if (cmp > 0) { behind = true; break; }
      if (cmp === 0) ties++;
    }
    if (behind) continue;
    eq += 1 / (1 + ties);
    if (ties === 0) win++; else tie++;
  }
  return { equity: eq / samples, win: win / samples, tie: tie / samples, samples };
}

export interface EqProfile {
  name: string;
  label: string;
  /** 采样次数(越大越准) */
  samples: number;
  /** 跟注门槛系数:equity > price × margin 才跟 */
  margin: number;
  /** 期望份额超过它就加注 */
  raiseAt: number;
  /** 期望份额超过它就找人比牌 */
  compareAt: number;
  /** 辅助动作(看牌/换牌/踢牌/截胡)借用哪套性格 */
  aux: string;
  /** 单次支出上限占积分比例 */
  maxCostRatio: number;
  /** 看牌策略:always = 上来就看;smart = 便宜时继续闷(闷牌只付一半) */
  peek: "always" | "smart";
}

export const EQ_PROFILES: Record<string, EqProfile> = {
  // 校准版:赔率要求更高(考虑后续轮次还要继续付)、加注门槛更严、便宜时继续闷牌
  EQB: { name: "EQB", label: "精确胜率", samples: 1200, margin: 1.8, raiseAt: 0.80, compareAt: 0.85, aux: "Sam", maxCostRatio: 0.12, peek: "smart" },
  // 低算力对照:同策略、采样只有 1/6,用来看"算得多准值多少分"
  EQBfast: { name: "EQBfast", label: "精确胜率(快)", samples: 200, margin: 1.8, raiseAt: 0.80, compareAt: 0.85, aux: "Sam", maxCostRatio: 0.12, peek: "smart" },
  // 原始版:纯赔率(margin=1)、上来就看牌 —— 用来隔离"是算错还是校准错"
  EQBnaive: { name: "EQBnaive", label: "精确胜率(未校准)", samples: 1200, margin: 1.0, raiseAt: 0.62, compareAt: 0.66, aux: "Sam", maxCostRatio: 0.12, peek: "always" }
};

function affordable(points: number, cost: number, prof: EqProfile): boolean {
  return cost <= points && cost <= Math.max(1, points * prof.maxCostRatio);
}

/** 用精确胜率做主决策 */
export function equityDecide(s: GameState, rng: Rng, prof: EqProfile): Action {
  const seat = s.turn.seat!;
  const me = player(s, seat);
  const acts = enumerateActions(s);
  const of = (t: string) => acts.filter((a) => a.type === t);
  const { equity } = estimateEquity(s, seat, prof.samples, rng);
  const call = callCost(s, seat).total;
  const price = call / (s.pot + call + 1);          // 跟注需要的盈亏平衡胜率
  const canCall = of("CALL").length > 0 && affordable(me.points, call, prof) || call <= me.points;
  const raiseAct = of("RAISE")[0] as (Action & { toMultiplier: number }) | undefined;
  const raiseAmt = raiseAct ? raiseCost(s, seat, raiseAct.toMultiplier).total : Infinity;
  const cCost = compareCost(s, seat).total;

  if (of("COMPARE").length && equity >= prof.compareAt && me.points >= cCost) {
    const targets = of("COMPARE") as Array<Action & { targetSeat: number }>;
    const weak = targets.find((a) => player(s, a.targetSeat).blind) ?? targets[0];
    return weak;
  }
  if (raiseAct && equity >= prof.raiseAt && me.points >= raiseAmt) return raiseAct;
  if (canCall && equity > price * prof.margin) return of("CALL")[0];
  if (canCall && call <= s.config.ante.amount * 2) return of("CALL")[0];   // 极小注:跟了看结果
  return of("FOLD")[0];
}

export function makeEquityBot(name: string): Policy {
  const prof = EQ_PROFILES[name];
  if (!prof) throw new Error("未知的 EQB: " + name);
  const aux = PROFILES[prof.aux];
  return (s, rng) => {
    const seat = s.turn.seat;
    if (seat === null) return null;
    const me = player(s, seat);
    if (me.blind) {
      const call = callCost(s, seat).total;
      const price = call / (s.pot + call + 1);
      // 闷牌只付一半注:便宜就别急着看牌(smart),否则上来就看(always)
      const peekNow = prof.peek === "always" || s.betting.roundIndex > 1 || s.multiplier >= 4 || price > 0.05;
      if (peekNow) {
        const view = enumerateActions(s).find((a) => a.type === "VIEW_HAND");
        if (view) return view;
      } else {
        const acts = enumerateActions(s);
        const c = acts.find((a) => a.type === "CALL");
        if (c && call <= me.points) return c;
        const f = acts.find((a) => a.type === "FOLD");
        if (f) return f;
      }
    }
    return auxDecision(s, rng, aux) ?? equityDecide(s, rng, prof);
  };
}

export const EQ_NAMES = Object.keys(EQ_PROFILES);
