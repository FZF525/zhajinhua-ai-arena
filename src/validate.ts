// 动作校验(§8.2):非法动作返回 ValidationResult,不改变状态。
// v1.6:截胡不再是"打断式窗口",而是"下家回合内可执行的选项"(见 engine.setPendingIntercept)
import { poolMetaFor, player, isAlive, blockadeRipe } from "./state.ts";
import type { Action, GameState, PlayerState, PendingIntercept } from "./state.ts";
import type { GameConfig } from "./config.ts";
import { callCost, compareCost, exchangeCost, interceptCost, kickCost, raiseCost, nextLadderValue } from "./costs.ts";
import type { CostBreakdown } from "./state.ts";

/**
 * 能否支付一笔费用。
 * 欠债模式(players.allowDebt)下允许把积分打到负数 —— 何时出局交给端局"破产阈值"判断,
 * 而不是"付不起就不许行动"。
 */
function canPay(p: { points: number }, total: number, cfg: GameConfig): boolean {
  return cfg.players.allowDebt === true || p.points >= total;
}

export interface ValidationResult {
  ok: boolean;
  code?: string;
  message?: string;
  cost?: CostBreakdown;
}

const OK: ValidationResult = { ok: true };
const fail = (code: string, message: string): ValidationResult => ({ ok: false, code, message });

export function validate(state: GameState, action: Action): ValidationResult {
  if (state.phase !== "BETTING") return fail("ERR_PHASE", "当前阶段 " + state.phase + " 不接受操作");
  if (action.clientActionId && state.seenClientActionIds.includes(action.clientActionId)) {
    return fail("ERR_DUPLICATE_ACTION", "重复的 clientActionId");
  }
  const p = state.players[action.seat];
  if (!p) return fail("ERR_NOT_IN_HAND", "非法座位");
  if (state.turn.seat !== action.seat) return fail("ERR_NOT_YOUR_TURN", "还没轮到座位 " + action.seat);
  if (!isAlive(p)) return fail("ERR_NOT_IN_HAND", "玩家已弃牌或不在本局");

  switch (action.type) {
    case "VIEW_HAND": return OK;
    case "EXCHANGE": return validateExchange(state, action);
    case "INTERCEPT": return validateIntercept(state, action);
    case "DECLINE_INTERCEPT": {
      const w = state.pendingIntercept;
      if (!w || w.candidateSeat !== action.seat) return fail("ERR_NO_INTERCEPT_WINDOW", "当前没有归属你的待截牌");
      return OK;
    }
    case "KICK": return validateKick(state, action);
    case "TAKE_BLOCKED": return validateTakeBlocked(state, action);
    case "PASS_BLOCKED": {
      const b = activeBlockade(state, action.seat);
      if (!b) return fail("ERR_NOT_BLOCKADE_KICKER", "当前没有属于你的封锁轮暗牌");
      return blockadeRipe(state, b) ? OK : fail("ERR_BLOCKADE_NOT_ENDED", "封锁轮尚未收束到你,先继续下注");
    }
    case "CALL": {
      const cost = callCost(state, action.seat);
      return canPay(p, cost.total, state.config) ? { ok: true, cost } : fail("ERR_INSUFFICIENT_POINTS", "积分不足:" + cost.note);
    }
    case "RAISE": {
      const a = action as Action & { type: "RAISE"; toMultiplier: number };
      const next = nextLadderValue(state);
      if (next === null) return fail("ERR_RAISE_OVER_CAP", "M 已封顶,不能再加注");
      if (a.toMultiplier !== next) return fail("ERR_INVALID_RAISE_STEP", "只能加注到下一档 " + next);
      const cost = raiseCost(state, action.seat, a.toMultiplier);
      return canPay(p, cost.total, state.config) ? { ok: true, cost } : fail("ERR_INSUFFICIENT_POINTS", "积分不足:" + cost.note);
    }
    case "FOLD": return OK;
    case "COMPARE": return validateCompare(state, action);
    default: return fail("ERR_BAD_ACTION", "当前不可执行 " + (action as { type: string }).type);
  }
}

function activeBlockade(state: GameState, seat: number) {
  return state.blockades.find((b) => b.kickerSeat === seat && !b.resolvedByKicker);
}
export { activeBlockade };

function validateExchange(state: GameState, action: Action): ValidationResult {
  const a = action as Action & { type: "EXCHANGE"; takeCardId: string; giveCardId: string };
  const cfg = state.config;
  const p = player(state, a.seat);
  if (p.blind) return fail("ERR_BLIND_CANNOT_EXCHANGE", "闷牌者不能换牌");
  if (p.exchangeCount >= cfg.exchange.maxPerHand) return fail("ERR_EXCHANGE_LIMIT", "换牌次数已用完");
  if (!state.pool.some((c) => c.id === a.takeCardId)) return fail("ERR_CARD_NOT_SELECTABLE", "目标牌不在公共池");
  const meta = poolMetaFor(state, a.takeCardId);
  if (!meta.faceUp) return fail("ERR_CARD_BLOCKADED", "该牌处于封锁轮,不可选取");
  if (!cfg.exchange.allowSelfReclaim && meta.origin === "DISCARDED" && meta.holderHistory[meta.holderHistory.length - 1] === p.id) {
    return fail("ERR_SELF_RECLAIM", "不能立刻换回自己刚放回的牌");
  }
  if (!p.hand.some((c) => c.id === a.giveCardId)) return fail("ERR_CARD_NOT_OWNED", "放回的牌必须在自己手上");
  if (a.takeCardId === a.giveCardId) return fail("ERR_CARD_NOT_SELECTABLE", "不能拿同一张牌与自己交换");
  const cost = exchangeCost(state, a.seat);
  return canPay(p, cost.total, state.config) ? { ok: true, cost } : fail("ERR_INSUFFICIENT_POINTS", "积分不足:" + cost.note);
}

/** 截胡:只认"最近一次换牌"的那张,且必须由紧邻下家在自己回合内发起 */
export function interceptEligibility(state: GameState, p: PlayerState, w: PendingIntercept): { ok: boolean; code?: string; message?: string; cost: CostBreakdown } {
  const cfg = state.config;
  const meta = poolMetaFor(state, w.cardId);
  const cost = interceptCost(state, w.cardId, w.n);
  if (w.candidateSeat !== p.seat) return { ok: false, code: "ERR_INTERCEPT_NOT_ADJACENT", message: "只有紧邻下家(座位 " + w.candidateSeat + ")能截胡", cost };
  if (p.blind) return { ok: false, code: "ERR_BLIND_CANNOT_INTERCEPT", message: "闷牌者不能截胡 —— 可以先看牌再决定", cost };
  if (meta.holderHistory.includes(p.id)) return { ok: false, code: "ERR_INTERCEPT_RETURN_TO_HOLDER", message: "该牌曾经手过你", cost };
  if (meta.interceptCount >= cfg.intercept.maxPerCard) return { ok: false, code: "ERR_CARD_INTERCEPT_LIMIT", message: "该牌被截次数已达上限", cost };
  if (state.interceptTotalThisHand >= cfg.intercept.maxPerHand) return { ok: false, code: "ERR_HAND_INTERCEPT_LIMIT", message: "本局截胡次数已达上限", cost };
  if (!meta.faceUp) return { ok: false, code: "ERR_CARD_BLOCKADED", message: "封锁轮暗牌不可截", cost };
  if (meta.uninterceptable) return { ok: false, code: "ERR_UNINTERCEPTABLE", message: "该牌不可被截胡", cost };
  if (!canPay(p, cost.total, state.config)) return { ok: false, code: "ERR_INSUFFICIENT_POINTS", message: "积分不足:" + cost.note, cost };
  return { ok: true, cost };
}

function validateIntercept(state: GameState, action: Action): ValidationResult {
  const w = state.pendingIntercept;
  if (!w) return fail("ERR_NO_INTERCEPT_WINDOW", "当前没有可截的牌(只有刚刚换走的牌能被截)");
  const p = player(state, action.seat);
  const e = interceptEligibility(state, p, w);
  if (!e.ok) return fail(e.code!, e.message!);
  const give = (action as Action & { type: "INTERCEPT"; giveCardId?: string }).giveCardId;
  if (!give) return fail("ERR_CARD_NOT_OWNED", "截胡需要指定放回的手牌");
  if (!p.hand.some((c) => c.id === give)) return fail("ERR_CARD_NOT_OWNED", "放回的牌必须在自己手上");
  return { ok: true, cost: e.cost };
}

function validateKick(state: GameState, action: Action): ValidationResult {
  const a = action as Action & { type: "KICK"; targetCardId: string };
  const cfg = state.config;
  const p = player(state, a.seat);
  if (p.kickUsed) return fail("ERR_KICK_LIMIT", "本局已踢过牌");
  if (state.deck.length < 1) return fail("ERR_DECK_EXHAUSTED", "牌堆已空,无法补牌");
  const meta = state.poolMeta[a.targetCardId];
  if (!meta || !state.pool.some((c) => c.id === a.targetCardId)) return fail("ERR_CARD_NOT_SELECTABLE", "目标牌不在公共池");
  if (!meta.faceUp) return fail("ERR_CARD_NOT_SELECTABLE", "封锁轮暗牌不能被踢");
  if (cfg.kick.requireNeverSelected && meta.everSelected) return fail("ERR_CARD_ALREADY_SELECTED", "该牌已被选取过,不能踢");
  const cost = kickCost(state);
  return canPay(p, cost.total, state.config) ? { ok: true, cost } : fail("ERR_INSUFFICIENT_POINTS", "积分不足:" + cost.note);
}

function validateTakeBlocked(state: GameState, action: Action): ValidationResult {
  const a = action as Action & { type: "TAKE_BLOCKED"; giveCardId: string };
  const blk = activeBlockade(state, a.seat);
  if (!blk) return fail("ERR_NOT_BLOCKADE_KICKER", "当前没有属于你的封锁轮暗牌");
  if (!blockadeRipe(state, blk)) return fail("ERR_BLOCKADE_NOT_ENDED", "封锁轮尚未收束到你,先继续下注");
  const p = player(state, a.seat);
  if (p.exchangeCount >= state.config.exchange.maxPerHand) return fail("ERR_EXCHANGE_LIMIT", "换牌次数已用完");
  if (!p.hand.some((c) => c.id === a.giveCardId)) return fail("ERR_CARD_NOT_OWNED", "放回的牌必须在自己手上");
  const cost = exchangeCost(state, a.seat);
  return canPay(p, cost.total, state.config) ? { ok: true, cost } : fail("ERR_INSUFFICIENT_POINTS", "积分不足:" + cost.note);
}

function validateCompare(state: GameState, action: Action): ValidationResult {
  const a = action as Action & { type: "COMPARE"; targetSeat: number };
  const cfg = state.config;
  const p = player(state, a.seat);
  const blocked = compareRuleBlock(state, a.seat, a.targetSeat);
  if (blocked) {
    const code = blocked.indexOf("轮起才能比牌") >= 0 ? "ERR_COMPARE_TOO_EARLY"
      : blocked.indexOf("保护闷牌者") >= 0 ? "ERR_COMPARE_BLIND_TARGET_PROTECTED"
      : "ERR_COMPARE_INVALID_TARGET";
    return fail(code, blocked);
  }
  const t = state.players[a.targetSeat];
  if (p.blind && state.betting.roundIndex <= cfg.compare.blindMinBettingRounds) {
    return fail("ERR_BLIND_COMPARE_TOO_EARLY", "闷牌者须走完 " + cfg.compare.blindMinBettingRounds + " 个下注轮后才能盲比");
  }
  if (cfg.compare.oncePerTurn && p.compareUsedThisTurn) return fail("ERR_COMPARE_ALREADY_USED", "本回合已经比过牌");
  if (cfg.compare.maxPerHand !== null) {
    const used = state.events.filter((e) => e.kind === "COMPARED" && (e.aSeat === a.seat || e.bSeat === a.seat)).length;
    if (used >= cfg.compare.maxPerHand) return fail("ERR_COMPARE_ALREADY_USED", "本局比牌次数已达上限");
  }
  const cost = compareCost(state, a.seat);
  return canPay(p, cost.total, state.config) ? { ok: true, cost } : fail("ERR_INSUFFICIENT_POINTS", "积分不足:" + cost.note);
}

/**
 * 比牌是否被规则允许(轮次 / 保护未看牌者)。
 * **validate 与 enumerateActions 必须共用这一个判定** —— 否则会出现"合法动作列表里给了 COMPARE、
 * apply 却拒绝"的卡死(真发生过:新加的轮次/保护规则只写在 validate 里)。
 */
export function compareRuleBlock(state: GameState, seat: number, targetSeat: number): string | null {
  const cfg = state.config;
  if (!cfg.compare.enabled) return "比牌已禁用";
  if (!cfg.compare.anyOpponent) return "不可指定对手";
  if (targetSeat === seat) return "不能和自己比牌";
  const t = player(state, targetSeat);
  if (!t || !isAlive(t)) return "目标不在本局";
  const minRound = cfg.compare.minRound ?? 1;
  if (minRound > 1 && state.betting.roundIndex < minRound) return "第 " + minRound + " 轮起才能比牌(现在是第 " + state.betting.roundIndex + " 轮)";
  const protect = cfg.compare.blindTargetProtectRounds ?? 0;
  if (protect > 0 && t.blind && state.betting.roundIndex <= protect) return "对方还没看牌:第 " + (protect + 1) + " 轮起才能比(保护闷牌者)";
  return null;
}

function canCompare(state: GameState, p: PlayerState): boolean {
  const cfg = state.config;
  if (!cfg.compare.enabled) return false;
  if (p.blind && state.betting.roundIndex <= cfg.compare.blindMinBettingRounds) return false;
  if (cfg.compare.oncePerTurn && p.compareUsedThisTurn) return false;
  // 至少要有"一个当前规则允许的目标",否则这个动作不该出现在合法列表里
  if (!state.players.some((q) => q.seat !== p.seat && isAlive(q) && compareRuleBlock(state, p.seat, q.seat) === null)) return false;
  if (cfg.compare.maxPerHand !== null) {
    const used = state.events.filter((e) => e.kind === "COMPARED" && (e.aSeat === p.seat || e.bSeat === p.seat)).length;
    if (used >= cfg.compare.maxPerHand) return false;
  }
  return canPay(p, compareCost(state, p.seat).total, state.config);
}

/** 当前可用动作(供 UI / CLI 展示) */
export function legalActions(state: GameState): string[] {
  if (state.phase !== "BETTING") return [];
  const seat = state.turn.seat;
  if (seat === null) return [];
  const p = player(state, seat);
  const out: string[] = ["FOLD"];
  if (canPay(p, callCost(state, seat).total, state.config)) out.push("CALL");
  const next = nextLadderValue(state);
  if (next !== null && canPay(p, raiseCost(state, seat, next).total, state.config)) out.push("RAISE");
  if (canCompare(state, p)) out.push("COMPARE");
  if (p.blind) out.push("VIEW_HAND");
  if (!p.blind && p.exchangeCount < state.config.exchange.maxPerHand && canPay(p, exchangeCost(state, seat).total, state.config)) out.push("EXCHANGE");
  const kickable = state.pool.some((c) => {
    const m = state.poolMeta[c.id];
    return m.faceUp && (!state.config.kick.requireNeverSelected || !m.everSelected);
  });
  if (!p.kickUsed && state.deck.length > 0 && kickable && canPay(p, kickCost(state).total, state.config)) out.push("KICK");
  const blk = activeBlockade(state, seat);
  if (blk && blockadeRipe(state, blk)) {
    out.push("PASS_BLOCKED");
    if (p.exchangeCount < state.config.exchange.maxPerHand && canPay(p, exchangeCost(state, seat).total, state.config)) out.push("TAKE_BLOCKED");
  }
  // 待截胡:只在本人的回合内出现(可先 VIEW_HAND 再截)
  const w = state.pendingIntercept;
  if (w && w.candidateSeat === seat) {
    out.push("DECLINE_INTERCEPT");
    if (interceptEligibility(state, p, w).ok) out.unshift("INTERCEPT");
  }
  return out;
}
