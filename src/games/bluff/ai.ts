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
import { isHonestCard, rankOf } from "./state.ts";
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
  /** 学习强度:结构模型与实测账本的融合权重(越大越信结构模型)。默认 6 */
  learnAlpha?: number;
}

export const DEFAULT_EXCEL: BluffAiOptions = {
  challengeAt: 0.55, maxLie: 2, maxHonest: 5, greed: 0.1, bustFear: 1.6, oppBluffSize: 1,
};

/** 四位 AI 的名字(作者命名):Lao6 赌徒 / Bajiao 标准 / Nizi 试探 / Nannan 老实人 */
export const BLUFF_NAMES = ["Lao6", "Bajiao", "Nizi", "Nannan", "Xiaozhen"] as const;
/** 三种现成性格:保守(老实人)/ 标准 / 激进(赌徒) */
export const BLUFF_PERSONAS: Record<string, BluffAiOptions> = {
  // 【Caocao 曹操】数据发现的性格(名字由作者定):40 组随机参数 × 60 盘 → 400 盘复核选出的最优组 ✓
  //   画像:**多疑(0.38 全场最爱质疑)+ 略贪(0.16)+ 不怕爆(1.26)+ 敢出满 5 张** —— 与"谨慎精准"相反 ✓
  //   来历:不是手拍,是数据长出来的 ✓(+36.7 分/盘,t=14.71,夺冠 63%)
  //   参数 0.38 / 0.16 / 2 / 5 / 1.26 → +36.7 分/盘(t=14.71,夺冠 63%),明显强于手拍的小针(+13.8)
  //   画像:**多质疑(0.38)+ 略贪(0.16)+ 不怕爆(1.26)+ 敢出满 5 张** —— 和"谨慎精准"正好相反 ✓
  //   名字待作者定;先用 discovered 作为占位 ✓
  Caocao: { challengeAt: 0.38, greed: 0.16, maxLie: 2, maxHonest: 5, bustFear: 1.26, oppBluffSize: 1 },
  // 小针:精准狙击 —— 手拍参数(作者原始设计),实测只有 +13.8 分/盘,保留作为"设计型基线"

  Xiaozhen: { challengeAt: 0.78, maxLie: 2, maxHonest: 5, greed: 0, bustFear: 1.8, oppBluffSize: 1 },
  // 老六:偷鸡阴人的那位 —— 敢谎报 5 张、敢质疑、不怕爆
  Lao6: { challengeAt: 0.35, maxLie: 5, maxHonest: 5, greed: 0.6, bustFear: 1.1, oppBluffSize: 3 },
  // 芭蕉:稳扎稳打的标准打法
  Bajiao: { ...DEFAULT_EXCEL },
  // 妮子:多疑但不贪 —— 爱管闲事、动不动要看牌
  Nizi: { challengeAt: 0.42, maxLie: 3, maxHonest: 4, greed: 0.25, bustFear: 1.3, oppBluffSize: 2 },
  // 囡囡:几乎不质疑、从不说谎 —— 最好骗的那位
  Nannan: { challengeAt: 0.8, maxLie: 1, maxHonest: 3, greed: 0, bustFear: 2.0, oppBluffSize: 1 },
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
    // 质疑是有赌注的:+win / -fee → 只在 pCheat > fee/(win+fee) 时才划算(精确盈亏平衡点)
    const win = Math.max(0, st.cfg.challengeWin ?? 0);
    const fee = Math.max(0, st.cfg.challengeFee ?? 0);
    const breakEven = win + fee > 0 ? fee / (win + fee) : 0;
    const threshold = Math.max(opts.challengeAt, breakEven) * (willBust ? opts.bustFear : 1.0);
    if (pCheat > threshold) return { type: "CHALLENGE", seat };
  }
  // ② 出牌
  const pick = st.candidates.length > 1 ? pickBestCandidate(st, seat) : (st.candidates[0] ?? st.roundRank);
  const honest = me.hand.filter((c) => isHonestCard(c, pick, st.wildRank));
  const junk = me.hand.filter((c) => !isHonestCard(c, pick, st.wildRank));
  const kH = Math.min(honest.length, opts.maxHonest, st.cfg.maxPlay, me.hand.length);
  // 贪心:有一定概率放弃诚实,改成多报几张(赌对手不敢质疑)
  const wantGreed = kH > 0 && junk.length > 0 && rng ? rng.next() < opts.greed : false;
  // 诚实出牌:出手里能当真的那几张(choose3 模式下 pick 就是自己挑的点数)
  if (kH > 0 && !wantGreed) return { type: "PLAY", seat, cardIds: honest.slice(0, kH).map((c) => c.id), declaredRank: pick };
  if (kH > 0 && wantGreed) {
    const extra = Math.min(st.cfg.maxPlay - kH, junk.length, opts.maxLie);
    if (extra > 0) return { type: "PLAY", seat, cardIds: [...honest.slice(0, kH).map((c) => c.id), ...junk.slice(0, extra).map((c) => c.id)], declaredRank: pick };
    return { type: "PLAY", seat, cardIds: honest.slice(0, kH).map((c) => c.id), declaredRank: pick };
  }
  const kL = Math.max(1, Math.min(opts.maxLie, st.cfg.maxPlay, junk.length || me.hand.length));
  const junkIds = (junk.length ? junk : me.hand).slice(0, kL).map((c) => c.id);
  return { type: "PLAY", seat, cardIds: junkIds, declaredRank: pick };
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
// ============ 自适应:用「局末展览」的账本学每个对手的真实撒谎率 ============
//
// 动机:结构模型假设「对手能诚实就诚实」→ 于是它认为报 k 张几乎必真 → 从不质疑 ✗
// 而一个 64% 谎话率的赌徒正好吃这个假设(实测 100% 夺冠 ✗)
// 修法:把「每个对手 × 每个申报张数」的真假计数记下来,用 Beta-Binomial 与结构模型融合:
//   pCheat = (实测谎话数 + α × 结构先验) / (实测申报数 + α)
// α 越大越信结构模型;观测越多越信数据 ✓
export interface AdaptiveAgent {
  opts: BluffAiOptions;
  decide(st: BluffState, seat: number, rng?: Rng): BluffAction;
  /** 局末:把展览里每个对手的每手申报真假记进统计(记自己也无所谓,不会质疑自己) */
  observeHand(st: BluffState): void;
  /** 调试/测试用:看某对手某个张数的统计 */
  statsFor(seat: number, k: number): { claims: number; lies: number };
}

export function createAdaptiveAgent(opts: BluffAiOptions = DEFAULT_EXCEL): AdaptiveAgent {
  const stats: Array<Map<number, { claims: number; lies: number }>> = [];
  const alpha = Math.max(1, opts.learnAlpha ?? 6);
  return {
    opts,
    statsFor(seat: number, k: number) {
      return stats[seat]?.get(k) ?? { claims: 0, lies: 0 };
    },
    observeHand(st: BluffState) {
      for (const c of st.claims) {
        stats[c.seat] = stats[c.seat] ?? new Map();
        const e = stats[c.seat].get(c.count) ?? { claims: 0, lies: 0 };
        e.claims += 1;
        if (c.honest < c.count) e.lies += 1;
        stats[c.seat].set(c.count, e);
      }
    },
    decide(st: BluffState, seat: number, rng?: Rng): BluffAction {
      const me = st.seats[seat];
      if (st.pending && st.pending.seat !== seat) {
        const k = st.pending.cards.length;
        const prior = cheatProbability(st, seat, k, opts);          // 结构模型
        const s = stats[st.pending.seat]?.get(k) ?? { claims: 0, lies: 0 };
        const pCheat = (s.lies + alpha * prior) / (s.claims + alpha); // Beta-Binomial 融合
        const pot = st.pile.length + k;
        const willBust = me.hand.length + pot > st.cfg.bustCards;
        const threshold = opts.challengeAt * (willBust ? opts.bustFear : 1.0);
        if (pCheat > threshold) return { type: "CHALLENGE", seat };
      }
      return excelDecide(st, seat, opts, rng);
    },
  };
}
/** choose3 模式下:从候选人里挑一个「手里真牌最多」的点数(再比谁的同点数多)*/
export function pickBestCandidate(st: BluffState, seat: number): number {
  const hand = st.seats[seat].hand;
  const list = st.candidates.length ? st.candidates : [st.roundRank];
  let best = list[0];
  let bestScore = -1;
  for (const r of list) {
    const honest = hand.filter((c) => isHonestCard(c, r, st.wildRank)).length;
    const same = hand.filter((c) => rankOf(c) === r).length;
    const score = honest * 100 + same; // 真牌数量优先,其次同点数数量
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return best;
}
// ============ Lynn:自进化(读对手 + 调自己)============
//
// 两条进化轴:
//  ① 读对手:复用自适应模型(从局末账本学每个人的真实撒谎率)—— 这部分白拿 ✓
//  ② 调自己:每打完一盘,按得分对自己的参数做一次 (1+1)-ES 式的「留优弃劣」
//     参数 = challengeAt / greed / maxLie / maxHonest / bustFear
// 不背表格、不堆策略类:炸金花的教训是「瓶颈在策略类」,所以这里只做低维自适应 ✓
export interface EvolvingAgent {
  name: string;
  opts: BluffAiOptions;
  generation: number;
  bestScore: number;
  decide(st: BluffState, seat: number, rng?: Rng): BluffAction;
  observeHand(st: BluffState): void;
  /** 一盘结束时报告本盘得分 → 决定保留还是回退这次变异 */
  endMatch(score: number): void;
  statsFor(seat: number, k: number): { claims: number; lies: number };
}

function mutateOpts(o: BluffAiOptions, rng: Rng): BluffAiOptions {
  const out = { ...o };
  const which = Math.floor(rng.next() * 5);
  const step = (v: number, lo: number, hi: number, d: number) => Math.max(lo, Math.min(hi, v + (rng.next() < 0.5 ? -d : d)));
  if (which === 0) out.challengeAt = step(o.challengeAt, 0.2, 0.9, 0.08);
  if (which === 1) out.greed = step(o.greed, 0, 0.9, 0.1);
  if (which === 2) out.maxLie = Math.max(1, Math.min(5, Math.round(step(o.maxLie, 1, 5, 1))));
  if (which === 3) out.maxHonest = Math.max(1, Math.min(5, Math.round(step(o.maxHonest, 1, 5, 1))));
  if (which === 4) out.bustFear = step(o.bustFear, 1, 3, 0.25);
  return out;
}

/** 本地小 RNG(避免为一个种子引依赖) */
function createRngLocal(seed: number): Rng {
  let s = (seed >>> 0) || 1;
  return { next() { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; } } as Rng;
}

export function createEvolvingAgent(seed = 1, rngIn?: Rng): EvolvingAgent {
  const rng = rngIn ?? createRngLocal(seed);
  let opts: BluffAiOptions = { ...DEFAULT_EXCEL };
  let agent = createAdaptiveAgent(opts);
  let bestScore = -Infinity;
  let bestAvg = -Infinity;
  const window: number[] = [];
  const WINDOW = 5;                       // 每 5 盘评估一次变异(盘数太少会全是噪声)
  let pending: BluffAiOptions | null = null;
  const self: EvolvingAgent = {
    name: "Lynn",
    get opts() { return opts; },
    generation: 0,
    get bestScore() { return bestScore; },
    decide: (st: BluffState, seat: number, r = rng) => agent.decide(st, seat, r),
    observeHand: (st: BluffState) => agent.observeHand(st),
    statsFor: (seat: number, k: number) => agent.statsFor(seat, k),
    endMatch(score: number) {
      // 单盘最好成绩在高方差游戏里几乎打不破(实测 200 盘一次都没进化)→ 改用「窗口平均」:
      // 每 WINDOW 盘评估一次:这组参数的平均成绩 ≥ 历史最好平均 → 保留变异,否则回退
      window.push(score);
      if (window.length >= WINDOW) {
        const avg = window.reduce((s, v) => s + v, 0) / window.length;
        if (avg >= bestAvg) {
          bestAvg = avg;
          bestScore = Math.max(bestScore, ...window);
          if (pending) { opts = pending; self.generation += 1; }
        }
        window.length = 0;
        agent = createAdaptiveAgent(opts);
        pending = mutateOpts(opts, rng);
      }
    },
  };
  pending = mutateOpts(opts, rng);
  return self;
}
