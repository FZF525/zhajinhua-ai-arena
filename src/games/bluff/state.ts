// 唬牌(Bluff / 吹牛)状态与配置
// 规则见对话定稿:4 人 × 26 张全发;开局抽 1 个癞子点数(每局重抽);
// 每回合抽 1 个非癞子点数;出 1~5 张扣牌宣告;下家可质疑;质疑后仍是下家出牌(循环不破);
// 不能过牌;出空手牌赢,或有人 > 40 张提前结束;统一按与平均剩牌数的差值零和结算
import { createDeck } from "../../cards.ts";
import type { Card } from "../../cards.ts";
import { createRng } from "../../rng.ts";
import type { Rng } from "../../rng.ts";

export interface BluffConfig {
  players: number;
  handSize: number;
  maxPlay: number;
  bustCards: number;
  rate: number;
  handsPerMatch: number;
  /** 抽点数方式:one = 每回合抽 1 个(现状);choose3 = 抽 3 个由出牌者选 1(把运气变成选择) */
  drawMode?: "one" | "choose3";
}

/** 两种爆牌线(作者定的两种玩法):紧 = 40 张,松 = 52 张(= 两副手牌量)*/
export const BLUFF_BUST_MODES = { tight: 40, loose: 52 } as const;
export type BluffBustMode = keyof typeof BLUFF_BUST_MODES;

export const DEFAULT_BLUFF_CONFIG: BluffConfig = {
  players: 4, handSize: 26, maxPlay: 5, bustCards: 40, rate: 1, handsPerMatch: 4,
};

export interface BluffSeat { seat: number; name: string; hand: Card[]; points: number }

/** 刚出的那一手:扣着,等下一次决策(下家出牌=并入牌堆;下家质疑=翻牌判定) */
/** 一手的申报记录:谁、报了几张、其中几张是真的(局末展览 + AI 学习都靠它) */
export interface BluffClaim { seat: number; handNo: number; claimedRank: number; count: number; honest: number }

/** 局末展览:牌堆真容 + 每人的谎话账本 */
export interface BluffExhibition {
  handNo: number;
  pileSize: number;
  pileOf: Record<number, number>;            // 局末牌堆里各点数实际张数(常为空:被质疑吃走了)
  /** 哪几次质疑、谁吃掉了多少张(牌堆「去向」)—— 牌堆空掉时就看这里 */
  eaten: Array<{ by: number; against: number; honest: boolean; eater: number; pot: number }>;
  /** 整局每一手的真假时间线(局末才公开,用于复盘与信誉) */
  timeline: Array<{ seat: number; count: number; declared: number; honest: number }>;
  perSeat: Array<{ seat: number; name: string; claims: number; cards: number; lies: number; biggestLie: number }>;
}

export interface BluffPending { seat: number; cards: Card[]; declaredRank: number }

export interface BluffState {
  cfg: BluffConfig;
  seats: BluffSeat[];
  deck: Card[];
  wildRank: number;              // 本局癞子点数(公开;每局重抽)
  roundRank: number;             // 本回合的点数(公开;每回合重抽)
  candidates: number[];          // 本回合的可选点数(choose3 模式 3 个;one 模式就是 1 个)

  pile: Card[];                  // 已压进牌堆的牌(内容不可见,只公开张数)
  pending: BluffPending | null;
  turn: number;
  dealer: number;
  handNo: number;
  matchNo: number;
  lastScores: number[];          // 上一局结算(零和)
  claims: BluffClaim[];                       // 本局所有申报(含真假统计)
  exhibition: BluffExhibition | null;         // 上一局的展览
  events: Array<{ kind: string } & Record<string, unknown>>;
  handOver: boolean;
  over: boolean;                 // 一盘结束
  winnerSeat: number | null;     // 出空手牌者
  bustedSeat: number | null;     // > bustCards 者
  seed: number;
  rng: Rng;
}

export const RANK_TEXT: Record<number, string> = { 11: "J", 12: "Q", 13: "K", 14: "A" };

/** 取点数(兼容卡片的几种字段写法) */
export function rankOf(c: Card): number {
  const x = c as unknown as { rankNum?: number; rank?: number; label?: string; id: string };
  if (typeof x.rankNum === "number") return x.rankNum;
  if (typeof x.rank === "number") return x.rank;
  const label = x.label ?? x.id.split("-")[1] ?? "";
  return RANK_TEXT[label] === undefined ? Number(label) : Number(label);
}

/** 点数显示(J/Q/K/A 更好看) */
export function rankText(r: number): string { return RANK_TEXT[r] ?? String(r); }

/** 癞子可当任意点数 */
export function isHonestCard(c: Card, declaredRank: number, wildRank: number): boolean {
  const r = rankOf(c);
  return r === declaredRank || r === wildRank;
}

/** 只构造,不自动发牌 —— 忘了紧接着调 startHand 会得到“全员 0 张”的死状态;
 * 绝大多数场景请用 rules.ts 的 newBluffGame(它替你发好牌) */
export function createBluffGame(cfg: BluffConfig, names: string[], seed: number): BluffState {
  if (names.length !== cfg.players) throw new Error("座位数与配置不符");
  const st: BluffState = {
    cfg,
    seats: names.map((name, seat) => ({ seat, name, hand: [], points: 0 })),
    deck: [],
    wildRank: 0,
    roundRank: 0,
    pile: [],
    pending: null,
    turn: 0,
    dealer: -1,
    handNo: 0,
    matchNo: 1,
    lastScores: names.map(() => 0),
    claims: [],
    exhibition: null,
    events: [],
    handOver: false,
    over: false,
    winnerSeat: null,
    bustedSeat: null,
    seed,
    rng: createRng(seed),
  };
  return st;
}

/** 牌总数守恒:手牌 + 牌堆 + 待判定那一手 = 104 */
export function cardCount(st: BluffState): number {
  return st.seats.reduce((s, p) => s + p.hand.length, 0) + st.pile.length + (st.pending ? st.pending.cards.length : 0);
}

/** 只公开张数的信息(UI/日志/对手建模都能用) */
/** 把局末展览渲染成多行文本(纯日志展示,不计分) */
export function describeExhibition(st: BluffState): string {
  const ex = st.exhibition;
  if (!ex) return "本局没有展览";
  const lines: string[] = [];
  const nameOf = (s: number) => st.seats[s]?.name ?? ("座位" + s);
  lines.push("本局展览(不计分):局末牌堆 " + ex.pileSize + " 张");
  const ranks = Object.entries(ex.pileOf).map(([r, n]) => rankText(Number(r)) + "×" + n).join(" ");
  lines.push("  牌堆真容: " + (ranks || "(空 —— 最后那次质疑把整堆吃走了,去向见下)"));
  if (ex.eaten.length) {
    lines.push("  ── 牌堆去向 ──");
    for (const c of ex.eaten) {
      lines.push("  " + nameOf(c.by) + " 质疑 " + nameOf(c.against) + (c.honest ? ":猜错了 ✗" : ":猜对了 ✓") + " → " + nameOf(c.eater) + " 吃下 " + c.pot + " 张");
    }
  }
  lines.push("  ── 这一局每个人说了什么 ──");
  for (const p of ex.perSeat) {
    lines.push("  " + p.name + ": 报了 " + p.claims + " 手 / 出 " + p.cards + " 张,其中假牌 " + p.lies +
      " 张(最大一谎 " + p.biggestLie + " 张)");
  }
  if (ex.timeline.length) {
    lines.push("  ── 逐手回顾(局末才公开)──");
    const seq = ex.timeline.map((c, i) => (i + 1) + "." + nameOf(c.seat).slice(0, 6) + "出" + c.count + "报" + rankText(c.declared) + (c.honest === c.count ? "真✓" : (c.honest === 0 ? "假✗" : "半真半假")));
    lines.push("  " + seq.join("  "));
  }
  return lines.join(String.fromCharCode(10));
}

export function publicView(st: BluffState) {
  return {
    handNo: st.handNo,
    matchNo: st.matchNo,
    turn: st.turn,
    dealer: st.dealer,
    wildRank: st.wildRank,
    wildText: rankText(st.wildRank),
    roundRank: st.roundRank,
    roundText: rankText(st.roundRank),
    pileCount: st.pile.length,
    pending: st.pending ? { seat: st.pending.seat, count: st.pending.cards.length, declaredRank: st.pending.declaredRank } : null,
    seats: st.seats.map((p) => ({ seat: p.seat, name: p.name, cards: p.hand.length, points: p.points })),
  };
}