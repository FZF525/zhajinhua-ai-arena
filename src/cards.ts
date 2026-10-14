// 牌堆与花色:13 点数 × 8 花色 = 104 张,8 花色分 4 色系(§2)

export type ColorFamily = "RED" | "BLACK" | "BLUE" | "GOLD";

export type SuitId =
  | "HEART" | "DIAMOND"   // 红
  | "SPADE" | "CLUB"      // 黑
  | "SNOW" | "DROPLET"    // 蓝
  | "STAR" | "MOON";      // 金

export interface SuitDef {
  id: SuitId;
  family: ColorFamily;
  symbol: string;
  color: string;
  bg: string;
  cn: string;
}

export const SUITS: readonly SuitDef[] = [
  { id: "HEART",   family: "RED",   symbol: "\u2665",  color: "#FF0000", bg: "#FFFFFF", cn: "红心" },
  { id: "DIAMOND", family: "RED",   symbol: "\u2666",  color: "#FF0000", bg: "#FFFFFF", cn: "方块" },
  { id: "SPADE",   family: "BLACK", symbol: "\u2660",  color: "#000000", bg: "#FFFFFF", cn: "黑桃" },
  { id: "CLUB",    family: "BLACK", symbol: "\u2663",  color: "#000000", bg: "#FFFFFF", cn: "梅花" },
  // 末尾的 \uFE0E 是"文本呈现"变体选择符:这几个码点默认按 emoji 渲染(全宽、彩色),
  // 会让"符号 + 10"在卡片里换行;加 VS15 后与 ♠♥♦♣ 一样是窄的文本符号(实测差一倍宽度)
  { id: "SNOW",    family: "BLUE",  symbol: "\u2744\uFE0E",    color: "#0077FF", bg: "#D6E9FF", cn: "雪花" },
  { id: "DROPLET", family: "BLUE",  symbol: "\u{1F4A7}\uFE0E", color: "#0077FF", bg: "#EAF4FF", cn: "水滴" },
  { id: "STAR",    family: "GOLD",  symbol: "\u2B50\uFE0E",    color: "#FFB300", bg: "#FFF3D6", cn: "星" },
  { id: "MOON",    family: "GOLD",  symbol: "\u{1F319}\uFE0E", color: "#FFB300", bg: "#E8E8E8", cn: "月牙" }
];

export const FAMILY_LABEL: Record<ColorFamily, string> = {
  RED: "红", BLACK: "黑", BLUE: "蓝", GOLD: "金"
};

export const FAMILIES: readonly ColorFamily[] = ["RED", "BLACK", "BLUE", "GOLD"];

/** 点数 2..14(A=14);A 亦可作 1 用于低顺 */
export const RANKS: readonly number[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

export interface Card {
  id: string;         // 例:"HEART-A" / "SNOW-10"
  rank: number;       // 2..14
  suit: SuitId;
  family: ColorFamily;
}

const SUIT_BY_ID: Record<string, SuitDef> = Object.fromEntries(SUITS.map((s) => [s.id, s]));

export function rankLabel(rank: number): string {
  if (rank === 14) return "A";
  if (rank === 13) return "K";
  if (rank === 12) return "Q";
  if (rank === 11) return "J";
  return String(rank);
}

export function parseRank(label: string): number {
  const up = label.trim().toUpperCase();
  if (up === "A") return 14;
  if (up === "K") return 13;
  if (up === "Q") return 12;
  if (up === "J") return 11;
  const n = Number(up);
  if (!Number.isInteger(n) || n < 2 || n > 10) throw new Error("非法点数: " + label);
  return n;
}

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ id: suit.id + "-" + rankLabel(rank), rank, suit: suit.id, family: suit.family });
    }
  }
  return deck;
}

export function cardById(id: string): Card {
  const dash = id.indexOf("-");
  if (dash < 0) throw new Error("非法 cardId: " + id);
  const suitId = id.slice(0, dash).toUpperCase();
  const suit = SUIT_BY_ID[suitId];
  if (!suit) throw new Error("非法花色: " + id);
  const rank = parseRank(id.slice(dash + 1));
  return { id: suit.id + "-" + rankLabel(rank), rank, suit: suit.id, family: suit.family };
}

/** 便捷构造:cardsFromIds(["HEART-A","SPADE-K"]) */
export function cardsFromIds(ids: string[]): Card[] {
  return ids.map(cardById);
}

export function cardText(c: Card): string {
  const s = SUIT_BY_ID[c.suit];
  return s.symbol + rankLabel(c.rank);
}

export function handText(cards: readonly Card[]): string {
  return cards.map(cardText).join(" ");
}
