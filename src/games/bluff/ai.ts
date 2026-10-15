// 唬牌 AI:精确型(带对手模型的贝叶斯)/ 随机型(基线)
//
// 关键修正(第一版错在哪):
//   第一版算的是 P(从随机 26 张里抽 k 张全是 R)  ← 忽略了“他为什么报 k 张”这个选择效应 ✗
//   结果:严重高估谎话率 → 逢报必疑 → 镜像局 250~34000 动作/局,而且自己从不说谎 ✗
// 现在算的是: P(诚实 | 观测到他报了 k 张),用对手策略做贝叶斯更新:
//   对手假设:手里有 h 张真牌(R + 癞子)时,诚实报 h 张;h = 0 时谎报 oppBluffSize 张
//   → 观测到他报 k 张 ⟹ 要么 h = k(诚实),要么 h = 0 且 k = 谎报尺寸
// 于是:P(诚实|k) = P(h=k) / [ P(h=k) + P(h=0)·1{k = 对手谎报尺寸} ]
// (k 取 maxPlay 时用 P(h>=k) 代替 P(h=k),因为该出手上真牌更多时也报满)
//
// 风格四轴(见 presetBluffPersona):质疑门槛 / 贪心撒谎 / 谎报尺寸 / 爆牌恐惧
// 注意:不要用 legalActions() 枚举候选动作 —— 26 选 5 约 9 万种,会拖死 AI
import { createDeck } from "../../cards.ts";
import { isHonestCard } from "./state.ts";
import type { BluffState } from "./state.ts";
import type { BluffAction } from "./legal.ts";
import type { Rng } from "../../rng.ts";

export interface BluffAiOptions {
  /** 质疑门槛:估计「他在说谎」的概率超过它才质疑 */
  challengeAt: number;
  /** 手上一张真牌都没有时,一次最多谎报几张 */
  maxLie: number;
  /** 有真牌时一次最多诚实出几张 */
  maxHonest: number;
  /** 贪心:明明能诚实,也有 greed 的概率去谎报更多(赌一把) */
  greed: number;
  /** 爆牌恐惧:吃下去会爆时,质疑门槛乘这个系数(>1 = 更谨慎) */
  bustFear: number;
  /** 对手模型:认为对手「没真牌时会谎报几张」 */
  oppBluffSize: number;
}

export const DEFAULT_EXCEL: BluffAiOptions = {
  challengeAt: 0.55, maxLie: 2, maxHonest: 5, greed: 0.1, bustFear: 1.6, oppBluffSize: 1,
};

/** 三种现成性格:保守(老实人)/ 标准 / 激进(赌徒) */
export const BLUFF_PERSONAS: Record<string, BluffAiOptions> = {
  // 老实人:几乎不质疑、从不说谎 —— 在唬牌里这是最容易被人拿捏的性格 ✗
  honest: { challengeAt: 0.8, maxLie: 1, maxHonest: 3, greed: 0, bustFear: 2.0, oppBluffSize: 1 },
  // 标准:按概率办事,偶尔贪一点
  standard: { ...DEFAULT_EXCEL },
  // 赌徒:敢谎报、敢质疑、不怕爆 —— 唬牌里的进攻型 ✗
  gambler: { challengeAt: 0.35, maxLie: 5, maxHonest: 5, greed: 0.6, bustFear: 1.1, oppBluffSize: 3 },
};

/** 组合数(浮点,够用) */
function choose(a: number, b: number): number {
  if (b < 0 || b > a) return 0;
  let r = 1;
  for (let i = 0; i < b; i++) r = (r * (a - i)) / (i + 1);
  return r;
}

/** 未见牌的统计:我自己的 26 张是已知;牌堆/待判定内容未知,按随机子集扣除 */
export function unseenCounts(st: BluffState, seat: number): { H: number; N: number; n: number } {
  const mine = new Set(st.seats[seat].hand.map((c) => c.id));
  let H = 0;
  let total = 0;
  for (const c of createDeck()) {
    if (mine.has(c.id)) continue;
    total++;
    if (isHonestCard(c, st.roundRank, st.wildRank)) H++;
  }
  const offTable = st.pile.length + (st.pending ? st.pending.cards.length : 0);
  const N = Math.max(1, total - offTable);
  const ratio = Math.min(1, N / Math.max(1, total));
  const n = Math.max(1, st.cfg.handSize - (st.pending && st.pending.seat === seat ? 0 : 0));
  // 对手手牌数:用平均(各家剩牌数不同,取别人剩牌的平均)
  const others = st.seats.filter((p) => p.seat !== seat);
  const navg = others.length ? others.reduce((s, p) => s + p.hand.length, 0) / others.length : n;
  return { H: H * ratio, N, n: Math.max(1, navg) };
}

/** P(诚实 | 他报了 k 张) —— 带选择效应的贝叶斯后验 */
export function honestPosterior(st: BluffState, seat: number, k: number, opts: BluffAiOptions): number {
  const { H, N, n } = unseenCounts(st, seat);
  const denomAll = choose(N, n);
  if (denomAll <= 0) return 1;
  const pHonestBySize = (x: number) => (Math.min(H, n) < x ? 0 : choose(Math.max(0, H), x) * choose(Math.max(0, N - H), Math.max(0, n - x)) / denomAll);
  const pGE = (x: number) => {
    let s = 0;
    const hi = Math.min(n, Math.floor(H));
    for (let i = Math.max(0, Math.ceil(x)); i <= hi; i++) s += pHonestBySize(i);
    return s;
  };
  const pExact = k >= st.cfg.maxPlay ? pGE(k) : pHonestBySize(k);
  const pBluff = k === opts.oppBluffSize ? pHonestBySize(0) : 0;
  const denom = pExact + pBluff;
  if (denom <= 0) return 1;
  return Math.max(0, Math.min(1, pExact / denom));
}

/** 置信度:估「他在说谎」的概率(1 - 后验) */
export function cheatProbability(st: BluffState, seat: number, k: number, opts: BluffAiOptions = DEFAULT_EXCEL): number {
  return 1 - honestPosterior(st, seat, k, opts);
}

/** 精确型决策(带风格) */
export function excelDecide(st: BluffState, seat: number, opts: BluffAiOptions = DEFAULT_EXCEL, rng?: Rng): BluffAction {
  const me = st.seats[seat];
  // ① 面对上家那一手
  if (st.pending && st.pending.seat !== seat) {
    const k = st.pending.cards.length;
    const pCheat = cheatProbability(st, seat, k, opts);
    const pot = st.pile.length + k;
    const willBust = me.hand.length + pot > st.cfg.bustCards;
    const threshold = opts.challengeAt * (willBust ? opts.bustFear : 1.0);
    if (pCheat > threshold) return { type: "CHALLENGE", seat };
  }
  // ② 出牌
  const honest = me.hand.filter((c) => isHonestCard(c, st.roundRank, st.wildRank));
  const junk = me.hand.filter((c) => !isHonestCard(c, st.roundRank, st.wildRank));
  const kH = Math.min(honest.length, opts.maxHonest, st.cfg.maxPlay, me.hand.length);
  // 贪心:有一定概率放弃诚实,改成多报几张(赌对手不敢质疑)
  const wantGreed = kH > 0 && junk.length > 0 && rng ? rng.next() < opts.greed : false;
  if (kH > 0 && !wantGreed) return { type: "PLAY", seat, cardIds: honest.slice(0, kH).map((c) => c.id) };
  if (kH > 0 && wantGreed) {
    const extra = Math.min(st.cfg.maxPlay - kH, junk.length, opts.maxLie);
    if (extra > 0) return { type: "PLAY", seat, cardIds: [...honest.slice(0, kH).map((c) => c.id), ...junk.slice(0, extra).map((c) => c.id)] };
    return { type: "PLAY", seat, cardIds: honest.slice(0, kH).map((c) => c.id) };
  }
  const kL = Math.max(1, Math.min(opts.maxLie, st.cfg.maxPlay, junk.length || me.hand.length));
  const junkIds = (junk.length ? junk : me.hand).slice(0, kL).map((c) => c.id);
  return { type: "PLAY", seat, cardIds: junkIds };
}

/** 随机型(基线) */
export function randomDecide(st: BluffState, seat: number, rng: Rng): BluffAction {
  const me = st.seats[seat];
  if (st.pending && st.pending.seat !== seat && rng.next() < 0.3) return { type: "CHALLENGE", seat };
  const k = Math.max(1, Math.min(1 + Math.floor(rng.next() * st.cfg.maxPlay), me.hand.length));
  const pool = me.hand.slice();
  const ids: string[] = [];
  for (let i = 0; i < k && pool.length; i++) ids.push(pool.splice(Math.floor(rng.next() * pool.length), 1)[0].id);
  return { type: "PLAY", seat, cardIds: ids };
}