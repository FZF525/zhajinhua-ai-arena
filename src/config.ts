// 全局配置(§4):引擎内零魔法数字,全部规则参数可配置。
import type { HandCategory } from "./evaluator.ts";

export interface GameConfig {
  version: string;
  deck: { ranks: number[]; perRankCopies: number; jokers: number };
  players: { min: number; max: number; handSize: number; startPoints: number };
  pool: { openCards: number };
  ante: { amount: number; scaledByMultiplier: boolean };
  betting: {
    baseMultiplier: number;
    ladder: number[];
    seenRate: number;
    blindRate: number;
    postCapRoundsToShowdown: number;
    autoCompareWhenTwoLeft: boolean;
  };
  exchange: { maxPerHand: number; fees: number[]; allowSelfReclaim: boolean };
  intercept: {
    maxPerCard: number;
    maxPerHand: number;
    adjacentOnly: boolean;
    swapFeePaidIsSnapshot: boolean;
    allowRetakeByIntercepted: boolean;
    cascadeDepthLimit: number;
  };
  kick: { maxPerHand: number; fee: number; requireNeverSelected: boolean };
  /** 弃牌后手牌是否对所有人公开(方便算牌);关闭则视为"盖牌" */
  fold: { revealToAll: boolean };
  compare: {
    enabled: boolean;
    costMultiplier: number;
    anyOpponent: boolean;
    oncePerTurn: boolean;
    blindMinBettingRounds: number;
    blindCompareBreaksBlind: boolean;
    loserFolds: boolean;
    tieBehavior: "CONTINUE";
    tieEndWhenAllTied: boolean;
    tieEndSplitsPot: boolean;
    revealToOutsiders: boolean;
    maxPerHand: number | null;
  };
  showdown: { tieRemainderTo: "FIRST_SEAT" | "CARRY_TO_NEXT_POT" };
  endGame: {
    bustAtOrBelow: number;
    winAtOrAbove: number;
    winTakesPriorityOverBust: boolean;
    /** 整场最多打几局;null = 不限。到点按积分排名结束(优先级低于阈值与破产) */
    maxHands: number | null;
  };
  handRanking: HandCategory[];
}

export const DEFAULT_CONFIG: GameConfig = {
  version: "1.0.0",
  deck: { ranks: [2,3,4,5,6,7,8,9,10,11,12,13,14], perRankCopies: 8, jokers: 0 },
  players: { min: 2, max: 6, handSize: 5, startPoints: 20000 },
  pool: { openCards: 7 },
  ante: { amount: 1, scaledByMultiplier: false },
  betting: {
    baseMultiplier: 1,
    ladder: [2, 4, 8, 16, 32],
    seenRate: 2,
    blindRate: 1,
    postCapRoundsToShowdown: 2,
    autoCompareWhenTwoLeft: false
  },
  exchange: { maxPerHand: 3, fees: [1, 3, 10], allowSelfReclaim: false },
  intercept: {
    maxPerCard: 3,
    maxPerHand: 5,
    adjacentOnly: true,
    swapFeePaidIsSnapshot: true,
    allowRetakeByIntercepted: true,
    cascadeDepthLimit: 5
  },
  kick: { maxPerHand: 1, fee: 8, requireNeverSelected: true },
  fold: { revealToAll: true },
  compare: {
    enabled: true,
    costMultiplier: 2,
    anyOpponent: true,
    oncePerTurn: true,
    blindMinBettingRounds: 3,
    blindCompareBreaksBlind: false,
    loserFolds: true,
    tieBehavior: "CONTINUE",
    tieEndWhenAllTied: true,
    tieEndSplitsPot: true,
    revealToOutsiders: false,
    maxPerHand: null
  },
  showdown: { tieRemainderTo: "FIRST_SEAT" },
  endGame: { bustAtOrBelow: 0, winAtOrAbove: 40000, winTakesPriorityOverBust: true, maxHands: 20 },
  handRanking: [
    "STRAIGHT_FLUSH", "FIVE_OF_A_KIND", "SAME_COLOR_STRAIGHT", "FLUSH",
    "FOUR_OF_A_KIND", "FULL_HOUSE", "SAME_COLOR", "STRAIGHT",
    "THREE_OF_A_KIND", "TWO_PAIR", "ONE_PAIR", "HIGH_CARD"
  ]
};

/** 旧稿对照预设(不采用):初始 8000 / 阈值 16000 */
export const LEGACY_PRESET_8000_16000: Partial<GameConfig> = {
  players: { min: 2, max: 6, handSize: 5, startPoints: 8000 },
  endGame: { bustAtOrBelow: 0, winAtOrAbove: 16000, winTakesPriorityOverBust: true, maxHands: 20 }
};

type Plain = Record<string, unknown>;

function isPlain(v: unknown): v is Plain {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function merge<T>(base: T, patch: unknown): T {
  if (!isPlain(patch)) return base;
  const out: Plain = Array.isArray(base) ? {} : { ...(base as unknown as Plain) };
  for (const [k, v] of Object.entries(patch)) {
    const cur = (base as unknown as Plain)[k];
    out[k] = isPlain(cur) && isPlain(v) ? merge(cur, v) : v;
  }
  return out as unknown as T;
}

export function makeConfig(patch?: unknown): GameConfig {
  return merge(DEFAULT_CONFIG, patch);
}

/** 深度合并任意基准配置(供 makeConfig / scaleEconomy 复用) */
export function mergeConfig<T>(base: T, patch: unknown): T {
  return merge(base, patch);
}

/**
 * 整体等比缩放"费用表"——底注 / 跟注基准(看牌·闷牌)/ 换牌费 / 踢牌费 同乘 k。
 * 只放大其中一项(例如只抬底注)会破坏费用之间的比例,让下注/换牌/踢牌退化成零头;
 * 整体等比缩放则等价于把初始积分缩小 k 倍,机制权重完全不变(见 README 平衡性实测)。
 */
export function scaleEconomy(base: GameConfig, k: number): GameConfig {
  if (!(k > 0)) throw new Error("缩放系数必须为正");
  const r = (x: number): number => Math.max(1, Math.round(x * k));
  return mergeConfig(base, {
    ante: { amount: r(base.ante.amount) },
    betting: { seenRate: r(base.betting.seenRate), blindRate: r(base.betting.blindRate) },
    exchange: { fees: base.exchange.fees.map(r) },
    kick: { fee: r(base.kick.fee) }
  });
}

export function validateConfig(cfg: GameConfig): string[] {
  const errs: string[] = [];
  if (cfg.players.handSize !== 5) errs.push("handSize 必须为 5(判定器只支持 5 张)");
  if (cfg.pool.openCards < 1) errs.push("openCards 必须 >= 1");
  if (cfg.players.max * cfg.players.handSize + cfg.pool.openCards > 104) errs.push("人数 × 手牌 + 公共池 超过 104 张");
  if (cfg.betting.ladder.length === 0) errs.push("ladder 不能为空");
  if (cfg.betting.ladder.some((v, i, a) => i > 0 && v <= a[i - 1])) errs.push("ladder 必须严格递增");
  if (cfg.exchange.fees.length < cfg.exchange.maxPerHand) errs.push("exchange.fees 长度不足 maxPerHand");
  if (cfg.handRanking.length !== 12) errs.push("handRanking 必须为 12 档");
  if (cfg.endGame.maxHands !== null && cfg.endGame.maxHands < 1) errs.push("endGame.maxHands 必须 >= 1 或为 null");
  if (cfg.endGame.winAtOrAbove <= cfg.players.startPoints) errs.push("winAtOrAbove 必须高于初始积分,否则开局即终局");
  return errs;
}

/** 分场档位:同一套规则、不同"货币刻度"(整体等比缩放费用表) */
export type TableSize = "small" | "big";

export const TABLE_PRESETS: Record<TableSize, { label: string; scale: number }> = {
  small: { label: "小分场", scale: 10 },   // 底注 10 / 跟注 20·10 / 换牌 10-30-100 / 踢牌 80  → 6 人约 47 局
  big: { label: "大分场", scale: 25 }      // 底注 25 / 跟注 50·25 / 换牌 25-75-250 / 踢牌 200 → 6 人约 9 局
};

/**
 * 按分场档位生成配置:先合并额外覆盖项,再对整张费用表做等比缩放。
 * 注意:extra 里不要放费用字段(底注 / 跟注基准 / 换牌费 / 踢牌费),否则会被一起缩放。
 */
export function makeTableConfig(size: TableSize, extra?: unknown): GameConfig {
  const preset = TABLE_PRESETS[size];
  if (!preset) throw new Error("未知分场: " + size);
  return scaleEconomy(makeConfig(extra), preset.scale);
}

/** 实测拟合:目标约 40 局/场时各人数推荐的缩放系数(人数越多、底池越大,所需 k 越小) */
export const SCALE_BY_PLAYERS: Record<number, number> = { 2: 70, 3: 40, 4: 25, 5: 16, 6: 10 };

export function suggestScale(playerCount: number): number {
  const exact = SCALE_BY_PLAYERS[playerCount];
  if (exact) return exact;
  return playerCount < 2 ? 70 : 10;
}

/** 按人数自动选档:目标"约 40 局一场" */
export function makeBalancedConfig(playerCount: number, extra?: unknown): GameConfig {
  return scaleEconomy(makeConfig(extra), suggestScale(playerCount));
}
