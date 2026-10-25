// 八门拱猪·星月版 —— 状态与配置
//
// 【关键理解】**"八门" = 本牌的 8 个花色** ✓
//   HEART 红心 / DIAMOND 方块 / SPADE 黑桃 / CLUB 梅花 / SNOW 雪花 / DROPLET 水滴 / STAR 星 / MOON 月牙
//   → 雪花 5/10/K = SNOW-5/10/13;水滴 9 = DROPLET-9;星星 8 = STAR-8;月牙 8 = MOON-8
//   → 红桃 = HEART 花色(13 张);牌堆 104 张,4 人各 26 张
// 【仍未定义、不得自行填补】雪花分值、全红奖励、亮出时机(见 ambiguities 上报)
import type { Card } from "../../cards.ts";

export interface ZhupigSpecials {
  pig: { id: string; value: number };               // 经典:SPADE-12(-100)
  sheep: { id: string; value: number };             // 经典:DIAMOND-11(+100)
  transformer: { id: string; mul: number; mulLit: number; flat: number; flatLit: number };  // CLUB-10
  snow: Array<{ id: string; value: number; valueLit: number }>;   // SNOW-5/10/13  ← 分值待作者确认
  water9: { id: string };                            // DROPLET-9
  star8: { id: string; selfDark: number; selfLit: number; cutDark: number; cutLit: number };  // STAR-8 砍后继
  moon8: { id: string; selfDark: number; selfLit: number; cutDark: number; cutLit: number };  // MOON-8 砍前驱
  /** 红桃(HEART 花色)按点数的分值 —— 待作者确认;这里用经典拱猪表 */
  hearts: Record<number, number>;                    // rank 2..14
  allRedBonus: number;                               // 全红奖励 —— 待作者确认
  full16Bonus: number;                               // 原16 齐全 +800(**在公式之前**加到个人分)
}

export interface ZhupigConfig { players: 4; specials: ZhupigSpecials; formulaMul: number; }

export interface ZpPlay { seat: number; card: Card; revealed: boolean; }
export interface ZpTrick { ledSuit: string; plays: ZpPlay[]; winner: number | null; }

export interface ZhupigState {
  cfg: ZhupigConfig;
  seats: Array<{ seat: number; name: string; hand: Card[]; pile: ZpPlay[] }>;
  trick: ZpTrick;
  lastTrick: ZpTrick | null;
  leader: number; turn: number; trickNo: number;
  discard: Card[];
  over: boolean;
  ledger: string[];
}

/** 经典红桃分值(rank 2..14):A50 K40 Q30 J20 10~5 各10 4~2 各0 —— **待作者确认** */
export const CLASSIC_HEARTS: Record<number, number> = {
  14: 50, 13: 40, 12: 30, 11: 20, 10: 10, 9: 10, 8: 10, 7: 10, 6: 10, 5: 10, 4: 0, 3: 0, 2: 0,
};

export const CLASSIC_ZHUPIG: ZhupigConfig = {
  players: 4,
  formulaMul: 3,
  specials: {
    pig: { id: "SPADE-Q", value: -100 },
    sheep: { id: "DIAMOND-J", value: 100 },
    transformer: { id: "CLUB-10", mul: 2, mulLit: 4, flat: 50, flatLit: 100 },
    snow: [
      { id: "SNOW-5", value: 0, valueLit: 0 },     // TODO 分值待作者确认
      { id: "SNOW-10", value: 0, valueLit: 0 },    // TODO
      { id: "SNOW-K", value: 0, valueLit: 0 },    // TODO
    ],
    water9: { id: "DROPLET-9" },
    star8: { id: "STAR-8", selfDark: -25, selfLit: -50, cutDark: 1, cutLit: 2 },
    moon8: { id: "MOON-8", selfDark: -25, selfLit: -50, cutDark: 1, cutLit: 2 },
    hearts: CLASSIC_HEARTS,
    allRedBonus: 0,                                // TODO 待作者确认
    full16Bonus: 800,
  },
};

/** 点数显示(2..14) */
/** 面值标签 → 数值(A=14,K=13,Q=12,J=11,其余数字) */
export function rankValue(label: string): number {
  const face: Record<string, number> = { A: 14, K: 13, Q: 12, J: 11 };
  if (face[label] !== undefined) return face[label];
  const n = Number(label);
  return Number.isFinite(n) ? n : NaN;
}

export function rankLabel(r: number): string {
  return r <= 10 ? String(r) : ({ 11: "J", 12: "Q", 13: "K", 14: "A" } as Record<number, string>)[r] ?? String(r);
}
