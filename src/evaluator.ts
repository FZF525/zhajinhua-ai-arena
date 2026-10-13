// 12 档牌型判定与比较(§3,方案 B:同花按花色、同色按色系)
// 判定顺序即优先级,第一个命中即为最终牌型;tier 12..1 与 §3.1 表一一对应。

import { createDeck } from "./cards.ts";
import type { Card } from "./cards.ts";

export type HandCategory =
  | "STRAIGHT_FLUSH"      // 12 同花顺:同花色 + 连续
  | "FIVE_OF_A_KIND"      // 11 五条
  | "SAME_COLOR_STRAIGHT" // 10 同色顺:同色系 + 连续,非同花色
  | "FLUSH"               //  9 同花:同花色,非连续
  | "FOUR_OF_A_KIND"      //  8 四条
  | "FULL_HOUSE"          //  7 葫芦
  | "SAME_COLOR"          //  6 同色:同色系,非同花色、非连续
  | "STRAIGHT"            //  5 顺子:连续,非同色系
  | "THREE_OF_A_KIND"     //  4 三条
  | "TWO_PAIR"            //  3 两对
  | "ONE_PAIR"            //  2 一对
  | "HIGH_CARD";          //  1 高牌

export const TIER: Record<HandCategory, number> = {
  STRAIGHT_FLUSH: 12,
  FIVE_OF_A_KIND: 11,
  SAME_COLOR_STRAIGHT: 10,
  FLUSH: 9,
  FOUR_OF_A_KIND: 8,
  FULL_HOUSE: 7,
  SAME_COLOR: 6,
  STRAIGHT: 5,
  THREE_OF_A_KIND: 4,
  TWO_PAIR: 3,
  ONE_PAIR: 2,
  HIGH_CARD: 1
};

export const CATEGORY_LABEL: Record<HandCategory, string> = {
  STRAIGHT_FLUSH: "同花顺",
  FIVE_OF_A_KIND: "五条",
  SAME_COLOR_STRAIGHT: "同色顺",
  FLUSH: "同花",
  FOUR_OF_A_KIND: "四条",
  FULL_HOUSE: "葫芦",
  SAME_COLOR: "同色",
  STRAIGHT: "顺子",
  THREE_OF_A_KIND: "三条",
  TWO_PAIR: "两对",
  ONE_PAIR: "一对",
  HIGH_CARD: "高牌"
};

export interface HandValue {
  category: HandCategory;
  tier: number;
  key: number[];
  isRoyalFlush: boolean;
}

const CARD_INDEX = new Map<string, number>();
createDeck().forEach((c, i) => CARD_INDEX.set(c.id, i));

const scratch = new Uint8Array(15);
const idSeen = new Uint8Array(104);

function straightHigh(sorted: readonly number[]): number | null {
  if (sorted.length !== 5) return null;
  if (sorted[0] === 2 && sorted[1] === 3 && sorted[2] === 4 && sorted[3] === 5 && sorted[4] === 14) return 5; // 钢轮 A2345
  for (let i = 1; i < 5; i++) if (sorted[i] !== sorted[i - 1] + 1) return null;
  return sorted[4];
}

export function evaluate(cards: readonly Card[]): HandValue {
  if (cards.length !== 5) throw new Error("牌型判定需要恰好 5 张牌,收到 " + cards.length);
  scratch.fill(0);
  let dup = false;
  for (const c of cards) {
    const idx = CARD_INDEX.get(c.id);
    if (idx === undefined) throw new Error("未知卡牌: " + c.id);
    if (idSeen[idx] === 1) dup = true;
    idSeen[idx] = 1;
    scratch[c.rank] += 1;
  }
  for (const c of cards) idSeen[CARD_INDEX.get(c.id)!] = 0;
  if (dup) throw new Error("重复卡牌");


  const groups: Array<{ rank: number; n: number }> = [];
  for (let r = 14; r >= 2; r--) if (scratch[r] > 0) groups.push({ rank: r, n: scratch[r] });
  groups.sort((a, b) => (b.n - a.n) || (b.rank - a.rank));

  const n5 = groups.filter((g) => g.n === 5).length;
  const n4 = groups.filter((g) => g.n === 4).length;
  const n3 = groups.filter((g) => g.n === 3).length;
  const n2 = groups.filter((g) => g.n === 2).length;
  const distinct = groups.map((g) => g.rank).sort((a, b) => a - b);
  const high = straightHigh(distinct);
  const isStraight = high !== null;

  const allSameSuit = cards.every((c) => c.suit === cards[0].suit);
  const allSameFamily = cards.every((c) => c.family === cards[0].family);
  const desc = groups.map((g) => g.rank); // 已按 n 降序、rank 降序

  const mk = (category: HandCategory, key: number[], royal = false): HandValue => ({
    category, tier: TIER[category], key, isRoyalFlush: royal
  });

  // 顺序即优先级(§3.2)
  if (allSameSuit && isStraight) return mk("STRAIGHT_FLUSH", [high], high === 14);
  if (n5 === 1) return mk("FIVE_OF_A_KIND", [groups[0].rank]);
  if (allSameFamily && isStraight) return mk("SAME_COLOR_STRAIGHT", [high]);
  if (allSameSuit) return mk("FLUSH", desc);
  if (n4 === 1) return mk("FOUR_OF_A_KIND", [groups[0].rank, groups[1].rank]);
  if (n3 === 1 && n2 === 1) return mk("FULL_HOUSE", [groups[0].rank, groups[1].rank]);
  if (allSameFamily) return mk("SAME_COLOR", desc);
  if (isStraight) return mk("STRAIGHT", [high]);
  if (n3 === 1) return mk("THREE_OF_A_KIND", [groups[0].rank, groups[1].rank, groups[2].rank]);
  if (n2 === 2) return mk("TWO_PAIR", [groups[0].rank, groups[1].rank, groups[2].rank]);
  if (n2 === 1) return mk("ONE_PAIR", desc);
  return mk("HIGH_CARD", desc);
}

/** -1 / 0 / 1 */
export function compare(a: HandValue, b: HandValue): number {
  if (a.tier !== b.tier) return a.tier > b.tier ? 1 : -1;
  const n = Math.max(a.key.length, b.key.length);
  for (let i = 0; i < n; i++) {
    const x = a.key[i] ?? -Infinity;
    const y = b.key[i] ?? -Infinity;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

export function describe(v: HandValue): string {
  const label = CATEGORY_LABEL[v.category];
  const key = v.key.map((r) => (r === undefined ? "" : rankText(r))).filter(Boolean).join(" ");
  const royal = v.isRoyalFlush ? "(皇家)" : "";
  return label + royal + " [" + key + "]";
}

function rankText(r: number): string {
  if (r === 14) return "A";
  if (r === 13) return "K";
  if (r === 12) return "Q";
  if (r === 11) return "J";
  return String(r);
}
