// 对局状态、动作、事件与不变量(§5 / §6.5)
import { createRng } from "./rng.ts";
import type { Rng } from "./rng.ts";
import type { Card } from "./cards.ts";
import type { GameConfig } from "./config.ts";
import type { HandCategory } from "./evaluator.ts";

export type Phase = "HAND_START" | "BETTING" | "SETTLE" | "GAME_OVER";

export type ActionType =
  | "VIEW_HAND" | "EXCHANGE" | "INTERCEPT" | "DECLINE_INTERCEPT" | "RETAKE" | "SKIP_RETAKE"
  | "KICK" | "TAKE_BLOCKED" | "PASS_BLOCKED"
  | "CALL" | "RAISE" | "FOLD" | "COMPARE";

export interface ActionBase { type: ActionType; seat: number; clientActionId?: string }

export type Action =
  | (ActionBase & { type: "VIEW_HAND" })
  | (ActionBase & { type: "EXCHANGE"; takeCardId: string; giveCardId: string })
  | (ActionBase & { type: "INTERCEPT"; giveCardId: string })
  | (ActionBase & { type: "DECLINE_INTERCEPT" })
  | (ActionBase & { type: "KICK"; targetCardId: string })
  | (ActionBase & { type: "TAKE_BLOCKED"; giveCardId: string })
  | (ActionBase & { type: "PASS_BLOCKED" })
  | (ActionBase & { type: "CALL" })
  | (ActionBase & { type: "RAISE"; toMultiplier: number })
  | (ActionBase & { type: "FOLD" })
  | (ActionBase & { type: "COMPARE"; targetSeat: number });

export interface CostBreakdown {
  action: string; base: number; multiplier: number; extra: number; total: number; note: string;
}

export interface PlayerState {
  id: string;
  seat: number;
  name: string;
  points: number;
  hand: Card[];
  blind: boolean;              // 闷牌(未看过自己的牌)
  handViewed: boolean;
  inHand: boolean;
  folded: boolean;
  exchangeCount: number;
  kickUsed: boolean;
  committedThisHand: number;
  /** 本局开始时的积分(用来显示本局净收支) */
  pointsAtHandStart: number;
  compareUsedThisTurn: boolean;
}

export interface PoolCardMeta {
  cardId: string;
  faceUp: boolean;
  origin: "DECK" | "DISCARDED" | "KICK_DRAW";
  holderHistory: string[];
  selectedBy?: string;
  everSelected: boolean;
  swapFeePaid: number;
  interceptCount: number;
  uninterceptable: boolean;
}

export interface BlockadeState {
  kickerSeat: number;
  cardId: string;
  startSeat: number;
  resolvedByKicker: boolean;
  createdTurn: number;      // 创建时的 turnSeq;只有踢牌者"下一次"行动才算封锁轮结束
}

export interface BettingState {
  roundIndex: number;
  actedThisRound: string[];
  currentStake: number;
  lastRaiserId?: string;
  openingSeat: number;
  capReached: boolean;
  capRoundIndex: number | null;
  postCapRoundsPlayed: number;
}

/** 待截胡记录:换牌后挂起,到"紧邻下家"自己的回合内才可执行(§7.4 v1.6) */
export interface PendingIntercept {
  cardId: string;
  fromSeat: number;
  candidateSeat: number;
  n: number;
  depth: number;
}

export interface SettlementResult {
  pot: number;
  winners: number[];
  perWinner: number;
  remainder: number;
  showdown: boolean;
  reason: "LAST_STANDING" | "SHOWDOWN" | "TIE_COMPONENT";
  ranking: Array<{ seat: number; points: number }>;
  gameOver: boolean;
  gameOverReason?: "WIN_THRESHOLD" | "BUST" | "BOTH" | "MAX_HANDS";
  winnerSeat?: number;
  tie: boolean;
}

export type GameEvent =
  | { kind: "HAND_STARTED"; handNo: number; dealerSeat: number }
  | { kind: "ANTE_PAID"; seat: number; amount: number; cost: CostBreakdown }
  | { kind: "CARDS_DEALT"; seat: number; count: number }
  | { kind: "POOL_REVEALED"; cardIds: string[] }
  | { kind: "HAND_VIEWED"; seat: number }
  | { kind: "EXCHANGED"; seat: number; tookId: string; gaveId: string; cost: CostBreakdown; exchangeIndex: number }
  | { kind: "INTERCEPTED"; seat: number; fromSeat: number; cardId: string; n: number; cost: CostBreakdown }
  | { kind: "INTERCEPT_OFFERED"; cardId: string; candidateSeat: number; n: number }
  | { kind: "INTERCEPT_DECLINED"; seat: number; reason: string }
  | { kind: "INTERCEPT_EXPIRED"; cardId: string; candidateSeat: number }
  | { kind: "INTERCEPT_UNAVAILABLE"; cardId: string; reason: string }
  | { kind: "KICKED"; seat: number; removedId: string; drawnId: string; cost: CostBreakdown }
  | { kind: "BLOCKADE_STARTED"; kickerSeat: number; cardId: string; startSeat: number }
  | { kind: "BLOCKADE_ENDED"; cardId: string; revealed: boolean; reason: string }
  | { kind: "BLOCKED_TAKEN"; seat: number; cardId: string; gaveId: string; cost: CostBreakdown }
  | { kind: "BET"; seat: number; betKind: "CALL" | "RAISE"; amount: number; multiplierAfter: number; cost: CostBreakdown }
  | { kind: "FOLDED"; seat: number; reason: string; revealed?: string[] }
  | { kind: "COMPARED"; aSeat: number; bSeat: number; winnerSeat: number | null; tie: boolean; cost: CostBreakdown }
  | { kind: "TIE_RECORDED"; aSeat: number; bSeat: number }
  | { kind: "ROUND_ENDED"; roundIndex: number; multiplier: number }
  | { kind: "SHOWDOWN"; entries: Array<{ seat: number; category: HandCategory; key: number[] }> }
  | { kind: "POT_AWARDED"; seat: number; amount: number }
  | { kind: "HAND_SETTLED"; pot: number; winners: number[]; reason: string }
  | { kind: "GAME_OVER"; reason: "WIN_THRESHOLD" | "BUST" | "BOTH" | "MAX_HANDS"; winnerSeat?: number };

export interface GameState {
  config: GameConfig;
  phase: Phase;
  handNo: number;
  dealerSeat: number;
  players: PlayerState[];
  deck: Card[];
  pool: Card[];
  kicked: Card[];          // 被踢出局的牌(不再参与本局)
  poolMeta: Record<string, PoolCardMeta>;
  pot: number;
  multiplier: number;
  betting: BettingState;
  blockades: BlockadeState[];
  pendingIntercept: PendingIntercept | null;
  turnSeq: number;
  interceptTotalThisHand: number;
  compareTies: Array<[number, number]>;
  turn: { seat: number | null; needsMainDecision: boolean };
  events: GameEvent[];
  settlement?: SettlementResult;
  seed: number;
  rng: Rng;
  seenClientActionIds: string[];
  carryPot: number;
  gameOver: boolean;
}

export function createGame(cfg: GameConfig, names: string[], seed = 1): GameState {
  if (names.length < cfg.players.min || names.length > cfg.players.max) {
    throw new Error("人数需在 " + cfg.players.min + "~" + cfg.players.max + " 之间");
  }
  const players: PlayerState[] = names.map((name, seat) => ({
    id: "P" + (seat + 1),
    seat,
    name,
    points: cfg.players.startPoints,
    hand: [],
    blind: true,
    handViewed: false,
    inHand: false,
    folded: false,
    exchangeCount: 0,
    kickUsed: false,
    committedThisHand: 0,
    pointsAtHandStart: cfg.players.startPoints,
    compareUsedThisTurn: false
  }));
  return {
    config: cfg,
    phase: "HAND_START",
    handNo: 0,
    dealerSeat: names.length - 1,
    players,
    deck: [],
    pool: [],
    kicked: [],
    poolMeta: {},
    pot: 0,
    multiplier: cfg.betting.baseMultiplier,
    betting: { roundIndex: 0, actedThisRound: [], currentStake: 0, openingSeat: 0, capReached: false, capRoundIndex: null, postCapRoundsPlayed: 0 },
    blockades: [],
    pendingIntercept: null,
    turnSeq: 0,
    interceptTotalThisHand: 0,
    compareTies: [],
    turn: { seat: null, needsMainDecision: false },
    events: [],
    seed: seed >>> 0,
    rng: createRng(seed),
    seenClientActionIds: [],
    carryPot: 0,
    gameOver: false
  };
}

export function player(state: GameState, seat: number): PlayerState {
  const p = state.players[seat];
  if (!p) throw new Error("非法座位: " + seat);
  return p;
}

export function isAlive(p: PlayerState): boolean {
  return p.inHand && !p.folded;
}

export function aliveSeats(state: GameState): number[] {
  return state.players.filter(isAlive).map((p) => p.seat);
}

/** 下一个存活座位(顺时针,不含 from) */
export function nextAliveSeat(state: GameState, from: number): number {
  const n = state.players.length;
  for (let i = 1; i <= n; i++) {
    const s = (from + i) % n;
    if (isAlive(player(state, s))) return s;
  }
  return from;
}

export function poolMetaFor(state: GameState, cardId: string): PoolCardMeta {
  const m = state.poolMeta[cardId];
  if (!m) throw new Error("公共池缺少元数据: " + cardId);
  return m;
}

export function blockerOf(state: GameState, cardId: string): BlockadeState | undefined {
  return state.blockades.find((b) => b.cardId === cardId && !b.resolvedByKicker);
}

export function activeBlockadeFor(state: GameState, seat: number): BlockadeState | undefined {
  return state.blockades.find((b) => b.kickerSeat === seat && !b.resolvedByKicker);
}

/** 封锁轮是否已"收束到踢牌者"——即踢牌者已再次轮到行动(§7.5) */
export function blockadeRipe(state: GameState, b: BlockadeState): boolean {
  return state.turnSeq > b.createdTurn;
}

export function ladderIndex(state: GameState, m: number): number {
  return state.config.betting.ladder.indexOf(m);
}

export function isCapped(state: GameState): boolean {
  const l = state.config.betting.ladder;
  return state.multiplier >= l[l.length - 1];
}

/** 12 档 + 不变量校验;返回违规描述列表(空 = 全部成立) */
export function checkInvariants(state: GameState): string[] {
  const bad: string[] = [];
  const cfg = state.config;
  const live = state.phase === "BETTING" || state.phase === "SETTLE";
  if (live) {
    if (state.pool.length !== cfg.pool.openCards) bad.push("INV1 公共池应为 " + cfg.pool.openCards + " 张,实际 " + state.pool.length);
    for (const p of state.players) {
      if (isAlive(p) && p.hand.length !== cfg.players.handSize) bad.push("INV2 玩家 " + p.seat + " 手牌数 " + p.hand.length);
    }
  }
  const all = [...state.deck, ...state.pool, ...state.kicked, ...state.players.flatMap((p) => p.hand)];
  if (live && all.length !== 104) bad.push("INV3 卡牌总数 " + all.length + " ≠ 104");
  if (new Set(all.map((c) => c.id)).size !== all.length) bad.push("INV7 存在重复卡牌");
  if (cfg.players.allowDebt !== true) for (const p of state.players) if (p.points < 0) bad.push("INV4 玩家 " + p.seat + " 积分为负");
  if (state.multiplier !== cfg.betting.baseMultiplier && !cfg.betting.ladder.includes(state.multiplier)) {
    bad.push("INV6 非法倍数 " + state.multiplier);
  }
  if (state.interceptTotalThisHand > cfg.intercept.maxPerHand) bad.push("INV9 截胡次数超限");
  if (state.pot < 0) bad.push("INV5 底池为负");
  for (const m of Object.values(state.poolMeta)) {
    if (m.selectedBy !== undefined && !state.players.some((p) => p.id === m.selectedBy)) bad.push("INV8 卡牌持有者不存在");
  }
  return bad;
}
