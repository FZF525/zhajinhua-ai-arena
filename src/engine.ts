// 核心引擎(§6 / §7):回合推进、换牌、截胡链、踢牌封锁轮、比牌平局、结算与终局。
// 约定:apply() 直接就地修改 state 并返回本次产生的事件;每个动作后自动推进无需输入的阶段。
import { createDeck, cardText } from "./cards.ts";
import type { Card } from "./cards.ts";
import { evaluate, compare as compareHands } from "./evaluator.ts";
import { anteCost, callCost, compareCost, exchangeCost, interceptCost, kickCost, raiseCost } from "./costs.ts";
import { validate } from "./validate.ts";
import {
  aliveSeats, isAlive, nextAliveSeat, player, poolMetaFor, isCapped, checkInvariants
} from "./state.ts";
import type {
  Action, BlockadeState, CostBreakdown, GameEvent, GameState, PlayerState, PoolCardMeta, SettlementResult
} from "./state.ts";

export interface ApplyResult {
  ok: boolean;
  state: GameState;
  events: GameEvent[];
  error?: { code: string; message: string };
}

// ---------- 基础工具 ----------

function emit(state: GameState, e: GameEvent): void {
  state.events.push(e);
}

function payCost(state: GameState, seat: number, cost: CostBreakdown): void {
  const p = player(state, seat);
  p.points -= cost.total;
  state.pot += cost.total;
  p.committedThisHand += cost.total;
}

function ensureMeta(state: GameState, card: Card): PoolCardMeta {
  let m = state.poolMeta[card.id];
  if (!m) {
    m = {
      cardId: card.id, faceUp: true, origin: "DECK", holderHistory: [], selectedBy: undefined,
      everSelected: false, swapFeePaid: 0, interceptCount: 0, uninterceptable: false
    };
    state.poolMeta[card.id] = m;
  }
  return m;
}

function aliveIds(state: GameState): string[] {
  return state.players.filter(isAlive).map((p) => p.id);
}

export function cloneState(s: GameState): GameState {
  return {
    ...s,
    players: s.players.map((p) => ({ ...p, hand: p.hand.slice() })),
    deck: s.deck.slice(),
    pool: s.pool.slice(),
    kicked: s.kicked.slice(),
    poolMeta: Object.fromEntries(Object.entries(s.poolMeta).map(([k, m]) => [k, { ...m, holderHistory: m.holderHistory.slice() }])),
    betting: { ...s.betting, actedThisRound: s.betting.actedThisRound.slice() },
    blockades: s.blockades.map((b) => ({ ...b })),
    pendingIntercept: s.pendingIntercept ? { ...s.pendingIntercept } : null,
    compareTies: s.compareTies.map((e) => [e[0], e[1]] as [number, number]),
    turn: { ...s.turn },
    events: s.events.slice(),
    seenClientActionIds: s.seenClientActionIds.slice()
  };
}

// ---------- 开局 ----------

function startHand(state: GameState): void {
  const cfg = state.config;
  state.handNo += 1;
  state.dealerSeat = (state.dealerSeat + 1) % state.players.length;
  state.multiplier = cfg.betting.baseMultiplier;
  state.pool = [];
  state.kicked = [];
  state.poolMeta = {};
  state.blockades = [];
  state.pendingIntercept = null;
  state.interceptTotalThisHand = 0;
  state.compareTies = [];
  state.pot = state.carryPot;
  state.carryPot = 0;
  state.betting = {
    roundIndex: 0, actedThisRound: [], currentStake: cfg.betting.seenRate * state.multiplier,
    openingSeat: 0, capReached: false, capRoundIndex: null, postCapRoundsPlayed: 0
  };
  state.turn = { seat: null, needsMainDecision: false };
  state.deck = state.rng.shuffle(createDeck());

  emit(state, { kind: "HAND_STARTED", handNo: state.handNo, dealerSeat: state.dealerSeat });

  for (const p of state.players) {
    p.hand = [];
    p.blind = true;
    p.handViewed = false;
    p.folded = false;
    p.exchangeCount = 0;
    p.kickUsed = false;
    p.committedThisHand = 0;
    p.pointsAtHandStart = p.points;        // 本局净收支的基准(在扣底注之前)
    p.compareUsedThisTurn = false;
    p.inHand = p.points >= cfg.ante.amount;
  }

  const entrants0 = state.players.filter((p) => p.inHand);
  if (entrants0.length < 2) {
    const survivor = state.players.find((p) => p.points > cfg.endGame.bustAtOrBelow);
    finishGame(state, "BUST", survivor ? survivor.seat : undefined);
    return;
  }

  // 底注
  const ante = anteCost(state);
  for (const p of state.players) {
    if (!p.inHand) continue;
    payCost(state, p.seat, ante);
    emit(state, { kind: "ANTE_PAID", seat: p.seat, amount: ante.total, cost: ante });
  }

  const entrants = state.players.filter((p) => p.inHand);

  // 发牌 + 公共池
  for (const p of entrants) {
    p.hand = state.deck.splice(0, cfg.players.handSize);
    emit(state, { kind: "CARDS_DEALT", seat: p.seat, count: p.hand.length });
  }
  state.pool = state.deck.splice(0, cfg.pool.openCards);
  for (const c of state.pool) ensureMeta(state, c).faceUp = true;
  emit(state, { kind: "POOL_REVEALED", cardIds: state.pool.map((c) => c.id) });

  state.betting.roundIndex = 1;
  state.betting.openingSeat = nextAliveSeat(state, state.dealerSeat);
  setTurn(state, state.betting.openingSeat);
  state.phase = "BETTING";
}

/** 无输入阶段的自动推进:开局发牌 / 上一局结束后开下一局 */
export function advance(state: GameState): GameEvent[] {
  const before = state.events.length;
  let guard = 0;
  while (state.phase === "HAND_START" && !state.gameOver && guard++ < 8) startHand(state);
  if (state.phase === "HAND_START" && !state.gameOver) state.phase = "BETTING";
  return state.events.slice(before);
}

// ---------- 动作入口 ----------

export interface ApplyOptions {
  /** 本局结算后是否立刻发下一局;MC 模拟传 false 以便在结算瞬间取收益 */
  dealNextHand?: boolean;
}

export function apply(state: GameState, action: Action, opts: ApplyOptions = {}): ApplyResult {
  const v = validate(state, action);
  if (!v.ok) return { ok: false, state, events: [], error: { code: v.code!, message: v.message! } };
  const before = state.events.length;
  if (action.clientActionId) state.seenClientActionIds.push(action.clientActionId);
  const p = player(state, action.seat);

  switch (action.type) {
    case "VIEW_HAND":
      p.blind = false;
      p.handViewed = true;
      emit(state, { kind: "HAND_VIEWED", seat: p.seat });
      break;
    case "EXCHANGE":
      doExchange(state, action.seat, action.takeCardId, action.giveCardId, v.cost!, 0);
      break;
    case "DECLINE_INTERCEPT": {
      state.pendingIntercept = null;
      emit(state, { kind: "INTERCEPT_DECLINED", seat: action.seat, reason: "候选者放弃" });
      break;
    }
    case "INTERCEPT":
      doIntercept(state, action.seat, action.giveCardId, v.cost!);
      break;
    case "KICK":
      doKick(state, action.seat, action.targetCardId, v.cost!);
      break;
    case "TAKE_BLOCKED":
      doTakeBlocked(state, action.seat, action.giveCardId, v.cost!);
      break;
    case "PASS_BLOCKED": {
      const b = state.blockades.find((x) => x.kickerSeat === action.seat && !x.resolvedByKicker)!;
      resolveBlockade(state, b, "pass", true);
      break;
    }
    case "CALL": {
      payCost(state, action.seat, v.cost!);
      emit(state, { kind: "BET", seat: p.seat, betKind: "CALL", amount: v.cost!.total, multiplierAfter: state.multiplier, cost: v.cost! });
      markActed(state, p.seat);
      endTurn(state);
      break;
    }
    case "RAISE": {
      const a = action as Action & { type: "RAISE"; toMultiplier: number };
      payCost(state, action.seat, v.cost!);
      state.multiplier = a.toMultiplier;
      state.betting.currentStake = state.config.betting.seenRate * state.multiplier;
      state.betting.lastRaiserId = p.id;
      emit(state, { kind: "BET", seat: p.seat, betKind: "RAISE", amount: v.cost!.total, multiplierAfter: state.multiplier, cost: v.cost! });
      if (isCapped(state)) {
        state.betting.capReached = true;
        state.betting.capRoundIndex = state.betting.roundIndex;
        state.betting.postCapRoundsPlayed = 0;
      }
      state.betting.actedThisRound = [p.id]; // 其余玩家需要重新行动
      endTurn(state);
      break;
    }
    case "FOLD":
      foldPlayer(state, action.seat, "主动弃牌");
      endTurn(state);
      break;
    case "COMPARE":
      doCompare(state, action.seat, (action as Action & { type: "COMPARE"; targetSeat: number }).targetSeat, v.cost!);
      break;
    default:
      return { ok: false, state, events: [], error: { code: "ERR_BAD_ACTION", message: action.type } };
  }

  ensurePendingStillValid(state);
  const events = state.events.slice(before);
  if (state.phase === "HAND_START" && opts.dealNextHand !== false) advance(state);
  return { ok: true, state, events: state.events.slice(before) };
}

function markActed(state: GameState, seat: number): void {
  const id = player(state, seat).id;
  if (!state.betting.actedThisRound.includes(id)) state.betting.actedThisRound.push(id);
}

// ---------- 换牌 / 截胡 ----------

function doExchange(state: GameState, seat: number, takeId: string, giveId: string | null, cost: CostBreakdown, depth: number): void {
  const p = player(state, seat);
  payCost(state, seat, cost);
  const giveIdx = giveId === null ? -1 : p.hand.findIndex((c) => c.id === giveId);
  const given = giveIdx >= 0 ? p.hand[giveIdx] : undefined;
  const takeIdx = state.pool.findIndex((c) => c.id === takeId);
  const taken = state.pool[takeIdx];

  // 取走公共池的牌
  state.pool.splice(takeIdx, 1);
  p.hand.push(taken);
  const meta = ensureMeta(state, taken);
  meta.faceUp = true;
  meta.selectedBy = p.id;
  meta.everSelected = true;
  meta.holderHistory.push(p.id);
  meta.swapFeePaid = cost.total;   // 快照(Q5)

  // 放回一张(普通换牌;补换时被截者手牌少 1 张,无需放回)
  let returned: Card | null = null;
  if (given) {
    p.hand.splice(p.hand.indexOf(given), 1);
    returned = given;
    state.pool.push(given);
    const gm = ensureMeta(state, given);
    gm.origin = "DISCARDED";
    gm.faceUp = true;
    gm.selectedBy = undefined;
    gm.everSelected = true;
    gm.holderHistory.push(p.id);
  }

  p.exchangeCount += 1;
  emit(state, {
    kind: "EXCHANGED", seat, tookId: taken.id, gaveId: returned ? returned.id : "(补回)", cost, exchangeIndex: p.exchangeCount - 1
  });

  setPendingIntercept(state, seat, taken.id, depth);
}

/** 被截者放弃补换:直接收下截胡者放回公共池的那张牌 */
function completeRefillWithReturned(state: GameState, seat: number, cardId: string): void {
  const p = player(state, seat);
  const pick = state.pool.find((c) => c.id === cardId) ?? state.pool[state.pool.length - 1];
  const idx = state.pool.findIndex((c) => c.id === pick.id);
  state.pool.splice(idx, 1);
  p.hand.push(pick);
  const m = ensureMeta(state, pick);
  m.selectedBy = p.id;
  m.holderHistory.push(p.id);
  m.everSelected = true;
}

/**
 * 挂起"待截胡":换牌后只记录,不打断当前回合;真正可截的时机是【紧邻下家的回合内】(§7.4 v1.6)。
 * 好处:① 下家可以先看牌再决定,第 1 轮也能截;② 热座不用来回传设备;③ 资格在行动时才判定。
 */
function setPendingIntercept(state: GameState, fromSeat: number, cardId: string, depth: number): void {
  const meta = state.poolMeta[cardId];
  const alive = aliveSeats(state);
  if (!meta || meta.uninterceptable || alive.length < 2 || depth >= state.config.intercept.cascadeDepthLimit) {
    state.pendingIntercept = null;
    return;
  }
  const candidateSeat = nextAliveSeat(state, fromSeat);
  if (candidateSeat === fromSeat) { state.pendingIntercept = null; return; }
  state.pendingIntercept = { cardId, fromSeat, candidateSeat, n: meta.interceptCount + 1, depth };
  emit(state, { kind: "INTERCEPT_OFFERED", cardId, candidateSeat, n: meta.interceptCount + 1 });
}

/** 待截胡的牌必须仍在原持有者手上;一旦被换回公共池就作废(否则会悬挂) */
function ensurePendingStillValid(state: GameState): void {
  const w = state.pendingIntercept;
  if (!w) return;
  const holder = player(state, w.fromSeat);
  if (!holder.hand.some((c) => c.id === w.cardId)) {
    state.pendingIntercept = null;
    emit(state, { kind: "INTERCEPT_EXPIRED", cardId: w.cardId, candidateSeat: w.candidateSeat });
  }
}

/** 到点清理:候选者回合结束、候选者出局、或本局结束 */
function clearPendingIntercept(state: GameState, reason: "expired" | "declined" | "hand_end"): void {
  const w = state.pendingIntercept;
  if (!w) return;
  state.pendingIntercept = null;
  if (reason === "expired") emit(state, { kind: "INTERCEPT_EXPIRED", cardId: w.cardId, candidateSeat: w.candidateSeat });
}

function doIntercept(state: GameState, seat: number, giveId: string, cost: CostBreakdown): void {
  const w = state.pendingIntercept!;
  const b = player(state, seat);
  const a = player(state, w.fromSeat);
  payCost(state, seat, cost);

  // B 拿走 A 手里的目标牌
  const xi = a.hand.findIndex((c) => c.id === w.cardId);
  const x = a.hand.splice(xi, 1)[0];
  b.hand.push(x);
  const xm = ensureMeta(state, x);
  xm.selectedBy = b.id;
  xm.interceptCount += 1;
  xm.holderHistory.push(b.id);
  xm.faceUp = true;
  state.interceptTotalThisHand += 1;

  // B 放回一张手牌(公开进池)
  const zi = b.hand.findIndex((c) => c.id === giveId);
  const z = b.hand.splice(zi, 1)[0];
  state.pool.push(z);
  const zm = ensureMeta(state, z);
  zm.origin = "DISCARDED";
  zm.faceUp = true;
  zm.selectedBy = undefined;
  zm.everSelected = true;
  zm.holderHistory.push(b.id);

  emit(state, { kind: "INTERCEPTED", seat, fromSeat: w.fromSeat, cardId: x.id, n: w.n, cost });
  state.pendingIntercept = null;

  // 被截者少 1 张 → 立即收下 B 放回的那张(手牌 5、池 7 当场恢复;想换别的可在自己回合正常换牌)
  completeRefillWithReturned(state, w.fromSeat, z.id);

  // 该牌转到 B 手上,仍可能被 B 的下家继续截(受单牌 3 次 / 本局 5 次限制)
  setPendingIntercept(state, seat, x.id, w.depth + 1);
}

// ---------- 踢牌 / 封锁轮 ----------

function doKick(state: GameState, seat: number, targetId: string, cost: CostBreakdown): void {
  const p = player(state, seat);
  payCost(state, seat, cost);
  const idx = state.pool.findIndex((c) => c.id === targetId);
  const removed = state.pool.splice(idx, 1)[0];
  state.kicked.push(removed);
  const drawn = state.deck.shift()!;
  state.pool.push(drawn);
  const dm = ensureMeta(state, drawn);
  dm.origin = "KICK_DRAW";
  dm.faceUp = false;
  dm.everSelected = false;
  dm.selectedBy = undefined;
  dm.holderHistory = [];
  p.kickUsed = true;
  const b: BlockadeState = { kickerSeat: seat, cardId: drawn.id, startSeat: nextAliveSeat(state, seat), resolvedByKicker: false, createdTurn: state.turnSeq };
  state.blockades.push(b);
  emit(state, { kind: "KICKED", seat, removedId: removed.id, drawnId: drawn.id, cost });
  emit(state, { kind: "BLOCKADE_STARTED", kickerSeat: seat, cardId: drawn.id, startSeat: b.startSeat });
}

function resolveBlockade(state: GameState, b: BlockadeState, reason: string, reveal: boolean): void {
  b.resolvedByKicker = true;
  if (reveal) {
    const m = state.poolMeta[b.cardId];
    if (m) m.faceUp = true;
  }
  emit(state, { kind: "BLOCKADE_ENDED", cardId: b.cardId, revealed: reveal, reason });
}

function doTakeBlocked(state: GameState, seat: number, giveId: string, cost: CostBreakdown): void {
  const b = state.blockades.find((x) => x.kickerSeat === seat && !x.resolvedByKicker)!;
  const p = player(state, seat);
  payCost(state, seat, cost);
  const ti = state.pool.findIndex((c) => c.id === b.cardId);
  const taken = state.pool.splice(ti, 1)[0];
  const gi = p.hand.findIndex((c) => c.id === giveId);
  const given = p.hand.splice(gi, 1)[0];
  p.hand.push(taken);
  state.pool.push(given);
  const tm = ensureMeta(state, taken);
  tm.faceUp = true;
  tm.selectedBy = p.id;
  tm.everSelected = true;
  tm.uninterceptable = true;
  tm.holderHistory.push(p.id);
  tm.swapFeePaid = cost.total;
  const gm = ensureMeta(state, given);
  gm.origin = "DISCARDED";
  gm.faceUp = true;
  gm.selectedBy = undefined;
  gm.everSelected = true;
  gm.holderHistory.push(p.id);
  p.exchangeCount += 1;
  p.blind = false;   // 换走暗牌 → 立即失去闷牌
  emit(state, { kind: "BLOCKED_TAKEN", seat, cardId: taken.id, gaveId: given.id, cost });
  resolveBlockade(state, b, "kicker_took", true);
}

function autoPassBlockadesOf(state: GameState, seat: number): void {
  for (const b of state.blockades) {
    if (b.kickerSeat === seat && !b.resolvedByKicker && state.turnSeq > b.createdTurn) {
      resolveBlockade(state, b, "kicker_turn_end", true);
    }
  }
}

function revealAllBlockades(state: GameState, reason: string): void {
  for (const b of state.blockades) if (!b.resolvedByKicker) resolveBlockade(state, b, reason, true);
}

// ---------- 比牌 ----------

function doCompare(state: GameState, seat: number, targetSeat: number, cost: CostBreakdown): void {
  const p = player(state, seat);
  const t = player(state, targetSeat);
  payCost(state, seat, cost);
  p.compareUsedThisTurn = true;
  const hv = evaluate(p.hand);
  const tv = evaluate(t.hand);
  const cmp = compareHands(hv, tv);
  let winner: number | null = null;
  if (cmp > 0) winner = seat;
  else if (cmp < 0) winner = targetSeat;
  emit(state, { kind: "COMPARED", aSeat: seat, bSeat: targetSeat, winnerSeat: winner, tie: cmp === 0, cost });
  if (cmp === 0) {
    state.compareTies.push([seat, targetSeat]);
    emit(state, { kind: "TIE_RECORDED", aSeat: seat, bSeat: targetSeat });
  } else {
    const loser = winner === seat ? targetSeat : seat;
    foldPlayer(state, loser, "比牌落败");
  }
  markActed(state, seat);
  endTurn(state);
}

function foldPlayer(state: GameState, seat: number, reason: string): void {
  const p = player(state, seat);
  if (!isAlive(p)) return;
  p.folded = true;
  const revealed = state.config.fold.revealToAll ? p.hand.map(cardText) : undefined;   // 亮牌便于算牌(可配置)
  emit(state, { kind: "FOLDED", seat, reason, revealed });
  autoPassBlockadesOf(state, seat);
}

// ---------- 回合推进 ----------

function setTurn(state: GameState, seat: number): void {
  state.turnSeq += 1;
  state.turn = { seat, needsMainDecision: true };
  player(state, seat).compareUsedThisTurn = false;
}

function endTurn(state: GameState): void {
  if (state.phase !== "BETTING") return;
  const cur = state.turn.seat;
  if (cur !== null) autoPassBlockadesOf(state, cur);
  // 待截胡只活到"候选者自己的回合结束":他没截就算过期;候选者出局也立即作废
  if (state.pendingIntercept) {
    const w = state.pendingIntercept;
    if (w.candidateSeat === cur) clearPendingIntercept(state, "expired");
    else if (!isAlive(player(state, w.candidateSeat))) clearPendingIntercept(state, "hand_end");
  }

  if (checkHandEnd(state)) return;
  // 回合按顺时针循环推进:最后一个行动者的下家就是下一轮的首家
  const next = nextAliveSeat(state, cur ?? state.betting.openingSeat);
  if (checkRoundEnd(state, next)) return;
  setTurn(state, next);
}

/** 只剩 1 人 / 存活者全在同一平局分量 → 结束本局 */
function checkHandEnd(state: GameState): boolean {
  const alive = aliveSeats(state);
  if (alive.length <= 1) {
    settle(state, "LAST_STANDING");
    return true;
  }
  if (state.config.compare.tieEndWhenAllTied && allInOneTieComponent(state)) {
    settle(state, "TIE_COMPONENT");
    return true;
  }
  return false;
}

export function tieComponents(state: GameState): number[][] {
  const alive = aliveSeats(state);
  const parent = new Map<number, number>();
  for (const s of alive) parent.set(s, s);
  const find = (x: number): number => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  for (const [a, b] of state.compareTies) {
    if (!isAlive(player(state, a)) || !isAlive(player(state, b))) continue;
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  const groups = new Map<number, number[]>();
  for (const s of alive) {
    const r = find(s);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(s);
  }
  return [...groups.values()];
}

function allInOneTieComponent(state: GameState): boolean {
  const comps = tieComponents(state);
  return comps.length === 1 && comps[0].length >= 2;
}

function checkRoundEnd(state: GameState, nextSeat: number): boolean {
  const alive = aliveSeats(state);
  if (alive.length <= 1) { settle(state, "LAST_STANDING"); return true; }
  const acted = state.betting.actedThisRound;
  if (!alive.every((s) => acted.includes(player(state, s).id))) return false;

  const round = state.betting.roundIndex;
  emit(state, { kind: "ROUND_ENDED", roundIndex: round, multiplier: state.multiplier });

  if (state.betting.capReached && round !== state.betting.capRoundIndex) {
    state.betting.postCapRoundsPlayed += 1;
  }
  if (state.betting.postCapRoundsPlayed >= state.config.betting.postCapRoundsToShowdown) {
    settle(state, "SHOWDOWN");
    return true;
  }
  state.betting.roundIndex = round + 1;
  state.betting.actedThisRound = [];
  state.betting.openingSeat = nextSeat;
  setTurn(state, nextSeat);
  return true;
}

// ---------- 结算与终局 ----------

function settle(state: GameState, reason: SettlementResult["reason"]): void {
  clearPendingIntercept(state, "hand_end");
  revealAllBlockades(state, "hand_end");
  const alive = aliveSeats(state);
  let winners: number[] = [];
  let showdown = false;
  if (reason === "LAST_STANDING") {
    winners = alive.slice(0, 1);
  } else if (reason === "TIE_COMPONENT") {
    winners = alive.slice();
  } else {
    showdown = true;
    const entries = alive.map((s) => ({ seat: s, value: evaluate(player(state, s).hand) }));
    emit(state, {
      kind: "SHOWDOWN",
      entries: entries.map((e) => ({ seat: e.seat, category: e.value.category, key: e.value.key }))
    });
    let best = entries[0];
    for (const e of entries) if (compareHands(e.value, best.value) > 0) best = e;
    winners = entries.filter((e) => compareHands(e.value, best.value) === 0).map((e) => e.seat);
  }

  const pot = state.pot;
  const tie = winners.length > 1;
  const perWinner = winners.length > 0 ? Math.floor(pot / winners.length) : 0;
  const remainder = winners.length > 0 ? pot % winners.length : 0;
  const ordered = winners.slice().sort((a, b) => a - b);
  for (let i = 0; i < ordered.length; i++) {
    let amount = perWinner;
    if (i === 0 && state.config.showdown.tieRemainderTo === "FIRST_SEAT") amount += remainder;
    player(state, ordered[i]).points += amount;
    emit(state, { kind: "POT_AWARDED", seat: ordered[i], amount });
  }
  if (winners.length > 0 && state.config.showdown.tieRemainderTo === "CARRY_TO_NEXT_POT") state.carryPot = remainder;
  state.pot = 0;
  emit(state, { kind: "HAND_SETTLED", pot, winners: ordered, reason });

  const thresholdWinners = state.players.filter((p) => p.points >= state.config.endGame.winAtOrAbove);
  const busted = state.players.filter((p) => p.points <= state.config.endGame.bustAtOrBelow);
  let gameOver = false;
  let gameOverReason: SettlementResult["gameOverReason"] | undefined;
  let winnerSeat: number | undefined;
  if (thresholdWinners.length > 0) {
    gameOver = true;
    gameOverReason = busted.length > 0 ? "BOTH" : "WIN_THRESHOLD";
    const top = Math.max(...thresholdWinners.map((p) => p.points));
    const tops = thresholdWinners.filter((p) => p.points === top);
    winnerSeat = tops.length === 1 ? tops[0].seat : undefined;   // 并列 → 整场平局
  } else if (busted.length > 0) {
    gameOver = true;
    gameOverReason = "BUST";
    const survivors = state.players.filter((p) => p.points > state.config.endGame.bustAtOrBelow);
    if (survivors.length === 1) winnerSeat = survivors[0].seat;
  } else if (state.config.endGame.maxHands !== null && state.handNo >= state.config.endGame.maxHands) {
    // 打满局数上限:按积分排名收场,最高分且唯一者胜,并列则整场平局
    gameOver = true;
    gameOverReason = "MAX_HANDS";
    const top = Math.max(...state.players.map((p) => p.points));
    const tops = state.players.filter((p) => p.points === top);
    winnerSeat = tops.length === 1 ? tops[0].seat : undefined;
  }

  const ranking = state.players
    .map((p) => ({ seat: p.seat, points: p.points }))
    .sort((a, b) => b.points - a.points);

  state.settlement = {
    pot, winners: ordered, perWinner, remainder, showdown, reason, ranking, gameOver,
    gameOverReason, winnerSeat, tie
  };

  // 本局到此为止:行动者必须清空,否则"局间等待"时 turn.seat 还停在上一个玩家身上
  state.turn = { seat: null, needsMainDecision: false };
  state.pendingIntercept = null;

  if (gameOver) {
    finishGame(state, gameOverReason!, winnerSeat);
  } else {
    state.phase = "HAND_START";
  }
}

function finishGame(state: GameState, reason: NonNullable<SettlementResult["gameOverReason"]>, winnerSeat?: number): void {
  state.phase = "GAME_OVER";
  state.gameOver = true;
  if (!state.settlement) {
    state.settlement = {
      pot: state.pot, winners: [], perWinner: 0, remainder: 0, showdown: false,
      reason: "LAST_STANDING",
      ranking: state.players.map((p) => ({ seat: p.seat, points: p.points })).sort((a, b) => b.points - a.points),
      gameOver: true, gameOverReason: reason, winnerSeat, tie: false
    };
  }
  emit(state, { kind: "GAME_OVER", reason, winnerSeat });
}

export function invariants(state: GameState): string[] {
  return checkInvariants(state);
}
