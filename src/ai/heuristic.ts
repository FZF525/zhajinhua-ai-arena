// 阶段一:规则型 AI。三个性格只差一组参数,决策骨架相同。
//  Baozi(保守) / Sam(标准) / Lucas(激进)
import { player, isAlive, nextAliveSeat } from "../state.ts";
import type { Action, GameState } from "../state.ts";
import { callCost, compareCost, exchangeCost, interceptCost, kickCost, raiseCost } from "../costs.ts";
import { evaluate, compare as compareHands } from "../evaluator.ts";
import { enumerateActions, bestDiscard, exchangeGain } from "../env.ts";
import type { Policy } from "../env.ts";
import type { Rng } from "../rng.ts";

export interface Profile {
  name: string;
  label: string;
  /** 牌力低于此档就倾向弃牌(tier 1~12) */
  foldBelow: number;
  /** 到这一档就加注 */
  raiseAt: number;
  /** 到这一档就找人比牌 */
  compareAt: number;
  /** 愿意闷几轮不看牌(闷牌跟注便宜) */
  blindRounds: number;
  /** 一局想换几次牌 */
  wantExchanges: number;
  /** 换牌需要提升几档才划算 */
  exchangeMinGain: number;
  /** 单次支出最多占积分的比例(防止把家底打光) */
  maxCostRatio: number;
  /** 踢牌 / 截胡意愿(0~1) */
  kickAppetite: number;
  interceptAppetite: number;
  /** 诈唬率(牌力不够也加注) */
  bluffRate: number;
}

export const PROFILES: Record<string, Profile> = {
  Baozi: {
    name: "Baozi", label: "保守",
    foldBelow: 3, raiseAt: 6, compareAt: 7, blindRounds: 1, wantExchanges: 1, exchangeMinGain: 1,
    maxCostRatio: 0.02, kickAppetite: 0.1, interceptAppetite: 0.35, bluffRate: 0.02
  },
  Sam: {
    name: "Sam", label: "标准",
    foldBelow: 2, raiseAt: 4, compareAt: 5, blindRounds: 2, wantExchanges: 2, exchangeMinGain: 1,
    maxCostRatio: 0.05, kickAppetite: 0.35, interceptAppetite: 0.65, bluffRate: 0.08
  },
  Lucas: {
    name: "Lucas", label: "激进",
    foldBelow: 1, raiseAt: 2, compareAt: 3, blindRounds: 4, wantExchanges: 3, exchangeMinGain: 0,
    maxCostRatio: 0.12, kickAppetite: 0.8, interceptAppetite: 0.9, bluffRate: 0.22
  }
};

/** 牌力估计:闷牌者只能按"未知"估(给一个平均水平),看牌者按真实牌型 */
export function strengthOf(st: GameState, seat: number, p: Profile): number {
  const me = player(st, seat);
  if (me.blind) return 2.4 - p.blindRounds * 0.05;   // 未知手牌:大致"一对偏下"的平均水平
  const v = evaluate(me.hand);
  return v.tier + (v.key[0] ?? 0) / 14 * 0.6;
}

function affordable(points: number, cost: number, profile: Profile): boolean {
  return cost <= points && cost <= Math.max(1, points * profile.maxCostRatio) + callFloor(cost);
}
function callFloor(cost: number): number {
  return cost; // 允许最小的注(闷牌 1×M)永远打得动
}

/** 辅助动作(看牌 / 换牌 / 截胡 / 踢牌 / 收暗牌);没有该做的就返回 null */
export function auxDecision(st: GameState, rng: Rng, profile: Profile): Action | null {
  const seat = st.turn.seat;
  if (seat === null || st.phase !== "BETTING") return null;
  const me = player(st, seat);
  const acts = enumerateActions(st);
  const of = (t: string) => acts.filter((a) => a.type === t);
  const has = (t: string) => of(t).length > 0;
  const s = strengthOf(st, seat, profile);

  // ① 闷牌:便宜就继续闷,牌局变贵或攒够轮数再看牌
  if (me.blind && has("VIEW_HAND")) {
    const cost = callCost(st, seat).total;
    const shouldPeek = st.betting.roundIndex > profile.blindRounds || cost > me.points * 0.01 || st.multiplier >= 4;
    if (shouldPeek) return of("VIEW_HAND")[0];
  }

  // ② 换牌:能提升牌力就换(受次数与费用限制)
  if (has("EXCHANGE") && !me.blind && me.exchangeCount < profile.wantExchanges) {
    const fee = exchangeCost(st, seat).total;
    if (affordable(me.points, fee, profile)) {
      const scored = of("EXCHANGE").map((a) => {
        const ex = a as Action & { takeCardId: string };
        const card = st.pool.find((c) => c.id === ex.takeCardId)!;
        return { a, gain: exchangeGain(st, me, card), card };
      }).sort((x, y) => y.gain - x.gain || (y.card.rank - x.card.rank));
      if (scored.length && scored[0].gain >= profile.exchangeMinGain) return scored[0].a;
    }
  }

  // ③ 截胡:拿到手的是一张"看得见"的牌,提升够就截
  if (has("INTERCEPT")) {
    const w = st.pendingIntercept!;
    const card = player(st, w.fromSeat).hand.find((c) => c.id === w.cardId);
    const fee = interceptCost(st, w.cardId, w.n).total;
    const gain = card ? exchangeGain(st, me, card) : -1;
    const worth = gain >= 1 || (gain >= 0 && rng.int(100) < profile.interceptAppetite * 100);
    if (worth && affordable(me.points, fee, profile)) return of("INTERCEPT")[0];
  }

  // ④ 踢牌:换一张暗牌给自己留着(弱牌时更愿意赌)
  if (has("KICK") && !me.kickUsed && rng.int(100) < profile.kickAppetite * 100) {
    const fee = kickCost(st).total;
    if (affordable(me.points, fee, profile)) return of("KICK")[0];
  }

  // ⑤ 自己踢出的暗牌:收束后觉得值得就换走,否则公开
  if (has("TAKE_BLOCKED") || has("PASS_BLOCKED")) {
    const blk = st.blockades.find((b) => b.kickerSeat === seat && !b.resolvedByKicker);
    if (blk) {
      const card = st.pool.find((c) => c.id === blk.cardId);
      const fee = exchangeCost(st, seat).total;
      const gain = card ? exchangeGain(st, me, card) : -1;
      if (card && gain >= 1 && affordable(me.points, fee, profile)) return of("TAKE_BLOCKED")[0];
      return of("PASS_BLOCKED")[0];
    }
  }

  return null;
}

/** 主决策(比牌 / 加注 / 跟注 / 弃牌);由规则型或 MC 各自实现 */
export function mainDecision(st: GameState, rng: Rng, profile: Profile): Action {
  const seat = st.turn.seat!;
  const me = player(st, seat);
  const acts = enumerateActions(st);
  const of = (t: string) => acts.filter((a) => a.type === t);
  const has = (t: string) => of(t).length > 0;
  const s = strengthOf(st, seat, profile);
  const opponents = st.players.filter((q) => q.seat !== seat && isAlive(q)).length;
  const call = callCost(st, seat).total;
  const raiseAct = of("RAISE")[0];
  const raiseAmt = raiseAct ? raiseCost(st, seat, (raiseAct as Action & { toMultiplier: number }).toMultiplier).total : Infinity;
  const canRaise = !!raiseAct && me.points >= raiseAmt;
  const canCall = me.points >= call;
  const canCompare = has("COMPARE") && me.points >= compareCost(st, seat).total;
  const potOdds = call / (st.pot + call + 1);

  // 比牌:牌力够硬,或对手只剩 1 人且注码已经很贵
  if (canCompare && (s >= profile.compareAt || (opponents === 1 && call > me.points * 0.01 && s >= profile.foldBelow))) {
    const targets = of("COMPARE") as Array<Action & { targetSeat: number }>;
    const weakTarget = targets.find((a) => player(st, a.targetSeat).blind) ?? targets[0];
    return weakTarget;
  }
  if (canRaise && s >= profile.raiseAt) return raiseAct;
  if (canRaise && rng.int(100) < profile.bluffRate * 100 && opponents <= 2) return raiseAct;
  if (canCall && (s >= profile.foldBelow || potOdds < 0.12 * profile.maxCostRatio / 0.05)) return of("CALL")[0];
  if (canCall && call <= st.config.ante.amount * 2) return of("CALL")[0];   // 便宜就跟着看
  return of("FOLD")[0];
}

/** 规则型完整决策:先把辅助动作做完,再做主决策 */
export function healisticDecide(st: GameState, rng: Rng, profile: Profile): Action | null {
  return auxDecision(st, rng, profile) ?? mainDecision(st, rng, profile);
}

export function makeHeuristic(name: string): Policy {
  const profile = PROFILES[name];
  if (!profile) throw new Error("未知的规则型 AI: " + name);
  return (st, rng) => healisticDecide(st, rng, profile);
}

export const HEURISTIC_NAMES = Object.keys(PROFILES);
