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
}

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
  pileOf: Record<number, number>;            // 牌堆里各点数实际张数
  perSeat: Array<{ seat: number; name: string; claims: number; cards: number; lies: number; biggestLie: number }>;
}

export interface BluffPending { seat: number; cards: Card[]; declaredRank: number }

export interface BluffState {
  cfg: BluffConfig;
  seats: BluffSeat[];
  deck: Card[];
  wildRank: number;              // 本局癞子点数(公开;每局重抽)
  roundRank: number;             // 本回合抽到的点数(公开;每回合重抽)
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