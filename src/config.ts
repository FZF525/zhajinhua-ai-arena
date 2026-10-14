// 全局配置(§4):引擎内零魔法数字,全部规则参数可配置。
import type { HandCategory } from "./evaluator.ts";

export interface GameConfig {
  version: string;
  deck: { ranks: number[]; perRankCopies: number; jokers: number };
  players: {
    min: number;
    max: number;
    handSize: number;
    startPoints: number;
    /** 欠债模式:允许把积分打到负数(仍受端局"破产阈值"约束)。默认 false */
    allowDebt: boolean;
  };
  pool: { openCards: number };
  ante: { amount: number; scaledByMultiplier: boolean };
  betting: {
    baseMultiplier: number;
    ladder: number[];
    seenRate: number;
    blindRate: number;
    postCapRoundsToShowdown: number;
    /** 下注轮上限(安全阀):全员长期不加注时 M 永远到不了封顶 → 打满它就强制摊牌,否则牌局可以无限打下去。null = 不限 */
    maxRounds: number | null;
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
    /** 最早允许比牌的轮次(1 = 第 1 轮就能比;2 = 第 1 轮禁止比牌) */
    minRound: number;
    /** 保护"还没看牌的人":目标走完这么多轮之前,不允许被比牌(0 = 不保护) */
    blindTargetProtectRounds: number;
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
  players: { min: 2, max: 6, handSize: 5, startPoints: 20000, allowDebt: false },
  pool: { openCards: 7 },
  ante: { amount: 1, scaledByMultiplier: false },
  betting: {
    baseMultiplier: 1,
    ladder: [2, 4, 8, 16, 32],
    seenRate: 2,
    blindRate: 1,
    postCapRoundsToShowdown: 2,
    maxRounds: 16,
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
    minRound: 1,
    blindTargetProtectRounds: 0,
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

export interface NumberOverrides {
  /** 底注 —— 视作"刻度":填了它会把整张费用表等比缩放,保持底注/费率/费用的比例不变 */
  ante?: number;
  /** 欠债模式:允许分值为负(仍受破产阈值约束) */
  allowDebt?: boolean;
  /** 最早可比轮次(2 = 第 1 轮禁止比牌) */
  compareMinRound?: number;
  /** 保护未看牌者:目标走完这么多轮前不可被比(0 = 不保护) */
  blindTargetProtectRounds?: number;
  /** 比牌费倍率(基准 2;调大 = 比牌更贵,狙击更少) */
  compareCostMultiplier?: number;
  /** 以下为绝对值,原样生效 */
  startPoints?: number;
  winAtOrAbove?: number;
  bustAtOrBelow?: number;
  maxHands?: number | null;
}

/**
 * 应用用户自定义数值。
 * 关键:**底注是刻度不是普通数值** —— 只改底注而不动费率,等于偷偷改变玩法平衡
 * (实测:底注相对费率变小 = 跟注变便宜 = 大家一路跟到底)。所以底注走整表等比缩放。
 */
export function applyNumberOverrides(base: GameConfig, ov: NumberOverrides): GameConfig {
  let cfg = base;
  const ante = typeof ov.ante === "number" && Number.isFinite(ov.ante) ? ov.ante : undefined;
  if (ante !== undefined && ante > 0) {
    const k = ante / base.ante.amount;
    if (Math.abs(k - 1) > 1e-9) cfg = scaleEconomy(cfg, k);
  }
  const patch: Record<string, unknown> = {};
  const sp = typeof ov.startPoints === "number" && Number.isFinite(ov.startPoints) ? ov.startPoints : undefined;
  const ppl: Record<string, unknown> = {};
  if (sp !== undefined && sp > 0) ppl.startPoints = Math.round(sp);
  if (ov.allowDebt !== undefined) ppl.allowDebt = ov.allowDebt === true;
  if (Object.keys(ppl).length) patch.players = ppl;
  const eg: Record<string, unknown> = {};
  if (typeof ov.winAtOrAbove === "number" && Number.isFinite(ov.winAtOrAbove)) eg.winAtOrAbove = Math.round(ov.winAtOrAbove);
  if (typeof ov.bustAtOrBelow === "number" && Number.isFinite(ov.bustAtOrBelow)) eg.bustAtOrBelow = Math.round(ov.bustAtOrBelow);
  if (ov.maxHands !== undefined) eg.maxHands = ov.maxHands === null ? null : Math.max(1, Math.round(Number(ov.maxHands)));
  if (Object.keys(eg).length) patch.endGame = eg;
  const cmp: Record<string, unknown> = {};
  if (typeof ov.compareMinRound === "number" && Number.isFinite(ov.compareMinRound)) cmp.minRound = Math.max(1, Math.round(ov.compareMinRound));
  if (typeof ov.blindTargetProtectRounds === "number" && Number.isFinite(ov.blindTargetProtectRounds)) cmp.blindTargetProtectRounds = Math.max(0, Math.round(ov.blindTargetProtectRounds));
  if (typeof ov.compareCostMultiplier === "number" && Number.isFinite(ov.compareCostMultiplier) && ov.compareCostMultiplier > 0) cmp.costMultiplier = ov.compareCostMultiplier;
  if (Object.keys(cmp).length) patch.compare = cmp;
  return Object.keys(patch).length ? mergeConfig(cfg, patch) : cfg;
}

export interface NumberIssue { field: string; level: "error" | "warn"; message: string }

/**
 * 校验用户自定义数值 —— 防止"乱填出一个没法玩的局"。
 * 真事:初始积分=1 而底注=12 → 全员付不起底注 → 第 1 局就"全员破产"结束,界面一片 1 分。
 */
export function validateNumbers(base: GameConfig, ov: NumberOverrides): NumberIssue[] {
  const issues: NumberIssue[] = [];
  const ante = typeof ov.ante === "number" && Number.isFinite(ov.ante) && ov.ante > 0 ? ov.ante : base.ante.amount;
  const sp = typeof ov.startPoints === "number" && Number.isFinite(ov.startPoints) ? ov.startPoints : base.players.startPoints;
  const win = typeof ov.winAtOrAbove === "number" && Number.isFinite(ov.winAtOrAbove) ? ov.winAtOrAbove : base.endGame.winAtOrAbove;
  const bust = typeof ov.bustAtOrBelow === "number" && Number.isFinite(ov.bustAtOrBelow) ? ov.bustAtOrBelow : base.endGame.bustAtOrBelow;
  const maxHands = ov.maxHands === undefined ? base.endGame.maxHands : ov.maxHands;

  if (typeof ov.ante === "number" && (!Number.isFinite(ov.ante) || ov.ante <= 0)) issues.push({ field: "ante", level: "error", message: "底注必须为正整数" });
  if (typeof ov.startPoints === "number" && ov.startPoints <= 0) issues.push({ field: "startPoints", level: "error", message: "初始积分必须为正" });
  const allowDebt = ov.allowDebt === true || base.players.allowDebt === true;
  if (sp < ante) {
    if (allowDebt) issues.push({ field: "startPoints", level: "warn", message: "欠债模式下初始积分(" + sp + ")低于底注(" + ante + "):开局即负债 —— 这是欠债模式的正常玩法,确认即可。" });
    else issues.push({ field: "startPoints", level: "error", message: "初始积分(" + sp + ")小于底注(" + ante + "):开局所有人都付不起底注,会立刻全员破产。至少设成 " + ante * 20 + " 以上;或者勾选「允许欠债」。" });
  } else if (sp < ante * 20) issues.push({ field: "startPoints", level: "warn", message: "初始积分只有底注的 " + Math.round(sp / ante) + " 倍,开局很容易破产;建议至少 " + ante * 100 + "(=100 倍底注)。" });
  if (win <= sp) issues.push({ field: "winAtOrAbove", level: "error", message: "胜利阈值(" + win + ")必须大于初始积分(" + sp + "),否则开局即达成。" });
  else {
    const gap = win - sp;
    if (gap < ante * 100) issues.push({ field: "winAtOrAbove", level: "warn", message: "阈值差只有底注的 " + Math.round(gap / ante) + " 倍,实测这种比例常常 1~2 手就结束;想打 20 手左右,让差值达到底注的 500~2000 倍。" });
  }
  if (bust >= sp) issues.push({ field: "bustAtOrBelow", level: "error", message: "破产阈值(" + bust + ")必须小于初始积分(" + sp + "),否则开局即出局。" });
  if (allowDebt && bust < -(ante * 50)) issues.push({ field: "bustAtOrBelow", level: "warn", message: "欠债几乎无上限(破产阈值 " + bust + "):付不起也能付,弃牌就失去意义,实测牌局会退化成「人人跟到底」(动作数暴增十几倍)。建议把破产阈值设在 -" + ante * 20 + " 到 -" + ante * 50 + " 之间(约 20 到 50 倍底注)。" });
  if (maxHands !== null && (typeof maxHands !== "number" || !Number.isFinite(maxHands) || maxHands < 1)) issues.push({ field: "maxHands", level: "error", message: "局数上限必须是 ≥1 的整数,或留空表示不限" });
  return issues;
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
