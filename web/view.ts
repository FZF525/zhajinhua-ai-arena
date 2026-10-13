// 状态可见性裁剪(纯函数,便于单测):别人的手牌不下发;闷牌者自己的手牌也不下发!
import { aliveSeats, blockadeRipe } from "../src/state.ts";
import type { GameState } from "../src/state.ts";
import { legalActions, interceptEligibility } from "../src/validate.ts";
import { callCost, compareCost, exchangeCost, interceptCost, kickCost, raiseCost, nextLadderValue } from "../src/costs.ts";
import { cardText } from "../src/cards.ts";
import type { Card } from "../src/cards.ts";
import { describeEvent } from "../src/format.ts";
import { ENGINE_VERSION } from "../src/version.ts";
import { describe as describeHand, evaluate } from "../src/evaluator.ts";

/** 当前需要行动的人:永远是轮到的座位(v1.6 起截胡不再打断回合) */
export function actorOf(s: GameState): number | null {
  return s.turn.seat;
}

/** 下发牌时同时给 id 与显示文本:前端只能拿 id 去发动作,避免自造假 id */
function cardView(c: Card): { id: string; text: string } {
  return { id: c.id, text: cardText(c) };
}

function costOf(s: GameState, seat: number, name: string): number | null {
  try {
    switch (name) {
      case "CALL": return callCost(s, seat).total;
      case "RAISE": { const nx = nextLadderValue(s); return nx === null ? null : raiseCost(s, seat, nx).total; }
      case "EXCHANGE": case "TAKE_BLOCKED": return exchangeCost(s, seat).total;
      case "KICK": return kickCost(s).total;
      case "COMPARE": return compareCost(s, seat).total;
      case "INTERCEPT": return s.pendingIntercept ? interceptCost(s, s.pendingIntercept.cardId, s.pendingIntercept.n).total : null;
      default: return 0;
    }
  } catch { return null; }
}

/** 按可见性裁剪:别人的手牌不下发;闷牌者自己的手牌也不下发;公共池暗牌只对踢牌者可见 */
export function buildView(s: GameState, reveal = true, opts: { god?: boolean; viewer?: number | null } = {}) {
  const actor = actorOf(s);
  const over = s.phase === "GAME_OVER";
  const god = !!opts.god;                      // 上帝视角:所有人手牌与暗牌都可见(观战/回放)
  // 结算只在"局间暂停"或"整场结束"时暴露:新一局开始后就不该再挂着上一局的结果
  const settled = s.phase === "HAND_START" || s.phase === "GAME_OVER" ? s.settlement : undefined;
  // 视角座位:单人局固定看自己那一座;多人同屏(热座)才跟随行动者。
  // 不传 viewer 时退回旧行为(= 行动者视角),保持既有用例与热座语义不变。
  const viewerSeat = opts.viewer === undefined ? actor : opts.viewer;
  const viewerP = viewerSeat === null ? null : s.players[viewerSeat] ?? null;
  const p = actor === null ? null : s.players[actor];
  const ladderNext = nextLadderValue(s);
  return {
    serverVersion: ENGINE_VERSION,
    god,
    phase: s.phase,
    handNo: s.handNo,
    maxHands: s.config.endGame.maxHands,
    pot: s.pot,
    multiplier: s.multiplier,
    round: s.betting.roundIndex,
    roundCap: s.config.betting.postCapRoundsToShowdown,
    capReached: s.betting.capReached,
    postCapRounds: s.betting.postCapRoundsPlayed,
    winAtOrAbove: s.config.endGame.winAtOrAbove,
    fees: {
      ante: s.config.ante.amount,
      seen: s.config.betting.seenRate,
      blind: s.config.betting.blindRate,
      exchange: s.config.exchange.fees,
      kick: s.config.kick.fee
    },
    actor,
    actorName: p ? p.name : null,
    /** 视角座位("我的手牌"用它,而不是当前行动者) */
    viewerSeat,
    isMyTurn: actor !== null && viewerSeat !== null && actor === viewerSeat,
    actorHand: reveal && viewerP !== null && (!viewerP.blind || over || god || !!settled) ? viewerP.hand.map(cardView) : null,
    actorHandHidden: reveal && actor !== null && p!.blind && !over,
    actorBlind: p ? p.blind : null,
    actorExchangeCount: p ? p.exchangeCount : null,
    legal: actor === null || over ? [] : legalActions(s).map((name) => ({ name, cost: costOf(s, actor, name) })),
    ladderNext,
    players: s.players.map((pl) => {
      // 公开条件:整场结束 / 上帝视角 / 本局已结算(摊开看结果) / 自己的牌(看了才给) / 弃牌亮牌
      const showHand = reveal && (over || god || !!settled || (pl.seat === viewerSeat && !pl.blind) || (s.config.fold.revealToAll && pl.folded));
      return {
        seat: pl.seat,
        name: pl.name,
        points: pl.points,
        blind: pl.blind,
        folded: pl.folded,
        inHand: pl.inHand,
        handCount: pl.hand.length,
        committed: pl.committedThisHand,
        /** 本局净收支(负 = 这局投出去的,正 = 赢回来的) */
        handDelta: pl.points - (pl.pointsAtHandStart ?? pl.points),
        isActor: pl.seat === actor,
        // 弃牌者按配置亮牌;摊牌那一瞬也公开(便于复盘)
        hand: showHand ? pl.hand.map(cardView) : null,
        handDesc: showHand && pl.hand.length === 5 ? describeHand(evaluate(pl.hand)) : null
      };
    }),
    pool: s.pool.map((c) => {
      const m = s.poolMeta[c.id];
      const blocker = s.blockades.find((b) => b.cardId === c.id && !b.resolvedByKicker);
      const mine = blocker && blocker.kickerSeat === actor;
      return {
        id: m.faceUp || mine || over || god ? c.id : null,
        text: m.faceUp || mine || over || god ? cardText(c) : null,
        faceUp: m.faceUp,
        everSelected: m.everSelected,
        uninterceptable: m.uninterceptable,
        interceptCount: m.interceptCount,
        swapFeePaid: m.swapFeePaid,
        blockadedBy: blocker ? blocker.kickerSeat : null,
        ripe: blocker ? blockadeRipe(s, blocker) : null
      };
    }),
    blockades: s.blockades.filter((b) => !b.resolvedByKicker).map((b) => ({
      kickerSeat: b.kickerSeat, cardId: b.kickerSeat === actor || s.poolMeta[b.cardId]?.faceUp ? b.cardId : null, ripe: blockadeRipe(s, b)
    })),
    // 待截胡:换牌后挂起,到下家的回合内才可执行(§7.4 v1.6)
    intercept: s.pendingIntercept ? {
      cardId: s.pendingIntercept.cardId,
      candidateSeat: s.pendingIntercept.candidateSeat,
      fromSeat: s.pendingIntercept.fromSeat,
      n: s.pendingIntercept.n,
      forMe: s.pendingIntercept.candidateSeat === actor,
      cost: interceptEligibility(s, s.players[s.pendingIntercept.candidateSeat], s.pendingIntercept).cost.total,
      canNow: interceptEligibility(s, s.players[s.pendingIntercept.candidateSeat], s.pendingIntercept).ok,
      reason: interceptEligibility(s, s.players[s.pendingIntercept.candidateSeat], s.pendingIntercept).code ?? null
    } : null,
    ties: s.compareTies,
    log: s.events.slice(-16).map(describeEvent),
    settlement: settled ? {
      reason: settled.reason,
      pot: settled.pot,
      winners: settled.winners,
      perWinner: settled.perWinner,
      remainder: settled.remainder,
      showdown: settled.showdown,
      gameOver: settled.gameOver,
      gameOverReason: settled.gameOverReason,
      winnerSeat: settled.winnerSeat,
      ranking: settled.ranking
    } : null,
    gameOver: s.gameOver,
    /** 本局已结算、等玩家点「下一局」 */
    awaitingNext: s.phase === "HAND_START" && !s.gameOver,
    alive: aliveSeats(s)
  };
}


