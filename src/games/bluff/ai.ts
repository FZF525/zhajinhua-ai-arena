// 唬牌 AI:精确型(Excel)/ 随机型(基线)
//
// 精确型的核心是一个干净的概率问题:
//   已知:我自己的 26 张 + 牌堆/待判定的张数(内容未知)+ 各家的剩牌数
//   要算:P(上家报的 k 张全都是「要点数 R 或癞子」)—— 超几何,可精确计算
// 注意:不要用 legalActions() 枚举候选动作 —— 26 选 5 约 9 万种,会拖死 AI
import { createDeck } from "../../cards.ts";
import { isHonestCard } from "./state.ts";
import type { BluffState } from "./state.ts";
import type { BluffAction } from "./legal.ts";
import type { Rng } from "../../rng.ts";

export interface BluffAiOptions {
  /** 估计「他在说谎」的概率超过它才质疑 */
  challengeAt: number;
  /** 手上一张真牌都没有时,一次最多谎报几张 */
  maxLie: number;
  /** 有真牌时一次最多出几张 */
  maxHonest: number;
}

export const DEFAULT_EXCEL: BluffAiOptions = { challengeAt: 0.5, maxLie: 1, maxHonest: 5 };

/** 估算:某人 k 张牌全是「R 或癞子」的概率(超几何 + 癞子修正) */
export function honestProbability(st: BluffState, seat: number, k: number): number {
  const mine = new Set(st.seats[seat].hand.map((c) => c.id));
  let honestLeft = 0;
  let total = 0;
  for (const c of createDeck()) {
    if (mine.has(c.id)) continue;
    total++;
    if (isHonestCard(c, st.roundRank, st.wildRank)) honestLeft++;
  }
  // 牌堆里的牌已经从别人手里出来了(内容未知)→ 按随机子集处理:总量减少,比例不变
  const offTable = st.pile.length + (st.pending ? st.pending.cards.length : 0);
  const N = Math.max(1, total - offTable);
  const H = honestLeft * Math.min(1, N / Math.max(1, total));
  let p = 1;
  for (let i = 0; i < k; i++) p *= Math.max(0, H - i) / Math.max(1, N - i);
  return Math.max(0, Math.min(1, p));
}

/** 精确型决策 */
export function excelDecide(st: BluffState, seat: number, opts: BluffAiOptions = DEFAULT_EXCEL): BluffAction {
  const me = st.seats[seat];
  if (st.pending && st.pending.seat !== seat) {
    const k = st.pending.cards.length;
    const pCheat = 1 - honestProbability(st, seat, k);
    const pot = st.pile.length + k;
    const willBust = me.hand.length + pot > st.cfg.bustCards;
    const threshold = opts.challengeAt * (willBust ? 1.6 : 1.0);
    if (pCheat > threshold) return { type: "CHALLENGE", seat };
  }
  const honest = me.hand.filter((c) => isHonestCard(c, st.roundRank, st.wildRank));
  const junk = me.hand.filter((c) => !isHonestCard(c, st.roundRank, st.wildRank));
  const kH = Math.min(honest.length, opts.maxHonest, st.cfg.maxPlay, me.hand.length);
  if (kH > 0) return { type: "PLAY", seat, cardIds: honest.slice(0, kH).map((c) => c.id) };
  const kL = Math.max(1, Math.min(opts.maxLie, st.cfg.maxPlay, me.hand.length));
  return { type: "PLAY", seat, cardIds: junk.slice(0, Math.max(1, Math.min(kL, junk.length))).map((c) => c.id) };
}

/** 随机型(基线) */
export function randomDecide(st: BluffState, seat: number, rng: Rng): BluffAction {
  const me = st.seats[seat];
  if (st.pending && st.pending.seat !== seat && rng.next() < 0.3) return { type: "CHALLENGE", seat };
  const k = Math.max(1, Math.min(1 + Math.floor(rng.next() * st.cfg.maxPlay), me.hand.length));
  const pool = me.hand.slice();
  const ids: string[] = [];
  for (let i = 0; i < k; i++) ids.push(pool.splice(Math.floor(rng.next() * pool.length), 1)[0].id);
  return { type: "PLAY", seat, cardIds: ids };
}